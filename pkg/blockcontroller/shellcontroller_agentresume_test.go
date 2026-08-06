// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"os"
	"path/filepath"
	"strings"
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

func TestGetAgentProviderNormalizesWindowsCodexShims(t *testing.T) {
	for _, cmd := range []string{
		"codex.exe",
		"codex.cmd",
		"codex.bat",
		"codex.ps1",
		`C:\Users\chemclin\AppData\Roaming\npm\codex.ps1`,
	} {
		if got := getAgentProvider(waveobj.MetaMapType{}, cmd); got != AgentProviderCodex {
			t.Fatalf("expected codex provider for %q, got %q", cmd, got)
		}
	}
}

func TestResolveAgentCmdAndArgs_CodexCaptureWithWindowsShim(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     `C:\Users\chemclin\AppData\Roaming\npm\codex.ps1`,
		MetaKey_AgentAutoResume: true,
	}
	_, _, runInfo, err := resolveAgentCmdAndArgs("block:test", meta, true, `C:\Users\chemclin`)
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if runInfo == nil || runInfo.Provider != AgentProviderCodex || !runInfo.CaptureCodexSessionId {
		t.Fatalf("expected codex capture run info, got %#v", runInfo)
	}
}

func TestResolveAgentCmdAndArgs_CodexResumeStripsExistingResumeWithOptions(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd: "codex",
		waveobj.MetaKey_CmdArgs: []string{
			"--model",
			"gpt-5",
			"resume",
			"--cd",
			"/tmp/project-a",
			"old-session",
			"continue this",
		},
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderCodex,
		MetaKey_AgentSessionId:  "persisted-session",
	}
	_, args, _, err := resolveAgentCmdAndArgs("block:test", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	expected := []string{
		"resume",
		"persisted-session",
		"--model",
		"gpt-5",
		"--cd",
		"/tmp/project-a",
		"continue this",
	}
	if len(args) != len(expected) {
		t.Fatalf("expected args %#v, got %#v", expected, args)
	}
	for idx := range expected {
		if args[idx] != expected[idx] {
			t.Fatalf("expected args %#v, got %#v", expected, args)
		}
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
	_, cmdOpts, runInfo, err := createCmdStrAndOpts("block:test", meta, "", true, "/Users/tester")
	if err != nil {
		t.Fatalf("createCmdStrAndOpts returned error: %v", err)
	}
	if runInfo == nil || !runInfo.CaptureCodexSessionId {
		t.Fatalf("expected codex capture run info, got %#v", runInfo)
	}
	if runInfo.CodexSessionLookupRoot != filepath.Join(codexHome, "sessions") {
		t.Fatalf("unexpected lookup root: %q", runInfo.CodexSessionLookupRoot)
	}
	if cmdOpts == nil || !cmdOpts.ForceJwt {
		t.Fatalf("expected agent command opts to force Wave auth environment, got %#v", cmdOpts)
	}
}

func TestResolveEnvReferenceExpandsProcessEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")
	if got := resolveEnvReference("$ENV:ANTHROPIC_API_KEY"); got != "anthropic-key" {
		t.Fatalf("expected env reference to expand, got %q", got)
	}
	if got := resolveEnvReference(" literal value "); got != " literal value " {
		t.Fatalf("expected literal env value to be preserved, got %q", got)
	}
}

func TestCreateCmdStrAndOptsForcesJwtForExistingCodexAgentBlock(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "codex",
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderCodex,
		MetaKey_AgentSessionId:  "persisted-session",
	}
	_, cmdOpts, runInfo, err := createCmdStrAndOpts("block:test", meta, "", true, "/Users/tester")
	if err != nil {
		t.Fatalf("createCmdStrAndOpts returned error: %v", err)
	}
	if runInfo == nil || runInfo.SessionId != "persisted-session" {
		t.Fatalf("expected persisted codex run info, got %#v", runInfo)
	}
	if cmdOpts == nil || !cmdOpts.ForceJwt {
		t.Fatalf("expected existing agent block to force Wave auth environment, got %#v", cmdOpts)
	}
}

