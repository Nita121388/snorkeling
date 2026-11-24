// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestResolveLaunchProfileUnknown(t *testing.T) {
	_, _, err := resolveLaunchProfile("definitely-not-a-profile-xyz", "")
	if err == nil || !strings.Contains(err.Error(), "E_PROFILE_UNKNOWN") {
		t.Fatalf("expected E_PROFILE_UNKNOWN, got %v", err)
	}
}

func TestResolveLaunchProfileEmpty(t *testing.T) {
	_, _, err := resolveLaunchProfile("   ", "")
	if err == nil || !strings.Contains(err.Error(), "E_USAGE") {
		t.Fatalf("expected E_USAGE, got %v", err)
	}
}

func TestResolveLaunchModelDefault(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "pi", DefaultModel: "default-model"}
	model, err := resolveLaunchModel(profile, "")
	if err != nil || model != "default-model" {
		t.Fatalf("expected default-model, got %q err=%v", model, err)
	}
}

func TestResolveLaunchModelExactId(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "pi", Models: []agentcatalog.ModelInfo{
		{Id: "deepseek/deepseek-v4-flash", Provider: "deepseek"},
	}}
	model, err := resolveLaunchModel(profile, "deepseek/deepseek-v4-flash")
	if err != nil || model != "deepseek/deepseek-v4-flash" {
		t.Fatalf("expected exact id passthrough, got %q err=%v", model, err)
	}
}

func TestResolveLaunchModelProviderSlashId(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "pi", Models: []agentcatalog.ModelInfo{
		{Id: "deepseek-v4-flash", Provider: "deepseek"},
	}}
	model, err := resolveLaunchModel(profile, "deepseek/deepseek-v4-flash")
	if err != nil || model != "deepseek/deepseek-v4-flash" {
		t.Fatalf("expected provider/id match, got %q err=%v", model, err)
	}
}

func TestResolveLaunchModelNotInCatalog(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "pi", Models: []agentcatalog.ModelInfo{
		{Id: "model-a", Provider: "prov"},
		{Id: "model-b", Provider: "prov"},
	}}
	_, err := resolveLaunchModel(profile, "no-such-model")
	if err == nil || !strings.Contains(err.Error(), "E_MODEL_NOT_IN_CATALOG") {
		t.Fatalf("expected E_MODEL_NOT_IN_CATALOG, got %v", err)
	}
	if !strings.Contains(err.Error(), "prov/model-a") || !strings.Contains(err.Error(), "prov/model-b") {
		t.Fatalf("error should list candidates, got %v", err)
	}
}

func TestResolveLaunchModelNoModelList(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "opencode"}
	_, err := resolveLaunchModel(profile, "some-model")
	if err == nil || !strings.Contains(err.Error(), "E_MODEL_NOT_IN_CATALOG") {
		t.Fatalf("expected E_MODEL_NOT_IN_CATALOG for a profile without a model list, got %v", err)
	}
}

func TestModelCandidateHintCap(t *testing.T) {
	models := make([]agentcatalog.ModelInfo, 0, 30)
	for i := 0; i < 30; i++ {
		models = append(models, agentcatalog.ModelInfo{Id: fmt.Sprintf("m%d", i)})
	}
	hint := modelCandidateHint(models)
	if got := len(strings.Split(hint, ", ")); got != maxModelCandidates {
		t.Fatalf("expected %d candidates, got %d (%s)", maxModelCandidates, got, hint)
	}
}

