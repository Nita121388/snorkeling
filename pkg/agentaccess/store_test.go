// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentaccess

import (
	"os"
	"runtime"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func setup(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	wavebase.DataHome_VarCache = dir
	t.Cleanup(func() { wavebase.DataHome_VarCache = "" })
}

func TestRecordListRevoke(t *testing.T) {
	setup(t)

	if err := Record(Entry{Jti: "jti-1", Name: "codex", Scopes: []string{"observe"}, CreatedAt: 1000, ExpiresAt: 9999}); err != nil {
		t.Fatal(err)
	}
	if err := Record(Entry{Jti: "jti-2", Name: "pi", Scopes: []string{"observe", "navigate"}, CreatedAt: 2000, ExpiresAt: 9999}); err != nil {
		t.Fatal(err)
	}
	entries, err := List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Jti != "jti-2" {
		t.Fatalf("expected newest first, got %+v", entries)
	}

	n, err := RevokeByName("codex")
	if err != nil || n != 1 {
		t.Fatalf("revoke by name: n=%d err=%v", n, err)
	}
	if !IsRevoked("jti-1") {
		t.Fatal("jti-1 must be revoked")
	}
	if IsRevoked("jti-2") {
		t.Fatal("jti-2 must still be live")
	}
	if IsRevoked("unknown") {
		t.Fatal("unknown jti must not count as revoked")
	}

	// revoking again is a no-op, not an error
	if n, err := RevokeByName("codex"); err != nil || n != 0 {
		t.Fatalf("second revoke should be a no-op, got n=%d err=%v", n, err)
	}
	if n, err := RevokeAll(); err != nil || n != 1 {
		t.Fatalf("revoke all should hit the one live token, got n=%d err=%v", n, err)
	}
}

func TestRegistryFilePermissions(t *testing.T) {
	setup(t)
	if err := Record(Entry{Jti: "jti-x", Name: "n", Scopes: []string{"observe"}, CreatedAt: 1, ExpiresAt: 2}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(registryPath())
	if err != nil {
		t.Fatal(err)
	}
	// Windows has no POSIX mode bits (Go reports 0666 regardless), so the 0600
	// assertion is only meaningful on POSIX. The intent is still enforced in
	// code via os.OpenFile(..., 0600).
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("registry must be 0600, got %v", info.Mode().Perm())
	}
	if strings.Contains(readFile(t, registryPath()), "token\"") {
		t.Fatal("registry must not contain a token field")
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestAuditAppend(t *testing.T) {
	setup(t)
	if err := AppendAudit(AuditEntry{Command: "uiactive", AgentName: "codex", JtiPrefix: "abcd1234", Result: "ok"}); err != nil {
		t.Fatal(err)
	}
	if err := AppendAudit(AuditEntry{Command: "blockopen", AgentName: "codex", JtiPrefix: "abcd1234", Result: "denied", Reason: "scope navigate"}); err != nil {
		t.Fatal(err)
	}
	path := AuditPath()
	if filepath.Dir(path) == "" {
		t.Fatal("audit path must be absolute-ish")
	}
	lines := strings.Split(strings.TrimSpace(readFile(t, path)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 audit lines, got %d", len(lines))
	}
	if !strings.Contains(lines[1], `"result":"denied"`) {
		t.Fatalf("second line should be the denial: %s", lines[1])
	}
}

func TestRateLimit(t *testing.T) {
	ResetRateLimit()
	for i := 0; i < 3; i++ {
		if !AllowWithLimit("jti-rl", 3) {
			t.Fatalf("call %d should be allowed", i+1)
		}
	}
	if AllowWithLimit("jti-rl", 3) {
		t.Fatal("4th call must be rate limited")
	}
	// a different token is unaffected
	if !AllowWithLimit("jti-other", 3) {
		t.Fatal("other jti must have its own budget")
	}
	// app-level (no jti) is never limited
	for i := 0; i < 100; i++ {
		if !AllowWithLimit("", 3) {
			t.Fatal("app-level must not be rate limited")
		}
	}
}
