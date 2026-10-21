// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"path/filepath"
	"testing"
)

// makePiLayout builds a fake pi sessions tree and returns (sessionsDir, filePath)
// for the requested relative path. Nothing is written to disk: the
// classification helpers are pure path logic, which is the point of this file.
func piLayoutPath(t *testing.T, rel string) (string, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "sessions")
	return root, filepath.Join(root, filepath.FromSlash(rel))
}

func TestClassifyPiSessionFile(t *testing.T) {
	tests := []struct {
		name           string
		rel            string
		wantParentRel  string
		wantKind       string
	}{
		{
			name:          "top-level session",
			rel:           "--proj--/2026-10-21T10-00-00-000Z_aaaa.jsonl",
			wantParentRel: "",
			wantKind:      SessionKindSession,
		},
		{
			name:          "fork under <parent>/forks",
			rel:           "--proj--/2026-10-21T10-00-00-000Z_aaaa/forks/2026-10-21T11-00-00-000Z_bbbb.jsonl",
			wantParentRel: "--proj--/2026-10-21T10-00-00-000Z_aaaa.jsonl",
			wantKind:      SessionKindFork,
		},
		{
			name:          "subagent under <parent>/<uuid>/run-0/session.jsonl",
			rel:           "--proj--/2026-10-21T10-00-00-000Z_aaaa/3506248a-3918-4874-b4ba-cfda11fdce9c/run-0/session.jsonl",
			wantParentRel: "--proj--/2026-10-21T10-00-00-000Z_aaaa.jsonl",
			wantKind:      SessionKindSubagent,
		},
		{
			name:          "subagent directly under <parent>/<uuid>",
			rel:           "--proj--/2026-10-21T10-00-00-000Z_aaaa/3506248a-3918-4874-b4ba-cfda11fdce9c/session.jsonl",
			wantParentRel: "--proj--/2026-10-21T10-00-00-000Z_aaaa.jsonl",
			wantKind:      SessionKindSubagent,
		},
		{
			name: "deep nesting still maps to the single top-level parent",
			rel: "--proj--/2026-10-21T10-00-00-000Z_aaaa/u1/run-0/" +
				"nested/deeper/deepest/session.jsonl",
			wantParentRel: "--proj--/2026-10-21T10-00-00-000Z_aaaa.jsonl",
			wantKind:      SessionKindSubagent,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root, path := piLayoutPath(t, tt.rel)
			parentPath, kind := ClassifyPiSessionFile(root, path)
			if kind != tt.wantKind {
				t.Fatalf("kind = %q, want %q", kind, tt.wantKind)
			}
			wantParent := ""
			if tt.wantParentRel != "" {
				wantParent = filepath.Join(root, filepath.FromSlash(tt.wantParentRel))
			}
			if parentPath != wantParent {
				t.Fatalf("parentPath = %q, want %q", parentPath, wantParent)
			}
		})
	}
}

// The directory the child lives in may belong to a parent file that no longer
// exists (user deleted the parent, or pi cleaned it up). Classification must
// still produce a parent path so the caller can promote the orphan to a root row
// instead of dropping the session entirely.
func TestClassifyPiSessionFileOrphanDirectory(t *testing.T) {
	root, path := piLayoutPath(t, "--proj--/parent-uuid/sub/run-0/session.jsonl")
	parentPath, kind := ClassifyPiSessionFile(root, path)
	if kind != SessionKindSubagent {
		t.Fatalf("kind = %q, want %q", kind, SessionKindSubagent)
	}
	if parentPath == "" {
		t.Fatal("expected a parent path for an orphan directory")
	}
	if want := filepath.Join(root, "--proj--", "parent-uuid.jsonl"); parentPath != want {
		t.Fatalf("parentPath = %q, want %q", parentPath, want)
	}
}

func TestClassifyPiSessionFileOutsideRoot(t *testing.T) {
	root, path := piLayoutPath(t, "--proj--/x.jsonl")
	_ = path
	// A path that is not under the sessions dir cannot be classified; it must
	// degrade to a top-level session rather than panicking or inventing a parent.
	parentPath, kind := ClassifyPiSessionFile(root, "/somewhere/else/other.jsonl")
	if parentPath != "" || kind != SessionKindSession {
		t.Fatalf("got (%q, %q), want (\"\", %q)", parentPath, kind, SessionKindSession)
	}
}

func TestPiUUIDFromDirName(t *testing.T) {
	tests := []struct {
		dir  string
		want string
	}{
		{"2026-10-21T10-00-00-000Z_019fd778-48eb-7774-a4fd-25424af0a21e", "019fd778-48eb-7774-a4fd-25424af0a21e"},
		{"no-separator", ""},
		{"trailing_", ""},
		{"", ""},
		{"a_b_c", "c"},
	}
	for _, tt := range tests {
		if got := piUUIDFromDirName(tt.dir); got != tt.want {
			t.Fatalf("piUUIDFromDirName(%q) = %q, want %q", tt.dir, got, tt.want)
		}
	}
}

// The parent key must be computable from the path alone: pi's header id equals
// the filename UUID, so reading the (possibly multi-MB) parent file is never
// needed just to build the relationship.
func TestPiParentKey(t *testing.T) {
	root, childPath := piLayoutPath(t, "--proj--/2026-10-21T10-00-00-000Z_019fd778-48eb-7774-a4fd-25424af0a21e/forks/x.jsonl")
	got := PiParentKey(SourcePi, root, childPath)
	parentPath := filepath.Join(root, "--proj--", "2026-10-21T10-00-00-000Z_019fd778-48eb-7774-a4fd-25424af0a21e.jsonl")
	want := StableKey(SourcePi, "019fd778-48eb-7774-a4fd-25424af0a21e", parentPath)
	if got != want {
		t.Fatalf("PiParentKey = %q, want %q", got, want)
	}
}

func TestPiParentKeyTopLevelIsEmpty(t *testing.T) {
	root, path := piLayoutPath(t, "--proj--/2026-10-21T10-00-00-000Z_019fd778-48eb-7774-a4fd-25424af0a21e.jsonl")
	if got := PiParentKey(SourcePi, root, path); got != "" {
		t.Fatalf("top-level PiParentKey = %q, want empty", got)
	}
}