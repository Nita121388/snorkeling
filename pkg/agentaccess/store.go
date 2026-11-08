// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentaccess owns the bookkeeping around external agent tokens:
// what was granted, what has been revoked, what was done, and how fast.
//
// It never stores a token in plaintext. The registry keeps the jti, the name,
// the scopes and the expiry — enough to list and revoke, useless if leaked.
package agentaccess

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Entry is one granted token, as recorded at grant time.
type Entry struct {
	Jti       string   `json:"jti"`
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	RouteId   string   `json:"routeid,omitempty"`
	CreatedAt int64    `json:"createdat"`
	ExpiresAt int64    `json:"expiresat"`
	RevokedAt int64    `json:"revokedat,omitempty"`
}

// Revoked reports whether this entry was revoked.
func (e Entry) Revoked() bool { return e.RevokedAt > 0 }

// Expired reports whether this entry is past its expiry at ts (ms).
func (e Entry) Expired(ts int64) bool { return e.ExpiresAt > 0 && ts >= e.ExpiresAt }

var (
	lock     sync.Mutex
	registry *[]Entry
)

func dataDir() string {
	if wavebase.DataHome_VarCache != "" {
		return filepath.Join(wavebase.DataHome_VarCache, "agent-data", "agent-access")
	}
	if env := os.Getenv(wavebase.WaveDataHomeEnvVar); env != "" {
		return filepath.Join(env, "agent-data", "agent-access")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".snorkeling", "agent-data", "agent-access")
	}
	return filepath.Join(os.TempDir(), "snorkeling-agent-access")
}

func registryPath() string { return filepath.Join(dataDir(), "tokens.json") }

// load returns the registry, reading it once. Caller must hold lock.
func load() []Entry {
	entries := make([]Entry, 0, 8)
	data, err := os.ReadFile(registryPath())
	if err != nil {
		return entries
	}
	if err := json.Unmarshal(data, &entries); err != nil {
		return make([]Entry, 0, 8)
	}
	return entries
}

func save(entries []Entry) error {
	dir := dataDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	path := registryPath()
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Record stores a newly granted token. The token itself is never passed in.
func Record(entry Entry) error {
	lock.Lock()
	defer lock.Unlock()
	entries := load()
	// replace an entry with the same jti (idempotent re-grant in tests)
	out := entries[:0]
	for _, e := range entries {
		if e.Jti != entry.Jti {
			out = append(out, e)
		}
	}
	out = append(out, entry)
	return save(out)
}

// List returns the registry sorted by creation time (newest first).
func List() ([]Entry, error) {
	lock.Lock()
	defer lock.Unlock()
	entries := load()
	sort.Slice(entries, func(i, j int) bool { return entries[i].CreatedAt > entries[j].CreatedAt })
	return entries, nil
}

// RevokeByName revokes every token with this agent name. Returns how many.
func RevokeByName(name string) (int, error) { return revoke(func(e Entry) bool { return e.Name == name }) }

// RevokeByJti revokes a single token.
func RevokeByJti(jti string) (int, error) { return revoke(func(e Entry) bool { return e.Jti == jti }) }

// RevokeAll revokes every live token.
func RevokeAll() (int, error) { return revoke(func(e Entry) bool { return true }) }

func revoke(match func(Entry) bool) (int, error) {
	lock.Lock()
	defer lock.Unlock()
	entries := load()
	now := time.Now().UnixMilli()
	count := 0
	for i := range entries {
		if entries[i].Revoked() || !match(entries[i]) {
			continue
		}
		entries[i].RevokedAt = now
		count++
	}
	if count == 0 {
		return 0, nil
	}
	return count, save(entries)
}

// IsRevoked reports whether a jti was revoked. Unknown jti is NOT revoked:
// a token minted before this registry existed must keep working, and the
// signature already proves it came from this app.
func IsRevoked(jti string) bool {
	if strings.TrimSpace(jti) == "" {
		return false
	}
	lock.Lock()
	defer lock.Unlock()
	for _, e := range load() {
		if e.Jti == jti {
			return e.Revoked()
		}
	}
	return false
}

// Describe summarises a jti prefix for logs (never the full token).
func Describe(jti string) string {
	if len(jti) >= 8 {
		return jti[:8]
	}
	return jti
}

// ErrUnauthorized is the stable error for a revoked/expired token.
func ErrUnauthorized(reason string) error {
	return fmt.Errorf("E_UNAUTHORIZED: %s", reason)
}