func TestCreateCmdStrAndOptsDoesNotExpandRemoteHomeCwdLocally(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:    "codex",
		waveobj.MetaKey_CmdCwd: "~/project",
	}
	_, cmdOpts, _, err := createCmdStrAndOpts("block:test", meta, "ssh://remote-host", false, "/home/remote-user")
	if err != nil {
		t.Fatalf("createCmdStrAndOpts returned error: %v", err)
	}
	if cmdOpts.Cwd != "~/project" {
		t.Fatalf("expected remote cwd to remain unexpanded, got %q", cmdOpts.Cwd)
	}
}

func TestResolveCmdCwdForConnOnlyExpandsLocalHome(t *testing.T) {
	remoteCwd, err := resolveCmdCwdForConn("~/project", false)
	if err != nil {
		t.Fatalf("resolve remote cwd returned error: %v", err)
	}
	if remoteCwd != "~/project" {
		t.Fatalf("expected remote cwd to remain target-host relative, got %q", remoteCwd)
	}

	localCwd, err := resolveCmdCwdForConn("~/project", true)
	if err != nil {
		t.Fatalf("resolve local cwd returned error: %v", err)
	}
	localCwdForCompare := strings.ReplaceAll(localCwd, "\\", "/")
	if localCwd == "~/project" || !strings.HasSuffix(localCwdForCompare, "/project") {
		t.Fatalf("expected local cwd to expand home, got %q", localCwd)
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

func TestAgentRuntimeMetaClearUpdateReturnsAgentCommandBlockToShell(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View:          "term",
		waveobj.MetaKey_Controller:    BlockController_Cmd,
		waveobj.MetaKey_Cmd:           "codex",
		waveobj.MetaKey_CmdArgs:       []string{"resume", "session-123"},
		waveobj.MetaKey_CmdShell:      false,
		waveobj.MetaKey_CmdJwt:        true,
		waveobj.MetaKey_CmdRunOnStart: true,
		waveobj.MetaKey_CmdCwd:        "~/project",
		MetaKey_AgentAutoResume:       true,
		MetaKey_AgentProvider:         AgentProviderCodex,
		MetaKey_AgentSessionId:        "session-123",
	}

	updated := waveobj.MergeMeta(meta, agentRuntimeMetaClearUpdate(), false)

	if updated.GetString(waveobj.MetaKey_Controller, "") != BlockController_Shell {
		t.Fatalf("expected controller to return to shell, got %q", updated.GetString(waveobj.MetaKey_Controller, ""))
	}
	clearedKeys := []string{
		waveobj.MetaKey_Cmd,
		waveobj.MetaKey_CmdArgs,
		waveobj.MetaKey_CmdShell,
		waveobj.MetaKey_CmdJwt,
		waveobj.MetaKey_CmdRunOnStart,
		MetaKey_AgentAutoResume,
		MetaKey_AgentProvider,
		MetaKey_AgentSessionId,
	}
	for _, key := range clearedKeys {
		if updated[key] != nil {
			t.Fatalf("expected %s to be cleared, got %#v", key, updated)
		}
	}
	if updated.GetString(waveobj.MetaKey_CmdCwd, "") != "~/project" {
		t.Fatalf("expected cwd meta to be preserved, got %q", updated.GetString(waveobj.MetaKey_CmdCwd, ""))
	}
}

func TestShellControllerKeepsAgentRuntimeMetaOnShutdownStop(t *testing.T) {
	sc := MakeShellController("tab:test", "block:test", BlockController_Cmd, "").(*ShellController)
	if !sc.shouldClearAgentRuntimeMetaOnExit() {
		t.Fatalf("expected agent runtime meta to clear before shutdown stop")
	}
	sc.KeepAgentMetaOnExit = true
	if sc.shouldClearAgentRuntimeMetaOnExit() {
		t.Fatalf("expected agent runtime meta to be kept after shutdown stop")
	}
}

func TestAgentShellShutdownResumeMetaUpdateConvertsActiveAgentShell(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View:       "term",
		waveobj.MetaKey_Controller: BlockController_Shell,
		waveobj.MetaKey_CmdCwd:     "~/project",
		MetaKey_AgentAutoResume:    true,
		MetaKey_AgentProvider:      AgentProviderCodex,
		MetaKey_AgentSessionId:     "session-123",
	}
	rtInfo := &waveobj.ObjRTInfo{ShellState: "running-command"}

	updated := waveobj.MergeMeta(meta, agentShellShutdownResumeMetaUpdate(meta, rtInfo), false)

	if updated.GetString(waveobj.MetaKey_Controller, "") != BlockController_Cmd {
		t.Fatalf("expected controller cmd, got %#v", updated)
	}
	if updated.GetString(waveobj.MetaKey_Cmd, "") != AgentProviderCodex {
		t.Fatalf("expected cmd codex, got %#v", updated)
	}
	if updated.GetBool(waveobj.MetaKey_CmdShell, true) {
		t.Fatalf("expected cmd:shell false, got %#v", updated)
	}
	if !updated.GetBool(waveobj.MetaKey_CmdJwt, false) || !updated.GetBool(waveobj.MetaKey_CmdRunOnStart, false) {
		t.Fatalf("expected run-on-start jwt command meta, got %#v", updated)
	}
	if updated.GetString(MetaKey_AgentSessionId, "") != "session-123" {
		t.Fatalf("expected persisted session id to be preserved, got %#v", updated)
	}
	if updated.GetString(waveobj.MetaKey_CmdCwd, "") != "~/project" {
		t.Fatalf("expected cwd to be preserved, got %#v", updated)
	}
}

