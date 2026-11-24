// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// RestoreContextFixture mirrors one row of the frontend restore contract
// (frontend/app/view/aisessions/utils.ts restoreMetaForSession). The parity
// test below locks the backend builder to that contract: change either side
// without the other and this test goes red.
type RestoreContextFixture struct {
	Name           string
	Ctx            RestoreContext
	ExpectedCmd    string
	ExpectedCwd    bool // cmd:cwd set from ProjectPath
	ExpectedEnv    bool // cmd:env CLAUDE_CONFIG_DIR + vendor meta keys
	ExpectedVendor bool
}

// heroMetaKeys are the four block meta keys a hero restore stamps
// (hero-launch.ts buildHeroLaunchBlockDef is the reference contract).
var heroMetaKeys = []string{heroMetaKeyHero, heroMetaKeyName, heroMetaKeyDisplayName, heroMetaKeyAgentEmoji}

// restoreParityFixtures: five sources, matching design §4's table (D2).
var restoreParityFixtures = []RestoreContextFixture{
	{
		Name: "codex",
		Ctx: RestoreContext{
			SessionId:   "sess-codex-1",
			Source:      "codex",
			ProjectPath: "E:/code/snorkeling",
		},
		ExpectedCmd: "codex",
		ExpectedCwd: true,
	},
	{
		Name: "opencode",
		Ctx: RestoreContext{
			SessionId:   "sess-opencode-1",
			Source:      "opencode",
		},
		ExpectedCmd: "opencode",
		ExpectedCwd: false,
	},
	{
		Name: "pi",
		Ctx: RestoreContext{
			SessionId:   "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
			Source:      "pi",
			ProjectPath: "/home/me/work",
		},
		ExpectedCmd: "pi",
		ExpectedCwd: true,
	},
	{
		Name: "claude-no-vendor",
		Ctx: RestoreContext{
			SessionId: "sess-claude-1",
			Source:    "claude",
		},
		ExpectedCmd:   "claude",
		ExpectedEnv:   false,
		ExpectedVendor: false,
	},
	{
		Name: "claude-with-vendor",
		Ctx: RestoreContext{
			SessionId:  "sess-claude-2",
			Source:     "claude",
			ConfigDir:  "C:/Users/me/.cc-switch/vendors/pro",
			VendorId:   "pro",
			VendorName: "Pro",
		},
		ExpectedCmd:    "claude",
		ExpectedEnv:    true,
		ExpectedVendor: true,
	},
	{
		// A hero session: the resumed block must display like its stage entry.
		Name: "pi-with-hero",
		Ctx: RestoreContext{
			SessionId:   "sess-hero-1",
			Source:      "pi",
			ProjectPath: "/heroes/alpha",
			HeroId:      "alpha",
			HeroName:    "Alpha",
			HeroEmoji:   "🦊",
		},
		ExpectedCmd: "pi",
		ExpectedCwd: true,
	},
	{
		// Hero with no display name and no emoji: hero:name falls back to the
		// id and agent:emoji must not be written at all.
		Name: "codex-hero-blank-name-emoji",
		Ctx: RestoreContext{
			SessionId: "sess-hero-2",
			Source:    "codex",
			HeroId:    "writer",
		},
		ExpectedCmd: "codex",
		ExpectedCwd: false,
	},
}

