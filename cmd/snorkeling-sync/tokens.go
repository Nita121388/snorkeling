// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Tokens is the bearer-token set.
//
// Stored as a plain JSON file with 0600 permissions: the tokens are server-side shared secrets,
// not per-user credentials, and the file lives in the operator's own data directory. Hashing them
// would only make `snorkeling-sync token --list` impossible while adding no real protection — an
// attacker who can read this file can also read the SQLite database next to it.
type Tokens struct {
	mu   sync.Mutex
	path string
	data map[string]string // token -> created-at (RFC3339)
}

type tokensFile struct {
	Tokens map[string]string `json:"tokens"`
}

// LoadTokens reads the token file, creating the parent directory if needed.
func LoadTokens(dir string) (*Tokens, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("creating data dir: %w", err)
	}
	path := filepath.Join(dir, "tokens.json")
	t := &Tokens{path: path, data: map[string]string{}}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return t, nil
		}
		return nil, fmt.Errorf("reading tokens: %w", err)
	}
	var parsed tokensFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("parsing tokens file: %w", err)
	}
	if parsed.Tokens != nil {
		t.data = parsed.Tokens
	}
	return t, nil
}

func (t *Tokens) save() error {
	raw, err := json.MarshalIndent(tokensFile{Tokens: t.data}, "", "  ")
	if err != nil {
		return err
	}
	// Write to a temp file in the same directory and rename: a crash mid-write must not leave a
	// truncated token file that locks the operator out.
	tmp := t.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, t.path)
}

// Generate adds a new token and returns it (the only time it is ever visible).
func (t *Tokens) Generate() (string, error) {
	tok, err := newToken()
	if err != nil {
		return "", err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data[tok] = time.Now().UTC().Format(time.RFC3339)
	if err := t.save(); err != nil {
		delete(t.data, tok)
		return "", err
	}
	return tok, nil
}

// Valid reports whether the token is known.
func (t *Tokens) Valid(token string) bool {
	if token == "" {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	_, ok := t.data[token]
	return ok
}

// Revoke removes a token; it returns false when the token was not present.
func (t *Tokens) Revoke(token string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.data[token]; !ok {
		return false
	}
	delete(t.data, token)
	_ = t.save()
	return true
}

// List returns tokens sorted by creation time (oldest first).
func (t *Tokens) List() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]string, 0, len(t.data))
	for tok := range t.data {
		out = append(out, tok)
	}
	sort.Slice(out, func(i, j int) bool { return t.data[out[i]] < t.data[out[j]] })
	return out
}

// CreatedAt returns when a token was minted ("" when unknown).
func (t *Tokens) CreatedAt(token string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.data[token]
}
