// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import "testing"

func TestMatchProjectPathSegmentBoundary(t *testing.T) {
	root := "/home/me/.snorkeling/heroes"
	heroes := []Hero{{ID: "backup", Name: "Backup"}, {ID: "writer", Name: "Writer"}}

	cases := []struct {
		name        string
		projectPath string
		want        string
	}{
		{"home base itself", root + "/backup", "backup"},
		{"nested under home base", root + "/backup/work/notes.md", "backup"},
		{"segment boundary does not claim backup-guard", root + "/backup-guard", ""},
		{"second hero", root + "/writer", "writer"},
		{"root itself is not a hero", root, ""},
		{"unrelated project", "E:/some/real/project", ""},
		{"sibling prefix", root + "/backup2/x", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MatchProjectPath(root, heroes, tc.projectPath); got != tc.want {
				t.Fatalf("MatchProjectPath(%q) = %q, want %q", tc.projectPath, got, tc.want)
			}
		})
	}
}

func TestMatchProjectPathNormalizesSeparatorsCaseAndDots(t *testing.T) {
	heroes := []Hero{{ID: "backup", Name: "Backup"}}
	// Root declared with backslashes, mixed case AND a parent hop: the match
	// must still be segment-exact against the cleaned <root>/<id>.
	root := `E:\Heroes\Backup\..\Backup`
	pathWithBackslashes := `E:\Heroes\BACKUP\Backup\work`
	if got := MatchProjectPath(root, heroes, pathWithBackslashes); got != "backup" {
		t.Fatalf("backslash/mixed-case match = %q, want backup", got)
	}
	// The canonical id is returned even when the path spells it differently.
	if got := MatchProjectPath("/heroes", heroes, "/heroes/BaCkUp/x"); got != "backup" {
		t.Fatalf("case-insensitive id = %q, want canonical roster id", got)
	}
}

func TestMatchProjectPathEmptyInputs(t *testing.T) {
	heroes := []Hero{{ID: "backup"}}
	if got := MatchProjectPath("", heroes, "/heroes/backup"); got != "" {
		t.Fatalf("empty root matched %q", got)
	}
	if got := MatchProjectPath("/heroes", heroes, ""); got != "" {
		t.Fatalf("empty project path matched %q", got)
	}
	if got := MatchProjectPath("/heroes", nil, "/heroes/backup"); got != "" {
		t.Fatalf("empty roster matched %q", got)
	}
	if got := MatchProjectPath("/heroes", []Hero{{ID: "  "}}, "/heroes/x"); got != "" {
		t.Fatalf("blank roster id matched %q", got)
	}
}

func TestMatchProjectPathRootSlashNeverMatches(t *testing.T) {
	// A root of "/" normalizes to "" (same as the frontend matcher), so it
	// cannot silently claim every top-level directory as a hero home base.
	if got := MatchProjectPath("/", []Hero{{ID: "backup"}}, "/backup"); got != "" {
		t.Fatalf("root / matched %q, want no match", got)
	}
}
