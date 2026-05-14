// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestStatKnownCodexSessionFile(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-test-id.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stat, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{FilePath: sessionPath})
	if err != nil {
		t.Fatal(err)
	}
	if stat.FilePath != sessionPath || stat.Size == 0 || stat.MTime == 0 || stat.Missing {
		t.Fatalf("unexpected stat response: %#v", stat)
	}
}

func TestStatRejectsPathOutsideSessionRoots(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	outsidePath := filepath.Join(t.TempDir(), "not-a-session.jsonl")
	if err := os.WriteFile(outsidePath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{FilePath: outsidePath})
	if err == nil {
		t.Fatalf("expected outside path to be rejected")
	}
}
