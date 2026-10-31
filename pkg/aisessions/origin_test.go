// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"os"
	"path/filepath"
	"testing"
)

func boolPtr(v bool) *bool { return &v }

func TestResolveExternalOrigins_SkipsInvalidEntries(t *testing.T) {
	validDir := t.TempDir()
	missing := filepath.Join(t.TempDir(), "missing")
	fileAsDir := filepath.Join(t.TempDir(), "notdir")
	if err := os.WriteFile(fileAsDir, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	origins := ResolveExternalOrigins([]ExternalOriginSetting{
		{Label: "ok", Path: validDir},
		{Label: "bad-missing", Path: missing},
		{Label: "bad-file", Path: fileAsDir},
		{Label: "", Path: ""},
	})
	if len(origins) != 1 {
		t.Fatalf("expected 1 origin, got %d: %#v", len(origins), origins)
	}
	if origins[0].Label != "ok" || origins[0].Path != validDir {
		t.Fatalf("unexpected origin: %#v", origins[0])
	}
}

func TestResolveExternalOrigins_ReadOnlyDefaultsTrue(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	origins := ResolveExternalOrigins([]ExternalOriginSetting{
		{Label: "unset", Path: dirA},
		{Label: "explicit-false", Path: dirB, ReadOnly: boolPtr(false)},
	})
	if len(origins) != 2 {
		t.Fatalf("expected 2 origins, got %d", len(origins))
	}
	if !origins[0].ReadOnly {
		t.Error("expected ReadOnly to default true when unset")
	}
	if origins[1].ReadOnly {
		t.Error("expected explicit ReadOnly=false to be honored")
	}
}

func TestResolveExternalOrigins_EnvFallback(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	t.Setenv(EnvExtraSessionRoots, dirA+string(os.PathListSeparator)+dirB)

	origins := ResolveExternalOrigins(nil)
	if len(origins) != 2 {
		t.Fatalf("expected 2 origins from env, got %d: %#v", len(origins), origins)
	}
	if origins[0].Label != filepath.Base(dirA) || origins[1].Label != filepath.Base(dirB) {
		t.Errorf("expected labels from basenames, got %q / %q", origins[0].Label, origins[1].Label)
	}
	if origins[0].ReadOnly != true || origins[0].Source != SourcePi {
		t.Errorf("expected env origins read-only pi, got %#v", origins[0])
	}
}

func TestResolveExternalOrigins_DedupByPath(t *testing.T) {
	dir := t.TempDir()
	origins := ResolveExternalOrigins([]ExternalOriginSetting{
		{Label: "a", Path: dir},
		{Label: "b", Path: dir},
	})
	if len(origins) != 1 {
		t.Fatalf("expected dedup to 1 origin, got %d", len(origins))
	}
}

func TestOriginIDForPath_StableAndDistinct(t *testing.T) {
	idA := OriginIDForPath("/tmp/alpha")
	idB := OriginIDForPath("/tmp/alpha")
	idC := OriginIDForPath("/tmp/beta")
	if idA != idB {
		t.Errorf("expected stable id, got %q vs %q", idA, idB)
	}
	if idA == idC {
		t.Errorf("expected distinct ids, got %q", idA)
	}
	if idA == OriginLocalID {
		t.Errorf("origin id must never collide with local")
	}
}

func TestExternalOriginProviders_OnlyPi(t *testing.T) {
	dir := t.TempDir()
	providers := ExternalOriginProviders([]ExternalOrigin{
		{ID: "p1", Path: dir, Source: SourcePi},
		{ID: "p2", Path: dir, Source: "codex"}, // unsupported in P1
	})
	if len(providers) != 1 {
		t.Fatalf("expected only pi provider, got %d", len(providers))
	}
	if providers[0].Source() != SourcePi {
		t.Errorf("unexpected source %q", providers[0].Source())
	}
}

func TestKnownSessionRoots_IncludesExternalAndPi(t *testing.T) {
	piDir := filepath.Join(t.TempDir(), "pi-sessions")
	if err := os.MkdirAll(piDir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", piDir)
	extDir := t.TempDir()
	t.Setenv(EnvExtraSessionRoots, extDir)

	roots := KnownSessionRoots()
	var foundPi, foundExt bool
	for _, root := range roots {
		if root == piDir {
			foundPi = true
		}
		if root == extDir {
			foundExt = true
		}
	}
	if !foundPi {
		t.Error("expected Pi root in KnownSessionRoots")
	}
	if !foundExt {
		t.Error("expected external origin root in KnownSessionRoots")
	}
}
