// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestRemoveBlockIdFromTabKeepsEmptySlice(t *testing.T) {
	// Removing the last block must leave an empty (non-nil) BlockIds so JSON
	// serializes as "blockids": [] — null blockids breaks the frontend empty-tab state.
	tab := &waveobj.Tab{BlockIds: []string{"block-1"}}
	removeBlockIdFromTab(tab, "block-1")
	if tab.BlockIds == nil {
		t.Fatalf("expected non-nil empty BlockIds after removing last block, got nil")
	}
	if len(tab.BlockIds) != 0 {
		t.Fatalf("expected empty BlockIds, got %v", tab.BlockIds)
	}

	// Removing a middle element keeps the remaining ones.
	tab = &waveobj.Tab{BlockIds: []string{"a", "b", "c"}}
	removeBlockIdFromTab(tab, "b")
	if len(tab.BlockIds) != 2 || tab.BlockIds[0] != "a" || tab.BlockIds[1] != "c" {
		t.Fatalf("expected [a c], got %v", tab.BlockIds)
	}

	// Removing an absent element leaves the slice untouched.
	tab = &waveobj.Tab{BlockIds: []string{"a"}}
	removeBlockIdFromTab(tab, "zzz")
	if len(tab.BlockIds) != 1 || tab.BlockIds[0] != "a" {
		t.Fatalf("expected [a], got %v", tab.BlockIds)
	}
}

func TestCopyBlockMetaForDuplicateClearsTransientMeta(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View:               "term",
		waveobj.MetaKey_Controller:         "shell",
		waveobj.MetaKey_Cmd:                "codex",
		waveobj.MetaKey_CmdCwd:             "~/project",
		waveobj.MetaKey_Connection:         "ssh://remote",
		"agent:provider":                   "codex",
		"agent:autoresume":                 true,
		"agent:sessionid":                  "session-123",
		waveobj.MetaKey_TermVDomSubBlockId: "subblock-1",
		"cmd:env": map[string]any{
			"CODEX_HOME": "/tmp/codex",
		},
	}

	copied := copyBlockMetaForDuplicate(meta)

	if copied["agent:sessionid"] != nil {
		t.Fatalf("expected agent:sessionid to be cleared, got %v", copied["agent:sessionid"])
	}
	if copied[waveobj.MetaKey_TermVDomSubBlockId] != nil {
		t.Fatalf("expected %s to be cleared, got %v", waveobj.MetaKey_TermVDomSubBlockId, copied[waveobj.MetaKey_TermVDomSubBlockId])
	}
	if copied.GetString(waveobj.MetaKey_Cmd, "") != "codex" {
		t.Fatalf("expected cmd to be preserved, got %q", copied.GetString(waveobj.MetaKey_Cmd, ""))
	}
	if copied.GetString(waveobj.MetaKey_CmdCwd, "") != "~/project" {
		t.Fatalf("expected cmd:cwd to be preserved, got %q", copied.GetString(waveobj.MetaKey_CmdCwd, ""))
	}
	if copied.GetString(waveobj.MetaKey_Connection, "") != "ssh://remote" {
		t.Fatalf("expected connection to be preserved, got %q", copied.GetString(waveobj.MetaKey_Connection, ""))
	}
	if copied.GetString("agent:provider", "") != "codex" {
		t.Fatalf("expected agent:provider to be preserved, got %q", copied.GetString("agent:provider", ""))
	}
	if !copied.GetBool("agent:autoresume", false) {
		t.Fatalf("expected agent:autoresume to be preserved")
	}

	copiedEnv := copied.GetMap("cmd:env")
	copiedEnv["CODEX_HOME"] = "/tmp/other"
	originalEnv := meta.GetMap("cmd:env")
	if originalEnv.GetString("CODEX_HOME", "") != "/tmp/codex" {
		t.Fatalf("expected nested meta map to be deep-copied, got original env %v", originalEnv)
	}
}
