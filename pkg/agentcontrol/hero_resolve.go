// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/hero"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// heroPropertyKey mirrors aisessionsservice.HeroPropertyKey: the session
// property naming the hero whose home base the session runs in.
const heroPropertyKey = "hero"

// heroSettingsRoot reads settings.json's hero:rootdir through the live config
// watcher — the same source aisessionsservice.heroSettingsRoot uses, so the
// restore path and the session-list path resolve the same hero root.
func heroSettingsRoot() string {
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	return strings.TrimSpace(settings.HeroRootDir)
}

// ResolveHeroForSummary returns the hero a session belongs to; the zero value
// (= empty ID) means "no hero". Resolution is best-effort and never blocks a
// restore: an unreadable root, an empty roster, a missing hero.json or an
// unknown explicit id all degrade to the zero value with a debug log.
//
// Precedence matches aisessionsservice.deriveHeroProps: an explicit
// props.hero always wins (even when the cwd points at another hero's home
// base), otherwise the session's project path is matched against the roster
// with hero.MatchProjectPath (segment-bounded, separator/case normalized).
//
// The returned Hero carries the display contract of the launch path
// (frontend/app/workspace/hero-launch.ts): Name is the plain name falling back
// to the id, and Emoji is the trimmed emoji (which stays out of Name — the
// header must not render the same emoji twice, N-1119).
func ResolveHeroForSummary(summary *aisessions.SessionSummary) hero.Hero {
	if summary == nil {
		return hero.Hero{}
	}
	root, err := hero.ResolveRoot(heroSettingsRoot())
	if err != nil {
		debugf("ResolveHeroForSummary root error key=%q err=%v", summary.Key, err)
		return hero.Hero{}
	}
	heroes, err := hero.List(root)
	if err != nil {
		debugf("ResolveHeroForSummary roster error key=%q err=%v", summary.Key, err)
		return hero.Hero{}
	}
	if len(heroes) == 0 {
		return hero.Hero{}
	}
	if cell, ok := summary.Props[heroPropertyKey]; ok {
		if id, ok := cell.Value.(string); ok {
			if p := findHeroByID(heroes, strings.TrimSpace(id)); p != nil {
				return normalizeHeroIdentity(*p)
			}
			debugf("ResolveHeroForSummary explicit hero %q not in roster key=%q", id, summary.Key)
		}
	}
	if id := hero.MatchProjectPath(root, heroes, summary.ProjectPath); id != "" {
		if p := findHeroByID(heroes, id); p != nil {
			return normalizeHeroIdentity(*p)
		}
	}
	return hero.Hero{}
}

// findHeroByID is a linear roster lookup; rosters are small (≤50 heroes).
func findHeroByID(heroes []hero.Hero, id string) *hero.Hero {
	if id == "" {
		return nil
	}
	for idx := range heroes {
		if heroes[idx].ID == id {
			return &heroes[idx]
		}
	}
	return nil
}

// normalizeHeroIdentity applies the launch-path display contract: trimmed
// plain name (falling back to the id) and a trimmed emoji.
func normalizeHeroIdentity(p hero.Hero) hero.Hero {
	resolved := p
	resolved.Name = strings.TrimSpace(resolved.Name)
	if resolved.Name == "" {
		resolved.Name = resolved.ID
	}
	resolved.Emoji = strings.TrimSpace(resolved.Emoji)
	return resolved
}
