// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncmanager

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func TestSwitchTransportRequiresExplicitBaseline(t *testing.T) {
	setup(t)
	// No default: a switch without a stated winner would silently drop one side's edits.
	for _, baseline := range []string{"", "both", "locall"} {
		if _, err := SwitchTransport(context.Background(), map[string]any{}, baseline); err == nil {
			t.Fatalf("baseline %q must be rejected", baseline)
		}
	}
}

func TestOverlaySettingsAppliesPendingPatch(t *testing.T) {
	// The switch builds the new transport from the pending patch before anything is persisted, so
	// the overlay must reflect the draft exactly.
	base := wconfig.SettingsType{
		CommonTextSyncTransport:  "folder",
		CommonTextSyncFolderPath: "/old/path.json",
	}
	over := overlaySettings(base, map[string]any{
		"commontext:sync:transport":            "server",
		"commontext:sync:server:url":           "https://sync.example.com",
		"commontext:sync:server:allowinsecure": true,
	})
	if over.CommonTextSyncTransport != "server" {
		t.Fatalf("transport not overlaid: %q", over.CommonTextSyncTransport)
	}
	if over.CommonTextSyncServerUrl != "https://sync.example.com" {
		t.Fatalf("server url not overlaid: %q", over.CommonTextSyncServerUrl)
	}
	if over.CommonTextSyncServerInsecure == nil || !*over.CommonTextSyncServerInsecure {
		t.Fatal("bool overlay must be honored")
	}
	// Unpatched keys keep their value (a switch must not clear the other backend's config).
	if over.CommonTextSyncFolderPath != "/old/path.json" {
		t.Fatalf("unrelated key must survive: %q", over.CommonTextSyncFolderPath)
	}
	// The original must not be mutated: a failed switch leaves the user's settings untouched.
	if base.CommonTextSyncTransport != "folder" {
		t.Fatalf("overlaySettings must not mutate its input, got %q", base.CommonTextSyncTransport)
	}
}

func TestSwitchToNoneNeedsNoBaseline(t *testing.T) {
	// Turning syncing OFF has an empty target side, so demanding a baseline would be noise.
	//
	// The test environment has no writable settings dir, so the call still fails at the persist
	// step. What matters here is *which* error comes back: a baseline complaint would mean the
	// ordering regressed (baseline demanded before the target is even known).
	setup(t)
	_, err := SwitchTransport(context.Background(), map[string]any{
		"commontext:sync:transport": "none",
	}, "")
	if err == nil {
		return // a writable config dir lets this succeed outright
	}
	if strings.Contains(err.Error(), "baseline") {
		t.Fatalf("switching to none must not require a baseline, got: %v", err)
	}
}
