// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// writePiSession writes a minimal valid pi JSONL v3 session file.
func writePiSession(t *testing.T, path, id string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	content := `{"type":"session","version":3,"id":"` + id + `","timestamp":"2026-10-21T10:00:00.000Z","cwd":"/tmp/project"}` + "\n" +
		`{"type":"message","id":"m1","parentId":"","timestamp":"2026-10-21T10:00:01.000Z","message":{"role":"user","content":"hello"}}` + "\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestManagerForOrigin_UnknownErrors(t *testing.T) {
	_, _, err := managerForOrigin(context.Background(), "dump-does-not-exist")
	if err == nil {
		t.Fatal("expected unknown origin to error, got nil")
	}
}

func TestManagerForOrigin_LocalDefault(t *testing.T) {
	for _, id := range []string{"", aisessions.OriginLocalID} {
		manager, origin, err := managerForOrigin(context.Background(), id)
		if err != nil {
			t.Fatalf("origin %q: %v", id, err)
		}
		if manager == nil {
			t.Fatalf("origin %q: nil manager", id)
		}
		if origin.ID != aisessions.OriginLocalID {
			t.Fatalf("origin %q: expected local, got %q", id, origin.ID)
		}
	}
}

func TestOrigins_LocalFirstAndIncludesEnvDump(t *testing.T) {
	dumpDir := t.TempDir()
	writePiSession(t, filepath.Join(dumpDir, "2026-10-21T10-00-00-000Z_sess-a.jsonl"), "sess-a")
	t.Setenv(aisessions.EnvExtraSessionRoots, dumpDir)

	response, err := (&AISessionsService{}).Origins(context.Background(), &AISessionsOriginsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Origins) < 2 {
		t.Fatalf("expected local + dump origins, got %d", len(response.Origins))
	}
	if response.Origins[0].ID != aisessions.OriginLocalID || response.Origins[0].Kind != aisessions.OriginKindLocal {
		t.Fatalf("expected local first, got %#v", response.Origins[0])
	}
	var dump *AISessionsOrigin
	for i := range response.Origins {
		if response.Origins[i].Path == dumpDir {
			dump = &response.Origins[i]
		}
	}
	if dump == nil {
		t.Fatalf("expected env dump origin in response: %#v", response.Origins)
	}
	if dump.Kind != aisessions.OriginKindDump || !dump.ReadOnly {
		t.Fatalf("expected dump origin read-only, got %#v", *dump)
	}
	if dump.Source != aisessions.SourcePi {
		t.Fatalf("expected pi source, got %q", dump.Source)
	}
}

func TestOrigins_CountsWhenRequested(t *testing.T) {
	dumpDir := t.TempDir()
	writePiSession(t, filepath.Join(dumpDir, "2026-10-21T10-00-00-000Z_sess-a.jsonl"), "sess-a")
	writePiSession(t, filepath.Join(dumpDir, "2026-10-21T11-00-00-000Z_sess-b.jsonl"), "sess-b")
	t.Setenv(aisessions.EnvExtraSessionRoots, dumpDir)

	response, err := (&AISessionsService{}).Origins(context.Background(), &AISessionsOriginsRequest{IncludeCounts: true})
	if err != nil {
		t.Fatal(err)
	}
	var dump *AISessionsOrigin
	for i := range response.Origins {
		if response.Origins[i].Path == dumpDir {
			dump = &response.Origins[i]
		}
	}
	if dump == nil {
		t.Fatalf("expected dump origin: %#v", response.Origins)
	}
	if dump.Count != 2 {
		t.Fatalf("expected 2 sessions in dump, got %d", dump.Count)
	}
}

func TestOrigins_CountsSkippedByDefault(t *testing.T) {
	dumpDir := t.TempDir()
	writePiSession(t, filepath.Join(dumpDir, "2026-10-21T10-00-00-000Z_sess-a.jsonl"), "sess-a")
	t.Setenv(aisessions.EnvExtraSessionRoots, dumpDir)

	response, err := (&AISessionsService{}).Origins(context.Background(), &AISessionsOriginsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	for _, origin := range response.Origins {
		if origin.Count != 0 {
			t.Fatalf("expected counts to default to 0, got %#v", origin)
		}
	}
}

func TestIsKnownAISessionFilePath_ExternalRoot(t *testing.T) {
	dumpDir := t.TempDir()
	sessionPath := filepath.Join(dumpDir, "sess-a.jsonl")
	writePiSession(t, sessionPath, "sess-a")
	t.Setenv(aisessions.EnvExtraSessionRoots, dumpDir)

	if !isKnownAISessionFilePath(sessionPath) {
		t.Fatal("expected external-origin session file to be allowed")
	}
	outside := filepath.Join(t.TempDir(), "outside.jsonl")
	if err := os.WriteFile(outside, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if isKnownAISessionFilePath(outside) {
		t.Fatal("expected file outside known roots to be rejected")
	}
}

func TestStat_ExternalOriginById(t *testing.T) {
	dumpDir := t.TempDir()
	sessionPath := filepath.Join(dumpDir, "2026-10-21T10-00-00-000Z_sess-a.jsonl")
	writePiSession(t, sessionPath, "sess-a")
	t.Setenv(aisessions.EnvExtraSessionRoots, dumpDir)

	originID := aisessions.OriginIDForPath(dumpDir)
	stat, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{
		ID:     "sess-a",
		Origin: originID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if stat.FilePath != sessionPath || stat.Size == 0 || stat.Missing {
		t.Fatalf("unexpected stat: %#v", stat)
	}
}
