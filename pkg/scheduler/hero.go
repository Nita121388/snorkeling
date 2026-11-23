// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"log"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/hero"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// ScheduledTaskHeroEnabled is the rollback switch for hero-bound scheduled
// tasks: false makes the runner ignore the Hero field entirely, restoring the
// pre-hero behavior (no derivation, no meta injection, no cwd override).
const ScheduledTaskHeroEnabled = true

// Block meta keys for hero-bound tasks. They must stay byte-identical to the
// frontend constants AgentHeroIdMetaKey / AgentHeroNameMetaKey in
// frontend/app/workspace/hero-launch.ts: the A4 roster, hover cards and
// AISessions aggregation read the block meta by these exact keys.
const (
	HeroMetaKey     = "hero"
	HeroNameMetaKey = "hero:name"
)

// HeroRootSetting is wired by the app layer (wshserver.InitScheduledTasks) to
// the settings "hero:rootdir" value. pkg/hero is stdlib-only, so the app is
// the layer that knows about settings; an empty value keeps pkg/hero's own
// resolution chain (HERO_ROOT env > ~/.snorkeling/heroes default), which is
// also what tests rely on.
var HeroRootSetting = func() string { return "" }

// TaskExecution is the fully derived execution shape of a scheduled task:
// after hero derivation, every field is what the run should actually use.
type TaskExecution struct {
	// HeroID is the bound hero id; empty when the task has no hero (or the
	// switch is off).
	HeroID string
	// HeroName is the hero display label (hero.json name, falling back to the
	// id), matching the frontend hero:name meta payload; empty when no hero.
	HeroName     string
	Workdir      string
	AgentProfile string
	Model        string
	Thinking     string
}

// ResolveTaskExecution is the SINGLE derivation point for a scheduled task
// (design: 显式值 > hero.json > 现状默认). A task without a hero — or a hero
// that cannot be read — passes through unchanged; a missing hero only logs,
// never errors, so a bad hero id cannot block scheduling.
//
// The hero root comes from pkg/hero.ResolveRoot over the HeroRootSetting hook,
// never from a second implementation. The model is returned raw; callers push
// it through the existing launch-path canonicalization (resolveTaskModel +
// CanonicalizeModelArg for headless, resolveLaunchModel/canonicalizeModelArg
// for block mode), so the hero-declared model follows the exact same
// normalization as an explicitly typed one.
func ResolveTaskExecution(task *wconfig.ScheduledTaskType) TaskExecution {
	exec := TaskExecution{
		Workdir:      strings.TrimSpace(task.Workdir),
		AgentProfile: strings.TrimSpace(task.AgentProfile),
		Model:        strings.TrimSpace(task.Model),
		Thinking:     strings.TrimSpace(task.Thinking),
	}
	heroID := strings.TrimSpace(task.Hero)
	if !ScheduledTaskHeroEnabled || heroID == "" {
		return exec
	}
	exec.HeroID = heroID
	p, _, err := hero.Get(HeroRootSetting(), heroID)
	if err != nil {
		log.Printf("[scheduler] task id=%s: hero %q unavailable, keeping task defaults: %v", task.Id, heroID, err)
		return exec
	}
	exec.HeroName = heroDisplayName(p)
	if exec.Workdir == "" {
		if root, rerr := hero.ResolveRoot(HeroRootSetting()); rerr == nil {
			exec.Workdir = filepath.Join(root, heroID)
		}
	}
	if exec.AgentProfile == "" {
		exec.AgentProfile = strings.TrimSpace(p.Provider)
	}
	if exec.Model == "" {
		exec.Model = strings.TrimSpace(p.Model)
	}
	return exec
}

// TaskWithExecution returns a shallow task copy carrying the resolved
// execution values (workdir / agentProfile / model / thinking). Id and Hero
// are preserved so downstream consumers (e.g. the block launcher) can still
// see the hero binding. The returned task is safe to hand to the existing
// headless and block paths, which keep working unchanged.
func TaskWithExecution(task *wconfig.ScheduledTaskType, exec TaskExecution) *wconfig.ScheduledTaskType {
	resolved := *task
	resolved.Workdir = exec.Workdir
	resolved.AgentProfile = exec.AgentProfile
	resolved.Model = exec.Model
	resolved.Thinking = exec.Thinking
	return &resolved
}

// heroDisplayName mirrors the frontend hero:name payload (hero-launch.ts):
// the plain hero.json name, falling back to the id when blank. The emoji is
// deliberately NOT folded in — the frontend keeps it in agent:emoji so the
// header shows the hero icon once.
func heroDisplayName(p *hero.Hero) string {
	if name := strings.TrimSpace(p.Name); name != "" {
		return name
	}
	return p.ID
}
