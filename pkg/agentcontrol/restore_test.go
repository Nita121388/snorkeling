// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// RestoreContextFixture mirrors one row of the frontend restore contract
// (frontend/app/view/aisessions/utils.ts restoreMetaForSession). The parity
// test below locks the backend builder to that contract: change either side
// without the other and this test goes red.
type RestoreContextFixture struct {
	Name          string
	Ctx           RestoreContext
	ExpectedCmd   string
	ExpectedCwd   bool // cmd:cwd set from ProjectPath
	ExpectedEnv   bool // cmd:env CLAUDE_CONFIG_DIR + vendor meta keys
	ExpectedVendor bool
}

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
		ExpectedCmd:   "claude",
		ExpectedEnv:   true,
		ExpectedVendor: true,
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
		})
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