func TestBuildAgentBlockMeta(t *testing.T) {
	// Cmd 用不存在的命令名：本机解析失败 → 保留裸 cmd（与 GUI 裸 PATH 行为解耦，测试环境无关）。
	// 真正的「解析成绝对路径」行为由 TestResolveAgentCmdForLaunch 用受控 PATH 验证。
	profile := agentcatalog.ProfileInfo{
		Name:      "pi",
		Cmd:       "wavetest-nonexistent-agent",
		ModelFlag: "--model",
		Args:      []string{"--extra"},
		Env:       map[string]string{"FOO": "bar"},
	}
	meta := buildAgentBlockMeta(profile, "deepseek/deepseek-v4-flash", wshrpc.AgentLaunchRequest{
		Cwd: "/tmp/proj",
	})
	if meta.GetString("view", "") != "term" {
		t.Fatalf("view: %v", meta["view"])
	}
	if meta.GetString("controller", "") != "cmd" {
		t.Fatalf("controller: %v", meta["controller"])
	}
	if meta.GetString("cmd", "") != "wavetest-nonexistent-agent" {
		t.Fatalf("cmd: %v", meta["cmd"])
	}
	if meta.GetBool("cmd:shell", true) {
		t.Fatal("cmd:shell must be false")
	}
	if !meta.GetBool("cmd:runonstart", false) {
		t.Fatal("cmd:runonstart must be true")
	}
	if !meta.GetBool("cmd:jwt", false) {
		t.Fatal("cmd:jwt must be true")
	}
	if !meta.GetBool("agent:autoresume", false) {
		t.Fatal("agent:autoresume must be true")
	}
	if meta.GetString("agent:provider", "") != "wavetest-nonexistent-agent" {
		t.Fatalf("agent:provider: %v", meta["agent:provider"])
	}
	if meta.GetString("agent:isolationmode", "") != AgentIsolationModeSystem {
		t.Fatalf("agent:isolationmode: %v", meta["agent:isolationmode"])
	}
	if meta.GetString("agent:requestedmodel", "") != "deepseek/deepseek-v4-flash" {
		t.Fatalf("agent:requestedmodel: %v", meta["agent:requestedmodel"])
	}
	args := meta.GetStringArray("cmd:args")
	if len(args) != 3 || args[0] != "--extra" || args[1] != "--model" || args[2] != "deepseek/deepseek-v4-flash" {
		t.Fatalf("cmd:args: %v", args)
	}
	env := meta.GetStringMap("cmd:env", false)
	if env["FOO"] != "bar" {
		t.Fatalf("cmd:env: %v", env)
	}
	if meta.GetString("cmd:cwd", "") != "/tmp/proj" {
		t.Fatalf("cmd:cwd: %v", meta["cmd:cwd"])
	}
}

func TestBuildAgentBlockMetaNoModelNoEnvNoCwd(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "claude", Cmd: "claude", ModelFlag: "--model"}
	meta := buildAgentBlockMeta(profile, "", wshrpc.AgentLaunchRequest{})
	if _, ok := meta["cmd:args"]; ok {
		t.Fatal("cmd:args must be absent without a model")
	}
	if _, ok := meta["cmd:env"]; ok {
		t.Fatal("cmd:env must be absent without profile env")
	}
	if _, ok := meta["cmd:cwd"]; ok {
		t.Fatal("cmd:cwd must be absent without --cwd")
	}
	if _, ok := meta["agent:requestedmodel"]; ok {
		t.Fatal("agent:requestedmodel must be absent without a model")
	}
}

func TestAgentProviderNameFromCommandPath(t *testing.T) {
	cases := map[string]string{
		"claude":                "claude",
		"/usr/local/bin/claude": "claude",
		"C:\\Tools\\Claude.CMD": "claude",
		"PI.EXE":                "pi",
		"":                      "pi",
	}
	profile := agentcatalog.ProfileInfo{Name: "pi", Cmd: ""}
	for cmd, want := range cases {
		profile.Cmd = cmd
		if got := agentProviderName(profile); got != want {
			t.Fatalf("agentProviderName(cmd=%q) = %q, want %q", cmd, got, want)
		}
	}
}

func TestResolveAgentCmdForLaunch(t *testing.T) {
	t.Run("keeps empty and already-qualified commands", func(t *testing.T) {
		if got := resolveAgentCmdForLaunch(""); got != "" {
			t.Fatalf("empty: %q", got)
		}
		if got := resolveAgentCmdForLaunch("  "); got != "" {
			t.Fatalf("whitespace: %q", got)
		}
		for _, qualified := range []string{"/usr/local/bin/agent", "./agent", `C:\Tools\agent.exe`} {
			if got := resolveAgentCmdForLaunch(qualified); got != qualified {
				t.Fatalf("qualified %q → %q", qualified, got)
			}
		}
	})

	t.Run("keeps an unresolvable bare command", func(t *testing.T) {
		t.Setenv("PATH", t.TempDir())
		if got := resolveAgentCmdForLaunch("wavetest-absent-agent"); got != "wavetest-absent-agent" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("resolves a bare command on PATH to an absolute path", func(t *testing.T) {
		dir := t.TempDir()
		bin := filepath.Join(dir, "wavetest-agent")
		if err := os.WriteFile(bin, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
			t.Fatalf("write fake agent: %v", err)
		}
		t.Setenv("PATH", dir)
		got := resolveAgentCmdForLaunch("wavetest-agent")
		if got != bin {
			t.Fatalf("got %q, want %q", got, bin)
		}
	})

	t.Run("keeps the bare cmd when the resolved path contains spaces", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "My Tools")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		bin := filepath.Join(dir, "wavetest-spaced-agent")
		if err := os.WriteFile(bin, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
			t.Fatalf("write fake agent: %v", err)
		}
		t.Setenv("PATH", dir)
		if got := resolveAgentCmdForLaunch("wavetest-spaced-agent"); got != "wavetest-spaced-agent" {
			t.Fatalf("got %q", got)
		}
	})
}