func TestAgentShellShutdownResumeMetaUpdateRequiresActiveSession(t *testing.T) {
	baseMeta := waveobj.MetaMapType{
		waveobj.MetaKey_View:       "term",
		waveobj.MetaKey_Controller: BlockController_Shell,
		MetaKey_AgentAutoResume:    true,
		MetaKey_AgentProvider:      AgentProviderCodex,
		MetaKey_AgentSessionId:     "session-123",
	}
	for name, meta := range map[string]waveobj.MetaMapType{
		"plain-shell": {
			waveobj.MetaKey_Controller: BlockController_Shell,
		},
		"already-cmd": {
			waveobj.MetaKey_Controller: BlockController_Cmd,
			MetaKey_AgentAutoResume:    true,
			MetaKey_AgentProvider:      AgentProviderCodex,
			MetaKey_AgentSessionId:     "session-123",
		},
		"missing-session": {
			waveobj.MetaKey_Controller: BlockController_Shell,
			MetaKey_AgentAutoResume:    true,
			MetaKey_AgentProvider:      AgentProviderCodex,
		},
	} {
		if update := agentShellShutdownResumeMetaUpdate(meta, &waveobj.ObjRTInfo{ShellState: "running-command"}); update != nil {
			t.Fatalf("%s: expected no shutdown resume update, got %#v", name, update)
		}
	}
	if update := agentShellShutdownResumeMetaUpdate(baseMeta, &waveobj.ObjRTInfo{ShellState: "ready"}); update != nil {
		t.Fatalf("expected ready shell not to convert, got %#v", update)
	}
}