func TestBuildResumeBlockMetaParity(t *testing.T) {
	for _, fx := range restoreParityFixtures {
		t.Run(fx.Name, func(t *testing.T) {
			meta := BuildResumeBlockMeta(fx.Ctx, "")
			if meta["view"] != "term" {
				t.Errorf("[%s] view = %v, want term", fx.Name, meta["view"])
			}
			if meta["controller"] != "cmd" {
				t.Errorf("[%s] controller = %v, want cmd", fx.Name, meta["controller"])
			}
			if meta["cmd"] != fx.ExpectedCmd {
				t.Errorf("[%s] cmd = %v, want %v", fx.Name, meta["cmd"], fx.ExpectedCmd)
			}
			if meta["cmd:shell"] != false {
				t.Errorf("[%s] cmd:shell = %v, want false", fx.Name, meta["cmd:shell"])
			}
			if meta["cmd:runonstart"] != true {
				t.Errorf("[%s] cmd:runonstart = %v, want true", fx.Name, meta["cmd:runonstart"])
			}
			if meta["cmd:jwt"] != true {
				t.Errorf("[%s] cmd:jwt = %v, want true", fx.Name, meta["cmd:jwt"])
			}
			if meta["agent:autoresume"] != true {
				t.Errorf("[%s] agent:autoresume = %v, want true", fx.Name, meta["agent:autoresume"])
			}
			if meta["agent:provider"] != fx.Ctx.Source {
				t.Errorf("[%s] agent:provider = %v, want %v", fx.Name, meta["agent:provider"], fx.Ctx.Source)
			}
			if meta["agent:sessionid"] != fx.Ctx.SessionId {
				t.Errorf("[%s] agent:sessionid = %v, want %v", fx.Name, meta["agent:sessionid"], fx.Ctx.SessionId)
			}
			_, hasCwd := meta["cmd:cwd"]
			if hasCwd != fx.ExpectedCwd {
				t.Errorf("[%s] cmd:cwd presence = %v, want %v", fx.Name, hasCwd, fx.ExpectedCwd)
			}
			envMap, hasEnv := meta["cmd:env"].(map[string]any)
			if hasEnv != fx.ExpectedEnv {
				t.Errorf("[%s] cmd:env presence = %v, want %v", fx.Name, hasEnv, fx.ExpectedEnv)
			}
			if fx.ExpectedEnv {
				if envMap["CLAUDE_CONFIG_DIR"] != fx.Ctx.ConfigDir {
					t.Errorf("[%s] CLAUDE_CONFIG_DIR = %v, want %v", fx.Name, envMap["CLAUDE_CONFIG_DIR"], fx.Ctx.ConfigDir)
				}
			}
			if fx.ExpectedVendor {
				if meta["agent:claudevendorid"] != fx.Ctx.VendorId {
					t.Errorf("[%s] agent:claudevendorid = %v, want %v", fx.Name, meta["agent:claudevendorid"], fx.Ctx.VendorId)
				}
				if meta["agent:claudevendorname"] != fx.Ctx.VendorName {
					t.Errorf("[%s] agent:claudevendorname = %v, want %v", fx.Name, meta["agent:claudevendorname"], fx.Ctx.VendorName)
				}
			}
			assertHeroResumeMeta(t, fx, meta)
		})
	}
}

// assertHeroResumeMeta locks the hero half of the parity contract: with a hero
// the four keys are stamped exactly like the launch path, and without one none
// of them appears (zero-hero meta stays byte-identical to the pre-hero build).
func assertHeroResumeMeta(t *testing.T, fx RestoreContextFixture, meta map[string]any) {
	t.Helper()
	if fx.Ctx.HeroId == "" {
		for _, key := range heroMetaKeys {
			if value, ok := meta[key]; ok {
				t.Errorf("[%s] meta[%q] = %v, want absent for a session with no hero", fx.Name, key, value)
			}
		}
		return
	}
	if meta[heroMetaKeyHero] != fx.Ctx.HeroId {
		t.Errorf("[%s] hero = %v, want %v", fx.Name, meta[heroMetaKeyHero], fx.Ctx.HeroId)
	}
	wantName := fx.Ctx.HeroName
	if wantName == "" {
		wantName = fx.Ctx.HeroId
	}
	if meta[heroMetaKeyName] != wantName {
		t.Errorf("[%s] hero:name = %v, want %q", fx.Name, meta[heroMetaKeyName], wantName)
	}
	if meta[heroMetaKeyDisplayName] != wantName {
		t.Errorf("[%s] display:name = %v, want %q", fx.Name, meta[heroMetaKeyDisplayName], wantName)
	}
	if fx.Ctx.HeroEmoji != "" {
		if meta[heroMetaKeyAgentEmoji] != fx.Ctx.HeroEmoji {
			t.Errorf("[%s] agent:emoji = %v, want %q", fx.Name, meta[heroMetaKeyAgentEmoji], fx.Ctx.HeroEmoji)
		}
		// N-1119: the emoji lives in agent:emoji only, never inside hero:name.
		if name, _ := meta[heroMetaKeyName].(string); strings.Contains(name, fx.Ctx.HeroEmoji) {
			t.Errorf("[%s] hero:name %q carries the emoji prefix, want the plain name", fx.Name, name)
		}
	} else if value, ok := meta[heroMetaKeyAgentEmoji]; ok {
		t.Errorf("[%s] agent:emoji = %v, want absent when the hero has no emoji", fx.Name, value)
	}
}

func TestBuildResumeBlockMetaCwdOverride(t *testing.T) {
	ctx := RestoreContext{SessionId: "s1", Source: "codex", ProjectPath: "/original"}
	meta := BuildResumeBlockMeta(ctx, "/override")
	if meta["cmd:cwd"] != "/override" {
		t.Errorf("cmd:cwd = %v, want /override", meta["cmd:cwd"])
	}
}

// Unknown sources must be refused, not silently fallen back to codex. The
// GUI's `?? "codex"` fallback is a known defect for gemini (design D4).
func TestResolveRestoreContextRefusesUnknownSource(t *testing.T) {
	summary := &aisessions.SessionSummary{
		ID:     "s-unknown",
		Source: "gemini",
	}
	_, err := ResolveRestoreContext(context.Background(), summary)
	if err == nil {
		t.Fatalf("ResolveRestoreContext accepted unknown source gemini, want E_USAGE")
	}
	if !isUsageError(err) {
		t.Errorf("error kind = %T, want usage error", err)
	}
}
