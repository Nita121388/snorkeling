// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// snorkeling-sync is the self-hosted Common Text sync server.
//
// Scope is deliberately small: one authenticated JSON API, one SQLite file, no accounts. A
// single bearer token is generated on first launch and printed once; multiple tokens (one per
// device) are supported by simply listing several.
//
// Startup:
//
//	snorkeling-sync serve --data ~/.snorkeling-sync --port 8787
//
// On first run it prints the generated token. Store it — it is not recoverable, only replaceable.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// buildAppVersion is overridden at link time (-X main.buildAppVersion=...). It is reported by
// /v1/health as the informational app version; the hard gate is syncproto.ProtocolVersion.
var buildAppVersion = "dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		if err := runServe(os.Args[2:]); err != nil {
			log.Fatalf("snorkeling-sync: %v", err)
		}
	case "version":
		fmt.Printf("snorkeling-sync %s (protocol v%d)\n", buildAppVersion, syncproto.ProtocolVersion)
	case "token":
		if err := runToken(os.Args[2:]); err != nil {
			log.Fatalf("snorkeling-sync: %v", err)
		}
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `snorkeling-sync — self-hosted Common Text sync server

Usage:
  snorkeling-sync serve   --data <dir> [--host 127.0.0.1] [--port 8787]
  snorkeling-sync token   --data <dir> [--add] [--revoke <token>] [--list]
  snorkeling-sync version

The first  serve  generates an access token and prints it once.`)
}

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	dataDir := fs.String("data", "", "data directory (required)")
	host := fs.String("host", "127.0.0.1", "bind address")
	port := fs.Int("port", 8787, "bind port")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dataDir == "" {
		return errors.New("--data is required (where the SQLite file and tokens live)")
	}
	if err := os.MkdirAll(*dataDir, 0o700); err != nil {
		return fmt.Errorf("creating data dir: %w", err)
	}

	store, err := OpenStore(filepath.Join(*dataDir, "sync.sqlite"))
	if err != nil {
		return err
	}
	defer store.Close()

	tokens, err := LoadTokens(*dataDir)
	if err != nil {
		return err
	}
	if len(tokens.List()) == 0 {
		tok, err := tokens.Generate()
		if err != nil {
			return err
		}
		fmt.Printf("\n  Generated access token (shown once, store it now):\n\n    %s\n\n", tok)
		fmt.Printf("  Add it to a device with:\n    wsh commontext-sync set-server http://%s:%d --token %s\n\n", *host, *port, tok)
	}

	srv := &Server{store: store, tokens: tokens}
	mux := http.NewServeMux()
	mux.HandleFunc(syncproto.HealthPath, srv.handleHealth)
	mux.HandleFunc(syncproto.SnapshotPath, srv.requireAuth(srv.handleSnapshot))

	httpServer := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", *host, *port),
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("listening on http://%s:%d  (protocol v%d, app %s)", *host, *port, syncproto.ProtocolVersion, buildAppVersion)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("listen error: %v", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

func runToken(args []string) error {
	fs := flag.NewFlagSet("token", flag.ContinueOnError)
	dataDir := fs.String("data", "", "data directory (required)")
	add := fs.Bool("add", false, "generate an additional token")
	revoke := fs.String("revoke", "", "revoke the given token")
	list := fs.Bool("list", false, "list token prefixes")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dataDir == "" {
		return errors.New("--data is required")
	}
	tokens, err := LoadTokens(*dataDir)
	if err != nil {
		return err
	}
	switch {
	case *list:
		for _, t := range tokens.List() {
			fmt.Printf("%s…  (%s)\n", t[:8], tokens.CreatedAt(t))
		}
		if len(tokens.List()) == 0 {
			fmt.Println("(no tokens)")
		}
	case *revoke != "":
		if !tokens.Revoke(*revoke) {
			return fmt.Errorf("token not found")
		}
		fmt.Println("revoked")
	case *add:
		tok, err := tokens.Generate()
		if err != nil {
			return err
		}
		fmt.Printf("%s\n", tok)
	default:
		return errors.New("pass one of --add / --list / --revoke <token>")
	}
	return nil
}

// Server holds the handlers' dependencies.
type Server struct {
	store  *Store
	tokens *Tokens
}

// handleHealth is unauthenticated by design: the client must be able to report "reachable but
// needs a token" before a token exists. It therefore exposes no content, only counts.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	items, rev, err := s.store.Stats()
	if err != nil {
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, syncproto.Health{
		Service:         syncproto.ServiceName,
		ProtocolVersion: syncproto.ProtocolVersion,
		AppVersion:      buildAppVersion,
		Items:           float64(items),
		Rev:             rev,
		RequiresAuth:    true,
		Capabilities:    []string{syncproto.CapSnapshot, syncproto.CapIncremental},
	})
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handlePull(w, r)
	case http.MethodPut:
		s.handlePush(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handlePull(w http.ResponseWriter, r *http.Request) {
	since, err := parseFloatQuery(r, "sinceRev")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	snap, err := s.store.SnapshotSince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	var req syncproto.PushRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20)).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
		return
	}
	resp, err := s.store.Apply(req)
	if errors.Is(err, ErrBaseRevMismatch) {
		// 409 carries the current snapshot so the client can reconcile without a round trip.
		snap, snapErr := s.store.SnapshotSince(0)
		if snapErr != nil {
			http.Error(w, "store error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, syncproto.ConflictStatusCode, map[string]any{
			"error":   "baseRev mismatch",
			"current": snap,
		})
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// requireAuth enforces the bearer token. It compares constant-time-ish by exact string match on
// the whole token; the token space is 32 random bytes so enumeration is not a practical concern.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		if !s.tokens.Valid(strings.TrimSpace(strings.TrimPrefix(header, prefix))) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		// Path + method + duration only: never log bodies, they contain user notes.
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func parseFloatQuery(r *http.Request, name string) (float64, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return 0, nil
	}
	var v float64
	if _, err := fmt.Sscanf(raw, "%f", &v); err != nil {
		return 0, fmt.Errorf("invalid %s: %q", name, raw)
	}
	return v, nil
}

// newToken returns a 32-byte hex token.
func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