func TestAgentShellShutdownResumeMetaUpdateSupportsClaude(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Controller: BlockController_Shell,
		MetaKey_AgentAutoResume:    true,
		MetaKey_AgentProvider:      AgentProviderClaude,
		MetaKey_AgentSessionId:     "claude-session",
	}
	update := agentShellShutdownResumeMetaUpdate(meta, &waveobj.ObjRTInfo{ShellState: "running-command"})
	if update.GetString(waveobj.MetaKey_Cmd, "") != AgentProviderClaude {
		t.Fatalf("expected claude command update, got %#v", update)
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

func TestReadCodexSessionMetaScansPreludeLines(t *testing.T) {
	tmpDir := t.TempDir()
	sessionPath := filepath.Join(tmpDir, "rollout-2026-04-18T12-00-01-111.jsonl")
	data := `{"type":"environment_context","payload":{"cwd":"/tmp/project-a"}}` + "\n" +
		`not json` + "\n" +
		`{"type":"session_meta","payload":{"id":"session-after-prelude","cwd":"/tmp/project-a","timestamp":"2026-04-18T12:00:01.000Z"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(data), 0o644); err != nil {
		t.Fatalf("write session failed: %v", err)
	}
	sessionId, cwd, timestamp, err := readCodexSessionMeta(sessionPath)
	if err != nil {
		t.Fatalf("readCodexSessionMeta returned error: %v", err)
	}
	if sessionId != "session-after-prelude" || cwd != "/tmp/project-a" {
		t.Fatalf("expected prelude session meta, got session=%q cwd=%q", sessionId, cwd)
	}
	if timestamp.IsZero() {
		t.Fatalf("expected non-zero timestamp")
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

func TestFindUniqueCodexSessionIdInRootSupportsWindowsCwdVariants(t *testing.T) {
	codexHome := t.TempDir()
	startTs := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "18")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-18T12-00-01-111.jsonl")
	data := `{"type":"session_meta","payload":{"id":"session-windows-cwd","cwd":"E:\\File\\NitaFile\\Obsidians\\Obsidian","timestamp":"2026-04-18T12:00:01.000Z"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(data), 0o644); err != nil {
		t.Fatalf("write session failed: %v", err)
	}
	sessionId, count, err := findUniqueCodexSessionIdInRoot(filepath.Join(codexHome, "sessions"), "/mnt/e/File/NitaFile/Obsidians/Obsidian", startTs)
	if err != nil {
		t.Fatalf("findUniqueCodexSessionIdInRoot returned error: %v", err)
	}
	if sessionId != "session-windows-cwd" || count != 1 {
		t.Fatalf("expected session-windows-cwd with count 1, got session=%q count=%d", sessionId, count)
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

func TestResolveAgentCmdAndArgs_OpenCodeResume(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "opencode",
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderOpenCode,
		MetaKey_AgentSessionId:  "oc-session-456",
	}
	cmd, args, runInfo, err := resolveAgentCmdAndArgs("block:test", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if cmd != "opencode" {
		t.Fatalf("unexpected cmd: %s", cmd)
	}
	if len(args) != 2 || args[0] != "--session" || args[1] != "oc-session-456" {
		t.Fatalf("expected --session args, got: %#v", args)
	}
	if runInfo == nil || runInfo.Provider != AgentProviderOpenCode || runInfo.SessionId != "oc-session-456" {
		t.Fatalf("unexpected run info: %#v", runInfo)
	}
}

func TestResolveAgentCmdAndArgs_PiResume(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "pi",
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderPi,
		MetaKey_AgentSessionId:  "pi-session-789",
	}
	cmd, args, runInfo, err := resolveAgentCmdAndArgs("block:test", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if cmd != "pi" {
		t.Fatalf("unexpected cmd: %s", cmd)
	}
	if len(args) != 2 || args[0] != "--session-id" || args[1] != "pi-session-789" {
		t.Fatalf("expected --session-id args, got: %#v", args)
	}
	if runInfo == nil || runInfo.Provider != AgentProviderPi || runInfo.SessionId != "pi-session-789" {
		t.Fatalf("unexpected run info: %#v", runInfo)
	}
}

func TestGetAgentProviderRecognizesOpenCodeAndPi(t *testing.T) {
	for _, cmd := range []string{
		"opencode",
		"opencode.exe",
		`C:\Users\chemclin\AppData\Roaming\npm\opencode.cmd`,
		"pi",
		"pi.exe",
	} {
		got := getAgentProvider(waveobj.MetaMapType{}, cmd)
		if got != AgentProviderOpenCode && got != AgentProviderPi {
			t.Fatalf("expected opencode/pi provider for %q, got %q", cmd, got)
		}
	}
}
