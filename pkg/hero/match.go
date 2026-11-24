// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"path"
	"strings"
)

// MatchProjectPath returns the id of the hero whose home base (<root>/<id>)
// contains projectPath, or "" when the path belongs to no hero.
//
// The match is segment-bounded (<root>/<id> or <root>/<id>/…), so a hero named
// "backup" cannot claim <root>/backup-guard's sessions. Both separators and
// case are normalized (Windows roots are C:\… while pi encodes session dirs
// with '/'), and Clean resolves ".."/"." segments so a root declared with
// parent hops still matches the same directory spelled plainly.
//
// This is the canonical matcher behind aisessionsservice.deriveHeroProps and
// the frontend's makeHeroPathMatcher (frontend/app/view/aisessions/utils.ts);
// the restore path (pkg/agentcontrol) resolves hero identity with it too.
func MatchProjectPath(root string, heroes []Hero, projectPath string) string {
	normalizedRoot := NormalizeMatchPath(root)
	normalizedProject := NormalizeMatchPath(projectPath)
	if normalizedRoot == "" || normalizedProject == "" {
		return ""
	}
	for _, p := range heroes {
		id := strings.TrimSpace(p.ID)
		if id == "" {
			continue
		}
		homeBase := normalizedRoot + "/" + strings.ToLower(id)
		if normalizedProject != homeBase && !strings.HasPrefix(normalizedProject, homeBase+"/") {
			continue
		}
		return id
	}
	return ""
}

// NormalizeMatchPath lowercases and slash-normalizes a path for prefix
// matching. Empty/blank input normalizes to "" (never a match candidate).
func NormalizeMatchPath(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ReplaceAll(trimmed, "\\", "/")
	trimmed = path.Clean(trimmed)
	trimmed = strings.TrimRight(trimmed, "/")
	if trimmed == "" {
		return ""
	}
	return strings.ToLower(trimmed)
}
