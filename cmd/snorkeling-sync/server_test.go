// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

func newTestServer(t *testing.T) (*Server, *Tokens, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "sync.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	tokens, err := LoadTokens(dir)
	if err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	tok, err := tokens.Generate()
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return &Server{store: store, tokens: tokens}, tokens, tok
}

func muxFor(s *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(syncproto.HealthPath, s.handleHealth)
	mux.HandleFunc(syncproto.SnapshotPath, s.requireAuth(s.handleSnapshot))
	return mux
}

func TestHealthIsUnauthenticatedAndReportsProtocol(t *testing.T) {
	srv, _, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	muxFor(srv).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, syncproto.HealthPath, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("health must be reachable without a token, got %d", rec.Code)
	}
	var h syncproto.Health
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h.Service != syncproto.ServiceName || h.ProtocolVersion != syncproto.ProtocolVersion {
		t.Fatalf("unexpected health: %+v", h)
	}
	// The client uses this to say "reachable, needs a token" instead of a generic failure.
	if !h.RequiresAuth {
		t.Fatal("health must advertise that a token is required")
	}
}

func TestSnapshotRequiresToken(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath, nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token must be 401, got %d", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath, nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad token must be 401, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token must be 200, got %d", rec.Code)
	}
}

func push(t *testing.T, handler http.Handler, tok string, req syncproto.PushRequest) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPut, syncproto.SnapshotPath, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, r)
	return rec
}

func TestPushThenPullRoundTrip(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items: []syncproto.SnapshotItem{
			{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push failed: %d %s", rec.Code, rec.Body.String())
	}

	r := httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath+"?sinceRev=0", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, r)
	var snap syncproto.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if len(snap.Items) != 1 || snap.Items[0].Id != "a" {
		t.Fatalf("expected the pushed item, got %+v", snap.Items)
	}
	if snap.Rev < 1 {
		t.Fatalf("head rev must advance, got %v", snap.Rev)
	}
}

func TestStaleBaseRevIsRejectedWithCurrentSnapshot(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})

	// Reuse baseRev 0: the server head moved on, so this batch must not be applied.
	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "b", Title: "B", Text: "b", UpdatedAt: 2000, Rev: 2}},
	})
	if rec.Code != syncproto.ConflictStatusCode {
		t.Fatalf("stale baseRev must be 409, got %d", rec.Code)
	}
	var body struct {
		Current syncproto.Snapshot `json:"current"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode 409 body: %v", err)
	}
	// The client needs the current snapshot to reconcile without a second round trip.
	if len(body.Current.Items) != 1 || body.Current.Items[0].Id != "a" {
		t.Fatalf("409 must carry the current snapshot, got %+v", body.Current.Items)
	}
}

func TestNewerItemWinsAndOlderItemConflicts(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "old", Text: "old", UpdatedAt: 2000, Rev: 1}},
	})
	head := srv.store.mustHeadRev(t)

	// Newer updatedat: overwrite.
	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "new", Text: "new", UpdatedAt: 3000, Rev: 2}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("newer push must succeed, got %d", rec.Code)
	}
	snap, err := srv.store.SnapshotSince(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap.Items[0].Title != "new" {
		t.Fatalf("newer item must win, got %q", snap.Items[0].Title)
	}

	// Older updatedat: server copy survives and the client is told about the conflict.
	head = srv.store.mustHeadRev(t)
	rec = push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "stale", Text: "stale", UpdatedAt: 500, Rev: 3}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("conflicting push is still 200 (it is reported, not fatal), got %d", rec.Code)
	}
	var resp syncproto.PushResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Conflicts) != 1 || resp.Conflicts[0].Id != "a" {
		t.Fatalf("expected one conflict for item a, got %+v", resp.Conflicts)
	}
	snap, _ = srv.store.SnapshotSince(0)
	if snap.Items[0].Title != "new" {
		t.Fatalf("stale push must not overwrite, got %q", snap.Items[0].Title)
	}
}

func TestTombstoneIsNotResurrected(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})
	head := srv.store.mustHeadRev(t)

	// Delete with a higher rev: the tombstone must stick even though it is "older" by updatedat.
	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", DeletedAt: 2000, UpdatedAt: 2000, Rev: 5}},
	})
	head = srv.store.mustHeadRev(t)

	// A device that missed the delete tries to push the item back.
	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 900, Rev: 6}},
	})

	snap, err := srv.store.SnapshotSince(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Items) != 1 {
		t.Fatalf("expected one row, got %d", len(snap.Items))
	}
	if snap.Items[0].DeletedAt == 0 {
		t.Fatalf("tombstone must survive a stale live push, got %+v", snap.Items[0])
	}
}

// mustHeadRev is a test helper so assertions read as "the head is X".
func (s *Store) mustHeadRev(t *testing.T) float64 {
	t.Helper()
	rev, err := s.headRev()
	if err != nil {
		t.Fatalf("head rev: %v", err)
	}
	return rev
}
