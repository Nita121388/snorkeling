// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

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
