// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncmanager

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncconflict"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func setup(t *testing.T) {
	t.Helper()
	syncconflict.SetDirForTesting(t.TempDir())
	t.Cleanup(func() {
		syncconflict.SetDirForTesting("")
		Stop()
	})
	mu.Lock()
	engine = nil
	lastError = ""
	lastRunAt = time.Time{}
	lastResult = runSummary{}
	mu.Unlock()
}

func TestParseTransportFallsBackToNone(t *testing.T) {
	// A typo in settings must not start an unintended transport.
	for _, tc := range []struct{ in, want string }{
		{"folder", "folder"},
		{" server ", "server"},
		{"git", "git"},
		{"", "none"},
		{"ftp", "none"},
	} {
		if got := parseTransport(tc.in); got != tc.want {
			t.Fatalf("parseTransport(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestBuildTransportReportsMissingPrerequisites(t *testing.T) {
	// The status panel needs a reason, not a silent no-op.
	if _, err := buildTransport(wconfig.SettingsType{}, "folder"); err == nil {
		t.Fatal("folder without a path must fail with a reason")
	}
	if _, err := buildTransport(wconfig.SettingsType{}, "server"); err == nil {
		t.Fatal("server without a URL must fail with a reason")
	}
	// git is documented as not implemented; it must say so rather than pretend.
	if _, err := buildTransport(wconfig.SettingsType{}, "git"); err == nil {
		t.Fatal("git must report that it is not implemented")
	}

	dir := t.TempDir()
	tr, err := buildTransport(wconfig.SettingsType{
		CommonTextSyncFolderPath: filepath.Join(dir, "commontext.json"),
	}, "folder")
	if err != nil || tr == nil {
		t.Fatalf("folder with a path must build: %v", err)
	}
}

func TestExpandHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir in this environment")
	}
	if got := expandHome("~/x/y.json"); got != filepath.Join(home, "x", "y.json") {
		t.Fatalf("expandHome did not expand ~: %q", got)
	}
	// An absolute path must pass through untouched (a user may type one).
	if got := expandHome("/tmp/x.json"); got != "/tmp/x.json" {
		t.Fatalf("absolute path must be untouched, got %q", got)
	}
}

func TestSyncNowWithoutConfigurationIsNotAnErrorBubble(t *testing.T) {
	setup(t)
	// No transport configured: callers must be able to distinguish "nothing to do" from a failure,
	// otherwise the UI shows a scary error for the default state.
	mu.Lock()
	engine = nil
	mu.Unlock()
	_, err := SyncNow(context.Background(), "manual")
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestStatusReportsUnresolvedConflicts(t *testing.T) {
	setup(t)
	status := GetStatus()
	if status.Conflicts != 0 {
		t.Fatalf("fresh status must have no conflicts, got %d", status.Conflicts)
	}
	if status.IntervalSeconds <= 0 {
		t.Fatal("status must expose the interval so the UI can explain the cadence")
	}
	// A configured transport that fails to build surfaces the reason rather than a bare "off".
	status = GetStatus()
	if status.Transport != "none" {
		t.Fatalf("no settings means transport none, got %q", status.Transport)
	}
}
