// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestResolveAgentCmdAndArgs_CodexResume(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "codex",
		waveobj.MetaKey_CmdArgs: []string{"--model", "gpt-5"},
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderCodex,
		MetaKey_AgentSessionId:  "session-123",
	}
	cmd, args, runInfo, err := resolveAgentCmdAndArgs("block:test", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if cmd != "codex" {
		t.Fatalf("unexpected cmd: %s", cmd)
	}
	if len(args) < 2 || args[0] != "resume" || args[1] != "session-123" {
		t.Fatalf("expected resume args prefix, got: %#v", args)
	}
	if runInfo == nil || runInfo.Provider != AgentProviderCodex || runInfo.SessionId != "session-123" {
		t.Fatalf("unexpected run info: %#v", runInfo)
	}
}

func TestResolveAgentCmdAndArgs_CodexCaptureWhenNoSession(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "codex",
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderCodex,
	}
	_, _, runInfo, err := resolveAgentCmdAndArgs("block:test", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if runInfo == nil {
		t.Fatalf("expected non-nil runInfo")
	}
	if !runInfo.CaptureCodexSessionId {
		t.Fatalf("expected codex capture flag true")
	}
	if runInfo.CodexSessionLookupHome != "/Users/tester" {
		t.Fatalf("unexpected lookup home: %q", runInfo.CodexSessionLookupHome)
	}
}

func TestCreateCmdStrAndOptsSetsCodexSessionLookupRoot(t *testing.T) {
	codexHome := t.TempDir()
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "codex",
		waveobj.MetaKey_CmdEnv:  map[string]any{"CODEX_HOME": codexHome},
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderCodex,
	}
	_, _, runInfo, err := createCmdStrAndOpts("block:test", meta, "", true, "/Users/tester")
	if err != nil {
		t.Fatalf("createCmdStrAndOpts returned error: %v", err)
	}
	if runInfo == nil || !runInfo.CaptureCodexSessionId {
		t.Fatalf("expected codex capture run info, got %#v", runInfo)
	}
	if runInfo.CodexSessionLookupRoot != filepath.Join(codexHome, "sessions") {
		t.Fatalf("unexpected lookup root: %q", runInfo.CodexSessionLookupRoot)
	}
}

func TestResolveAgentCmdAndArgs_ClaudeFirstRunUsesSessionIdNotResume(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "claude",
		waveobj.MetaKey_CmdArgs: []string{"--model", "sonnet-4"},
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderClaude,
	}
	cmd, args, runInfo, err := resolveAgentCmdAndArgs("", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if cmd != "claude" {
		t.Fatalf("unexpected cmd: %s", cmd)
	}
	if len(args) < 2 {
		t.Fatalf("expected at least 2 args, got: %#v", args)
	}
	if args[0] == "--resume" || args[0] == "-r" {
		t.Fatalf("first launch should not use resume args: %#v", args)
	}
	if args[len(args)-2] != "--session-id" || args[len(args)-1] == "" {
		t.Fatalf("expected appended --session-id, got: %#v", args)
	}
	if runInfo == nil || runInfo.Provider != AgentProviderClaude || runInfo.SessionId == "" {
		t.Fatalf("unexpected run info: %#v", runInfo)
	}
}

func TestStripClaudeSessionArgs(t *testing.T) {
	in := []string{"--resume", "abc", "--model", "sonnet", "--session-id=def", "--continue"}
	out := stripClaudeSessionArgs(in)
	if len(out) != 2 || out[0] != "--model" || out[1] != "sonnet" {
		t.Fatalf("unexpected stripped args: %#v", out)
	}
}