func TestValidateLaunchConnection(t *testing.T) {
	for _, ok := range []string{"", "  ", "local", "local:foo"} {
		if err := validateLaunchConnection(ok); err != nil {
			t.Fatalf("connection %q should be accepted, got %v", ok, err)
		}
	}
	err := validateLaunchConnection("remote-ssh")
	if err == nil || !strings.Contains(err.Error(), "E_UNSUPPORTED") {
		t.Fatalf("expected E_UNSUPPORTED, got %v", err)
	}
}

func TestSanitizeSendText(t *testing.T) {
	cases := []struct{ in, want string }{
		{"plain text", "plain text"},
		{"line1\nline2\ttabbed", "line1\nline2\ttabbed"},
		{"carriage\rreturn", "carriagereturn"},
		{"esc\x1b[2Jclear", "esc[2Jclear"}, // ESC dropped, [2J is plain text
		{"bell\x07gone", "bellgone"},
		{"del\x7fchar", "delchar"},
	}
	for _, tc := range cases {
		if got := SanitizeSendText(tc.in); got != tc.want {
			t.Fatalf("SanitizeSendText(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSanitizeSendTextCap(t *testing.T) {
	big := strings.Repeat("a", MaxSendTextBytes+1)
	req := wshrpc.AgentSendRequest{Text64: encodeForTest(big)}
	_, err := resolveSendText(req)
	if err == nil || !strings.Contains(err.Error(), "E_USAGE") {
		t.Fatalf("expected E_USAGE over the size cap, got %v", err)
	}
}

func TestResolveSendTextRequiresText(t *testing.T) {
	if _, err := resolveSendText(wshrpc.AgentSendRequest{}); err == nil {
		t.Fatal("empty send request must be E_USAGE")
	}
}

func TestResolveSendTextPrefersText64(t *testing.T) {
	req := wshrpc.AgentSendRequest{
		Text:   "plain",
		Text64: encodeForTest("base64 wins"),
	}
	got, err := resolveSendText(req)
	if err != nil || got != "base64 wins" {
		t.Fatalf("text64 must win, got %q err=%v", got, err)
	}
}

func TestBuildInjectBytes(t *testing.T) {
	got := string(buildInjectBytes("hello\nworld"))
	want := "\x1b[200~hello\nworld\x1b[201~"
	if got != want {
		t.Fatalf("inject bytes = %q, want %q", got, want)
	}
}

func TestNormalizeSendParamsDefaults(t *testing.T) {
	params, err := normalizeSendParams(wshrpc.AgentSendRequest{})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !params.Wait || !params.Submit {
		t.Fatalf("defaults must be wait+submit, got %+v", params)
	}
	if params.WaitMs != DefaultSendWaitMs || params.QuietMs != DefaultSendQuietMs || params.SubmitDelayMs != DefaultSubmitDelayMs {
		t.Fatalf("defaults not applied: %+v", params)
	}
	if params.SubmitVerifyMs != DefaultSubmitVerifyMs {
		t.Fatalf("submitverifyms default = %d, want %d", params.SubmitVerifyMs, DefaultSubmitVerifyMs)
	}
	if params.SubmitWaitMs != DefaultSubmitWaitMs {
		t.Fatalf("submitwaitms default = %d, want %d", params.SubmitWaitMs, DefaultSubmitWaitMs)
	}
}

func TestNormalizeSendParamsExplicitFalse(t *testing.T) {
	no := false
	params, err := normalizeSendParams(wshrpc.AgentSendRequest{Wait: &no, Submit: &no})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if params.Wait || params.Submit {
		t.Fatalf("explicit false must survive the wire, got %+v", params)
	}
	if params.SubmitDelayMs != 0 {
		t.Fatalf("submitdelayms must stay 0 without submit, got %d", params.SubmitDelayMs)
	}
}

func TestNormalizeSendParamsBounds(t *testing.T) {
	cases := []wshrpc.AgentSendRequest{
		{WaitMs: MaxSendWaitMs + 1},
		{QuietMs: MinSendQuietMs - 1},
		{QuietMs: MaxSendQuietMs + 1},
		{SubmitDelayMs: MaxSubmitDelayMs + 1, Submit: truePtr()},
		{SubmitVerifyMs: MinSubmitVerifyMs - 1},
		{SubmitVerifyMs: MaxSubmitVerifyMs + 1},
		{SubmitWaitMs: MaxSubmitWaitMs + 1},
	}
	for i, req := range cases {
		if _, err := normalizeSendParams(req); err == nil {
			t.Fatalf("case %d must be E_USAGE, got nil", i)
		}
	}
}

func TestResolveSendTargetBlockRequiresBlock(t *testing.T) {
	if _, err := resolveSendTargetBlock(context.Background(), ""); err == nil {
		t.Fatal("empty block id must be E_USAGE")
	}
	if _, err := resolveSendTargetBlock(context.Background(), "blk123"); err != nil {
		t.Fatalf("plain block id must pass, got %v", err)
	}
}

func truePtr() *bool {
	v := true
	return &v
}

func encodeForTest(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

func TestCanonicalizeModelArgAmbiguous(t *testing.T) {
	profile := agentcatalog.ProfileInfo{Name: "pi", Models: []agentcatalog.ModelInfo{
		{Id: "deepseek-v4.1-flash", Provider: "deepseek-copy"},
		{Id: "deepseek-v4.1-flash", Provider: "deepseek", Default: true},
		{Id: "deepseek-v4.1-flash", Provider: "opencode"},
	}}
	// The bare default is ambiguous across providers: the launch, not the caller,
	// must pick the catalog's default-flagged entry (pi refuses to guess).
	if got := canonicalizeModelArg(profile, "deepseek-v4.1-flash"); got != "deepseek/deepseek-v4.1-flash" {
		t.Fatalf("ambiguous bare id must resolve to the default-flagged provider/id, got %q", got)
	}
	// provider/id form passes through untouched
	if got := canonicalizeModelArg(profile, "opencode/deepseek-v4.1-flash"); got != "opencode/deepseek-v4.1-flash" {
		t.Fatalf("provider/id must pass through, got %q", got)
	}
	// A single entry that carries a provider is still canonicalized: pi is the
	// agent that needs the provider even when the catalog lists the id once.
	single := agentcatalog.ProfileInfo{Name: "pi", Models: []agentcatalog.ModelInfo{{Id: "glm-5.2", Provider: "cc-switch-open-code-go"}}}
	if got := canonicalizeModelArg(single, "glm-5.2"); got != "cc-switch-open-code-go/glm-5.2" {
		t.Fatalf("provider-carrying id must be canonicalized, got %q", got)
	}
	// claude/codex catalog entries carry no provider -> bare names stay bare
	bare := agentcatalog.ProfileInfo{Name: "claude", Models: []agentcatalog.ModelInfo{{Id: "claude-sonnet-4-6"}}}
	if got := canonicalizeModelArg(bare, "claude-sonnet-4-6"); got != "claude-sonnet-4-6" {
		t.Fatalf("provider-less id must stay bare, got %q", got)
	}
}

func TestResolveLaunchModelAmbiguousDefaultCanonicalized(t *testing.T) {
	profile := agentcatalog.ProfileInfo{
		Name:         "pi",
		DefaultModel: "deepseek-v4.1-flash",
		Models: []agentcatalog.ModelInfo{
			{Id: "deepseek-v4.1-flash", Provider: "deepseek-copy"},
			{Id: "deepseek-v4.1-flash", Provider: "deepseek", Default: true},
		},
	}
	got, err := resolveLaunchModel(profile, "")
	if err != nil || got != "deepseek/deepseek-v4.1-flash" {
		t.Fatalf("default model must be canonicalized to provider/id, got %q err=%v", got, err)
	}
}