func TestFindUniqueCodexSessionId(t *testing.T) {
	tmpHome := t.TempDir()
	startTs := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	sessionDir := filepath.Join(tmpHome, ".codex", "sessions", "2026", "04", "18")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-01-111.jsonl")
	data := `{"type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-a","timestamp":"2026-04-18T12:00:01.000Z"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(data), 0o644); err != nil {
		t.Fatalf("write session failed: %v", err)
	}
	sessionId, count, err := findUniqueCodexSessionId(tmpHome, "/tmp/project-a", startTs)
	if err != nil {
		t.Fatalf("findUniqueCodexSessionId returned error: %v", err)
	}
	if sessionId != "session-a" || count != 1 {
		t.Fatalf("expected session-a with count 1, got session=%q count=%d", sessionId, count)
	}
}

func TestFindUniqueCodexSessionIdReadsTopLevelTimestamp(t *testing.T) {
	tmpHome := t.TempDir()
	startTs := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	sessionDir := filepath.Join(tmpHome, ".codex", "sessions", "2026", "04", "18")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-01-111.jsonl")
	data := `{"timestamp":"2026-04-18T12:00:01.000Z","type":"session_meta","payload":{"id":"session-top-level-ts","cwd":"/tmp/project-a"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(data), 0o644); err != nil {
		t.Fatalf("write session failed: %v", err)
	}
	sessionId, count, err := findUniqueCodexSessionId(tmpHome, "/tmp/project-a", startTs)
	if err != nil {
		t.Fatalf("findUniqueCodexSessionId returned error: %v", err)
	}
	if sessionId != "session-top-level-ts" || count != 1 {
		t.Fatalf("expected session-top-level-ts with count 1, got session=%q count=%d", sessionId, count)
	}
}

func TestFindUniqueCodexSessionIdInRootSupportsCodexHomeRoot(t *testing.T) {
	codexHome := t.TempDir()
	startTs := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "18")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-01-111.jsonl")
	data := `{"timestamp":"2026-04-18T12:00:01.000Z","type":"session_meta","payload":{"id":"session-codex-home","cwd":"/tmp/project-a"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(data), 0o644); err != nil {
		t.Fatalf("write session failed: %v", err)
	}
	sessionId, count, err := findUniqueCodexSessionIdInRoot(filepath.Join(codexHome, "sessions"), "/tmp/project-a", startTs)
	if err != nil {
		t.Fatalf("findUniqueCodexSessionIdInRoot returned error: %v", err)
	}
	if sessionId != "session-codex-home" || count != 1 {
		t.Fatalf("expected session-codex-home with count 1, got session=%q count=%d", sessionId, count)
	}
}

func TestNormalizeCwdForComparisonSupportsWindowsPathVariants(t *testing.T) {
	expected := "e:/file/nitafile/obsidians/obsidian"
	variants := []string{
		`E:\File\NitaFile\Obsidians\Obsidian`,
		"E:/File/NitaFile/Obsidians/Obsidian",
		"/e/File/NitaFile/Obsidians/Obsidian",
		"/mnt/e/File/NitaFile/Obsidians/Obsidian",
		"/cygdrive/e/File/NitaFile/Obsidians/Obsidian",
	}
	for _, variant := range variants {
		if got := normalizeCwdForComparison(variant); got != expected {
			t.Fatalf("expected %q for %q, got %q", expected, variant, got)
		}
	}
}

func TestFindUniqueCodexSessionIdRejectsAmbiguousSameCwdCandidates(t *testing.T) {
	tmpHome := t.TempDir()
	startTs := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	sessionDir := filepath.Join(tmpHome, ".codex", "sessions", "2026", "04", "18")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	sessionA := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-01-111.jsonl")
	sessionB := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-02-222.jsonl")
	dataA := `{"type":"session_meta","payload":{"id":"session-a","cwd":"/tmp/project-a","timestamp":"2026-04-18T12:00:01.000Z"}}` + "\n"
	dataB := `{"type":"session_meta","payload":{"id":"session-b","cwd":"/tmp/project-a","timestamp":"2026-04-18T12:00:02.000Z"}}` + "\n"
	if err := os.WriteFile(sessionA, []byte(dataA), 0o644); err != nil {
		t.Fatalf("write session A failed: %v", err)
	}
	if err := os.WriteFile(sessionB, []byte(dataB), 0o644); err != nil {
		t.Fatalf("write session B failed: %v", err)
	}
	sessionId, count, err := findUniqueCodexSessionId(tmpHome, "/tmp/project-a", startTs)
	if err != nil {
		t.Fatalf("findUniqueCodexSessionId returned error: %v", err)
	}
	if sessionId != "" || count != 2 {
		t.Fatalf("expected ambiguous empty session with count 2, got session=%q count=%d", sessionId, count)
	}
}

func TestFindUniqueCodexSessionIdIgnoresOldSessionBeforeStart(t *testing.T) {
	tmpHome := t.TempDir()
	startTs := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	sessionDir := filepath.Join(tmpHome, ".codex", "sessions", "2026", "04", "18")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	oldSession := filepath.Join(sessionDir, "rollout-2026-04-18T11-59-30-111.jsonl")
	newSession := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-02-222.jsonl")
	oldData := `{"type":"session_meta","payload":{"id":"old-session","cwd":"/tmp/project-a","timestamp":"2026-04-18T11:59:30.000Z"}}` + "\n"
	newData := `{"type":"session_meta","payload":{"id":"new-session","cwd":"/tmp/project-a","timestamp":"2026-04-18T12:00:02.000Z"}}` + "\n"
	if err := os.WriteFile(oldSession, []byte(oldData), 0o644); err != nil {
		t.Fatalf("write old session failed: %v", err)
	}
	if err := os.WriteFile(newSession, []byte(newData), 0o644); err != nil {
		t.Fatalf("write new session failed: %v", err)
	}
	sessionId, count, err := findUniqueCodexSessionId(tmpHome, "/tmp/project-a", startTs)
	if err != nil {
		t.Fatalf("findUniqueCodexSessionId returned error: %v", err)
	}
	if sessionId != "new-session" || count != 1 {
		t.Fatalf("expected new-session with count 1, got session=%q count=%d", sessionId, count)
	}
}
