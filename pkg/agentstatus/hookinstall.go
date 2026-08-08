// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	HookTargetAll      = "all"
	HookTargetCodex    = "codex"
	HookTargetClaude   = "claude"
	HookTargetOpenCode = "opencode"
	HookTargetPi       = "pi"

	hookInstallBaseName  = "snorkeling-agent-status"
	hookInstallVersion   = 20
	codexHomeEnvVar      = "CODEX_HOME"
	claudeConfigEnvVar   = "CLAUDE_CONFIG_DIR"
	openCodeConfigEnvVar = "OPENCODE_CONFIG_DIR"
	piConfigEnvVar       = "PI_CODING_AGENT_DIR"
	integrationIdMarker  = "SNORKELING_AGENT_STATUS_INTEGRATION_ID="
	versionMarker        = "SNORKELING_AGENT_STATUS_INTEGRATION_VERSION="
)

type HookInstallResult struct {
	Provider     string
	HookPath     string
	ConfigPath   string
	SettingsPath string
	HooksPath    string
}

type HookStatus struct {
	Provider           string `json:"provider"`
	Supported          bool   `json:"supported"`
	Installed          bool   `json:"installed"`
	Current            bool   `json:"current"`
	NeedsInstall       bool   `json:"needsInstall"`
	HookPath           string `json:"hookPath,omitempty"`
	ConfigPath         string `json:"configPath,omitempty"`
	HooksPath          string `json:"hooksPath,omitempty"`
	SettingsPath       string `json:"settingsPath,omitempty"`
	Reason             string `json:"reason,omitempty"`
	InstalledVersion   int    `json:"installedVersion,omitempty"`
	RequiredVersion    int    `json:"requiredVersion,omitempty"`
	ConfigHooksEnabled bool   `json:"configHooksEnabled,omitempty"`
}

type HookStatusResult struct {
	Statuses []HookStatus `json:"statuses"`
}

func InstallHooks(target string) ([]HookInstallResult, error) {
	switch strings.TrimSpace(strings.ToLower(target)) {
	case "", HookTargetAll:
		codex, err := InstallCodexHooks()
		if err != nil {
			return nil, err
		}
		claude, err := InstallClaudeHooks()
		if err != nil {
			return nil, err
		}
		opencode, err := InstallOpenCodeHooks()
		if err != nil {
			return nil, err
		}
		pi, err := InstallPiHooks()
		if err != nil {
			return nil, err
		}
		return []HookInstallResult{codex, claude, opencode, pi}, nil
	case HookTargetCodex:
		result, err := InstallCodexHooks()
		if err != nil {
			return nil, err
		}
		return []HookInstallResult{result}, nil
	case HookTargetClaude:
		result, err := InstallClaudeHooks()
		if err != nil {
			return nil, err
		}
		return []HookInstallResult{result}, nil
	case HookTargetOpenCode:
		result, err := InstallOpenCodeHooks()
		if err != nil {
			return nil, err
		}
		return []HookInstallResult{result}, nil
	case HookTargetPi:
		result, err := InstallPiHooks()
		if err != nil {
			return nil, err
		}
		return []HookInstallResult{result}, nil
	default:
		return nil, fmt.Errorf("unsupported agentstatus hook target %q", target)
	}
}

func CheckHooks(target string) (*HookStatusResult, error) {
	switch strings.TrimSpace(strings.ToLower(target)) {
	case "", HookTargetAll:
		return &HookStatusResult{Statuses: []HookStatus{checkCodexHooks(), checkClaudeHooks(), checkOpenCodeHooks(), checkPiHooks()}}, nil
	case HookTargetCodex:
		return &HookStatusResult{Statuses: []HookStatus{checkCodexHooks()}}, nil
	case HookTargetClaude:
		return &HookStatusResult{Statuses: []HookStatus{checkClaudeHooks()}}, nil
	case HookTargetOpenCode:
		return &HookStatusResult{Statuses: []HookStatus{checkOpenCodeHooks()}}, nil
	case HookTargetPi:
		return &HookStatusResult{Statuses: []HookStatus{checkPiHooks()}}, nil
	default:
		return nil, fmt.Errorf("unsupported agentstatus hook target %q", target)
	}
}

func InstallCodexHooks() (HookInstallResult, error) {
	dir, err := configDirFromEnvOrHome(codexHomeEnvVar, ".codex")
	if err != nil {
		return HookInstallResult{}, err
	}
	if !isDir(dir) {
		return HookInstallResult{}, fmt.Errorf("codex config directory not found at %s. install Codex first", dir)
	}

	hookPath := filepath.Join(dir, hookInstallName())
	if err := writeHookScript(hookPath, HookTargetCodex); err != nil {
		return HookInstallResult{}, err
	}

	hooksPath := filepath.Join(dir, "hooks.json")
	hooksFile, err := readJSONObjectFile(hooksPath)
	if err != nil {
		return HookInstallResult{}, err
	}
	hooks, err := ensureHooksObject(hooksFile, hooksPath)
	if err != nil {
		return HookInstallResult{}, err
	}
	pruneManagedCommandHooks(hooks)
	for _, spec := range codexHookSpecs() {
		if err := ensureCommandHook(hooks, spec.event, codexHookCommand(hookPath, spec), 10, ""); err != nil {
			return HookInstallResult{}, err
		}
	}
	if err := writeJSONFile(hooksPath, hooksFile); err != nil {
		return HookInstallResult{}, err
	}

	configPath := filepath.Join(dir, "config.toml")
	existingConfig, err := readOptionalFile(configPath)
	if err != nil {
		return HookInstallResult{}, err
	}
	newConfig := buildCodexConfigWithHooks(existingConfig)
	if newConfig != existingConfig {
		if err := os.WriteFile(configPath, []byte(newConfig), 0o644); err != nil {
			return HookInstallResult{}, err
		}
	}

	return HookInstallResult{
		Provider:   HookTargetCodex,
		HookPath:   hookPath,
		HooksPath:  hooksPath,
		ConfigPath: configPath,
	}, nil
}

func checkCodexHooks() HookStatus {
	status := HookStatus{
		Provider:        HookTargetCodex,
		RequiredVersion: hookInstallVersion,
	}
	dir, err := configDirFromEnvOrHome(codexHomeEnvVar, ".codex")
	if err != nil {
		status.Reason = err.Error()
		status.NeedsInstall = true
		return status
	}
	status.HookPath = filepath.Join(dir, hookInstallName())
	status.HooksPath = filepath.Join(dir, "hooks.json")
	status.ConfigPath = filepath.Join(dir, "config.toml")
	if !isDir(dir) {
		status.Reason = fmt.Sprintf("codex config directory not found at %s", dir)
		status.NeedsInstall = true
		return status
	}
	status.Supported = true
	script, err := os.ReadFile(status.HookPath)
	if err != nil {
		if os.IsNotExist(err) {
			status.Reason = "hook script not installed"
		} else {
			status.Reason = err.Error()
		}
		status.NeedsInstall = true
		return status
	}
	status.Installed = true
	status.InstalledVersion = hookScriptVersion(string(script))
	hookOk := strings.Contains(string(script), integrationIdMarker+HookTargetCodex) &&
		status.InstalledVersion >= hookInstallVersion &&
		!strings.Contains(string(script), `[ "${WAVETERM:-}" = "1" ]`) &&
		!strings.Contains(string(script), `start "" /b`)
	hooksOk := codexHookCommandsInstalled(status.HooksPath, status.HookPath)
	status.ConfigHooksEnabled = codexConfigHooksEnabled(status.ConfigPath)
	status.Current = hookOk && hooksOk && status.ConfigHooksEnabled
	status.NeedsInstall = !status.Current
	if !status.Current {
		switch {
		case !hookOk:
			status.Reason = "hook script is missing or outdated"
		case !hooksOk:
			status.Reason = "codex hook commands are missing"
		case !status.ConfigHooksEnabled:
			status.Reason = "codex hooks feature is disabled"
		}
	}
	return status
}

func InstallClaudeHooks() (HookInstallResult, error) {
	dir, err := configDirFromEnvOrHome(claudeConfigEnvVar, ".claude")
	if err != nil {
		return HookInstallResult{}, err
	}
	if !isDir(dir) {
		return HookInstallResult{}, fmt.Errorf("claude config directory not found at %s. install Claude Code first", dir)
	}

	hooksDir := filepath.Join(dir, "hooks")
	if err := os.MkdirAll(hooksDir, 0o755); err != nil {
		return HookInstallResult{}, err
	}
	hookPath := filepath.Join(hooksDir, claudeHookInstallName())
	if err := writeClaudeHookScript(hookPath); err != nil {
		return HookInstallResult{}, err
	}

	settingsPath := filepath.Join(dir, "settings.json")
	settings, err := readJSONObjectFile(settingsPath)
	if err != nil {
		return HookInstallResult{}, err
	}
	hooks, err := ensureHooksObject(settings, settingsPath)
	if err != nil {
		return HookInstallResult{}, err
	}
	pruneManagedCommandHooks(hooks)
	for _, spec := range claudeHookSpecs() {
		if err := ensureCommandHook(hooks, spec.event, claudeHookCommand(hookPath, spec.action, spec.phase), 10, spec.matcher); err != nil {
			return HookInstallResult{}, err
		}
	}
	if err := writeJSONFile(settingsPath, settings); err != nil {
		return HookInstallResult{}, err
	}

	return HookInstallResult{
		Provider:     HookTargetClaude,
		HookPath:     hookPath,
		SettingsPath: settingsPath,
	}, nil
}

func checkClaudeHooks() HookStatus {
	status := HookStatus{
		Provider:        HookTargetClaude,
		RequiredVersion: hookInstallVersion,
	}
	dir, err := configDirFromEnvOrHome(claudeConfigEnvVar, ".claude")
	if err != nil {
		status.Reason = err.Error()
		status.NeedsInstall = true
		return status
	}
	status.HookPath = filepath.Join(dir, "hooks", claudeHookInstallName())
	status.SettingsPath = filepath.Join(dir, "settings.json")
	if !isDir(dir) {
		status.Reason = fmt.Sprintf("claude config directory not found at %s", dir)
		status.NeedsInstall = true
		return status
	}
	status.Supported = true
	script, err := os.ReadFile(status.HookPath)
	if err != nil {
		if os.IsNotExist(err) {
			status.Reason = "hook script not installed"
		} else {
			status.Reason = err.Error()
		}
		status.NeedsInstall = true
		return status
	}
	status.Installed = true
	status.InstalledVersion = hookScriptVersion(string(script))
	hookOk := strings.Contains(string(script), integrationIdMarker+HookTargetClaude) &&
		status.InstalledVersion >= hookInstallVersion &&
		!strings.Contains(string(script), `[ "${WAVETERM:-}" = "1" ]`) &&
		!strings.Contains(string(script), `start "" /b`)
	settingsOk := claudeHookCommandsInstalled(status.SettingsPath, status.HookPath)
	status.Current = hookOk && settingsOk
	status.NeedsInstall = !status.Current
	if !status.Current {
		if !hookOk {
			status.Reason = "hook script is missing or outdated"
		} else {
			status.Reason = "claude hook commands are missing"
		}
	}
	return status
}

func InstallOpenCodeHooks() (HookInstallResult, error) {
	dir, err := openCodeConfigDir()
	if err != nil {
		return HookInstallResult{}, err
	}
	if !isDir(dir) {
		return HookInstallResult{}, fmt.Errorf("opencode config directory not found at %s. install OpenCode first", dir)
	}
	pluginDir := filepath.Join(dir, "plugin")
	if err := os.MkdirAll(pluginDir, 0o755); err != nil {
		return HookInstallResult{}, err
	}
	hookPath := filepath.Join(pluginDir, openCodePluginInstallName())
	if err := writeHookScriptContent(hookPath, openCodePluginSource()); err != nil {
		return HookInstallResult{}, err
	}
	return HookInstallResult{
		Provider:  HookTargetOpenCode,
		HookPath:  hookPath,
		HooksPath: pluginDir,
	}, nil
}

func checkOpenCodeHooks() HookStatus {
	status := HookStatus{
		Provider:        HookTargetOpenCode,
		RequiredVersion: hookInstallVersion,
	}
	dir, err := openCodeConfigDir()
	if err != nil {
		status.Reason = err.Error()
		status.NeedsInstall = true
		return status
	}
	status.HookPath = filepath.Join(dir, "plugin", openCodePluginInstallName())
	if !isDir(dir) {
		status.Reason = fmt.Sprintf("opencode config directory not found at %s", dir)
		status.NeedsInstall = true
		return status
	}
	status.Supported = true
	script, err := os.ReadFile(status.HookPath)
	if err != nil {
		if os.IsNotExist(err) {
			status.Reason = "plugin not installed"
		} else {
			status.Reason = err.Error()
		}
		status.NeedsInstall = true
		return status
	}
	status.Installed = true
	status.InstalledVersion = hookScriptVersion(string(script))
	hookOk := strings.Contains(string(script), integrationIdMarker+HookTargetOpenCode) &&
		status.InstalledVersion >= hookInstallVersion &&
		strings.Contains(string(script), "agentstatus")
	status.Current = hookOk
	status.NeedsInstall = !status.Current
	if !status.Current {
		status.Reason = "opencode plugin is missing or outdated"
	}
	return status
}

func InstallPiHooks() (HookInstallResult, error) {
	dir, err := piAgentConfigDir()
	if err != nil {
		return HookInstallResult{}, err
	}
	if !isDir(dir) {
		return HookInstallResult{}, fmt.Errorf("pi config directory not found at %s. install Pi first", dir)
	}
	extDir := filepath.Join(dir, "extensions")
	if err := os.MkdirAll(extDir, 0o755); err != nil {
		return HookInstallResult{}, err
	}
	hookPath := filepath.Join(extDir, piExtensionInstallName())
	if err := writeHookScriptContent(hookPath, piExtensionSource()); err != nil {
		return HookInstallResult{}, err
	}
	return HookInstallResult{
		Provider:  HookTargetPi,
		HookPath:  hookPath,
		HooksPath: extDir,
	}, nil
}

func checkPiHooks() HookStatus {
	status := HookStatus{
		Provider:        HookTargetPi,
		RequiredVersion: hookInstallVersion,
	}
	dir, err := piAgentConfigDir()
	if err != nil {
		status.Reason = err.Error()
		status.NeedsInstall = true
		return status
	}
	status.HookPath = filepath.Join(dir, "extensions", piExtensionInstallName())
	if !isDir(dir) {
		status.Reason = fmt.Sprintf("pi config directory not found at %s", dir)
		status.NeedsInstall = true
		return status
	}
	status.Supported = true
	script, err := os.ReadFile(status.HookPath)
	if err != nil {
		if os.IsNotExist(err) {
			status.Reason = "extension not installed"
		} else {
			status.Reason = err.Error()
		}
		status.NeedsInstall = true
		return status
	}
	status.Installed = true
	status.InstalledVersion = hookScriptVersion(string(script))
	hookOk := strings.Contains(string(script), integrationIdMarker+HookTargetPi) &&
		status.InstalledVersion >= hookInstallVersion &&
		strings.Contains(string(script), "agentstatus")
	status.Current = hookOk
	status.NeedsInstall = !status.Current
	if !status.Current {
		status.Reason = "pi extension is missing or outdated"
	}
	return status
}

func openCodePluginInstallName() string {
	return hookInstallBaseName + ".ts"
}

func piExtensionInstallName() string {
	return hookInstallBaseName + ".ts"
}

// openCodePluginSource generates an OpenCode plugin (auto-discovered from
// <config>/plugin/*.ts) that maps OpenCode events to wsh agentstatus reports.
// The plugin is a plain async event module (no external imports) so OpenCode can
// load it without npm install; wsh resolution mirrors the shell hook fallback
// chain (WAVETERM_WSHBINDIR, PATH, then LOCALAPPDATA/USERPROFILE install dirs).
func openCodePluginSource() string {
	return fmt.Sprintf(`// installed by Snorkeling
// managed by Snorkeling; reinstalling the integration overwrites this file.
// %s%s
// %s%d

export default async () => ({
  event: async ({ event }) => {
    const blockId = process.env.WAVETERM_BLOCKID;
    const jwt = process.env.WAVETERM_JWT;
    if (!blockId || !jwt) return;
    const mapped = mapEvent(event);
    if (!mapped) return;
    report(mapped.state, mapped.phase);
  },
});

function mapEvent(event) {
  if (!event) return null;
  if (event.type === "permission.asked") return { state: "blocked", phase: "approval" };
  if (event.type === "permission.replied") return { state: "working", phase: "thinking" };
  if (event.type !== "session.status") return null;
  const statusType = event?.properties?.status?.type;
  if (statusType === "busy" || statusType === "retry") return { state: "working", phase: "thinking" };
  if (statusType === "idle") return { state: "idle", phase: "none" };
  return null;
}

function resolveWsh() {
  const bindir = process.env.WAVETERM_WSHBINDIR;
  const candidates = [];
  if (bindir) {
    candidates.push(bindir + "/wsh", bindir + "/wsh.exe");
  }
  if (process.platform === "win32") {
    candidates.push(
      (process.env.LOCALAPPDATA || "") + "\\snorkeling\\Data\\bin\\wsh.exe",
      (process.env.USERPROFILE || "") + "\\.snorkeling\\bin\\wsh.exe"
    );
  }
  candidates.push("wsh", "wsh.exe");
  return candidates.find((c) => c && exists(c)) || "wsh";
}

function exists(p) {
  try {
    return require("node:fs").existsSync(p);
  } catch {
    return false;
  }
}

function report(state, phase) {
  const wsh = resolveWsh();
  const args = [
    "agentstatus", state,
    "--provider", "opencode",
    "--source", "hook",
    "--phase", phase,
  ];
  // watchdog: a working report not renewed within 5min decays to stale
  if (state === "working") args.push("--ttl-ms", "300000");
  try {
    const { spawn } = require("node:child_process");
    const child = spawn(wsh, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {}
}
`, integrationIdMarker, HookTargetOpenCode, versionMarker, hookInstallVersion)
}

// piExtensionSource generates a Pi extension (auto-discovered from
// <agent-dir>/extensions/*.ts) that maps Pi lifecycle events to wsh agentstatus
// reports. It avoids importing the pi package (plain node builtins only) so the
// file loads without a local node_modules install.
//
// Watchdog design (see 20-AgentStatus错误识别与卡顿可视化方案):
//   - every working report carries a 5min TTL; renewal is EVENT-driven and
//     rate-limited (RENEW_MIN_MS), NOT a timer — a timer would keep renewing
//     while the provider request hangs, hiding the stuck state. A real hang
//     produces no events, so the TTL expires and the backend decays working to
//     stale.
//   - model errors are reported on their own "provider" source with a short
//     TTL, so they surface immediately (rank above working) without clobbering
//     the working report slot, and self-clear when the error passes.
func piExtensionSource() string {
	return fmt.Sprintf(`// installed by Snorkeling
// managed by Snorkeling; reinstalling the integration overwrites this file.
// %s%s
// %s%d

const TTL_MS = 300000;      // working reports expire after 5min without renewal
const ERROR_TTL_MS = 60000; // model-error reports self-clear after 1min
const RENEW_MIN_MS = 30000; // rate-limit event-driven working renewals

let lastRenewAt = 0;

export default function (pi) {
  pi.on("agent_start", () => report("working", "thinking", null, { ttlMs: TTL_MS }));
  pi.on("tool_call", (event) => report("working", "tool", event?.toolName, { ttlMs: TTL_MS }));
  // Renew on activity: streaming tokens, finished tools, finished turns. A hung
  // provider request fires none of these, so the working TTL runs out and the
  // status decays to stale instead of spinning forever.
  pi.on("message_update", () => renewWorking());
  pi.on("tool_execution_end", () => renewWorking());
  pi.on("turn_end", () => renewWorking());
  pi.on("agent_settled", () => report("idle", "none"));
  pi.on("session_shutdown", () => report("release", "none"));
  // after_provider_response only fires when an HTTP response actually arrives
  // (429/4xx/5xx); network hangs/timeouts never reach it — those are caught by
  // the watchdog TTL above. Success clears any outstanding model-error report.
  pi.on("after_provider_response", (event) => {
    const status = event && typeof event.status === "number" ? event.status : 0;
    if (status === 429) {
      report("rate-limited", "none", null, { ttlMs: ERROR_TTL_MS, source: "provider", reason: "model-http-429" });
    } else if (status >= 400) {
      report("error", "none", null, { ttlMs: ERROR_TTL_MS, source: "provider", reason: "model-http-" + status });
    } else if (status >= 200 && status < 400) {
      report("release", "none", null, { source: "provider" });
    }
  });
}

function renewWorking() {
  const now = Date.now();
  if (now - lastRenewAt < RENEW_MIN_MS) return;
  lastRenewAt = now;
  report("working", "thinking", null, { ttlMs: TTL_MS });
}

function resolveWsh() {
  const bindir = process.env.WAVETERM_WSHBINDIR;
  const candidates = [];
  if (bindir) {
    candidates.push(bindir + "/wsh", bindir + "/wsh.exe");
  }
  if (process.platform === "win32") {
    candidates.push(
      (process.env.LOCALAPPDATA || "") + "\\snorkeling\\Data\\bin\\wsh.exe",
      (process.env.USERPROFILE || "") + "\\.snorkeling\\bin\\wsh.exe"
    );
  }
  candidates.push("wsh", "wsh.exe");
  return candidates.find((c) => c && exists(c)) || "wsh";
}

function exists(p) {
  try {
    return require("node:fs").existsSync(p);
  } catch {
    return false;
  }
}

function report(state, phase, toolName, opts) {
  const wsh = resolveWsh();
  const args = ["agentstatus", state, "--provider", "pi", "--source", opts?.source || "hook", "--phase", phase];
  if (toolName) args.push("--tool", toolName);
  if (opts?.ttlMs) args.push("--ttl-ms", String(opts.ttlMs));
  if (opts?.reason) args.push("--reason", opts.reason);
  try {
    const { spawn } = require("node:child_process");
    const child = spawn(wsh, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {}
}
`, integrationIdMarker, HookTargetPi, versionMarker, hookInstallVersion)
}

func writeHookScript(path string, provider string) error {
	return writeHookScriptContent(path, agentStatusHookScript(provider))
}

func writeClaudeHookScript(path string) error {
	return writeHookScriptContent(path, agentStatusHookScript(HookTargetClaude))
}

func writeHookScriptContent(path string, content string) error {
	data := []byte(content)
	if runtime.GOOS == "windows" {
		// Normalize to CRLF so cmd.exe parses if/goto blocks reliably even
		// when the file is edited or rewritten by tooling that strips CR.
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		data = bytes.ReplaceAll(data, []byte("\n"), []byte("\r\n"))
	}
	if err := os.WriteFile(path, data, 0o755); err != nil {
		return err
	}
	return makeExecutable(path)
}

func hookInstallName() string {
	if runtime.GOOS == "windows" {
		return hookInstallBaseName + ".cmd"
	}
	return hookInstallBaseName + ".sh"
}

func claudeHookInstallName() string {
	if runtime.GOOS == "windows" {
		return hookInstallBaseName + ".ps1"
	}
	return hookInstallBaseName + ".sh"
}

type agentStatusHookSpec struct {
	event   string
	action  string
	phase   string
	matcher string
}

func codexHookSpecs() []agentStatusHookSpec {
	return []agentStatusHookSpec{
		{"SessionStart", StateIdle, PhaseNone, ""},
		{"UserPromptSubmit", StateWorking, PhaseThinking, ""},
		{"PreToolUse", StateWorking, PhaseTool, ""},
		{"PermissionRequest", StateBlocked, PhaseApproval, ""},
		{"Stop", StateIdle, PhaseNone, ""},
	}
}

func claudeHookSpecs() []agentStatusHookSpec {
	return []agentStatusHookSpec{
		{"SessionStart", StateIdle, PhaseNone, "*"},
		{"UserPromptSubmit", StateWorking, PhaseThinking, "*"},
		{"PreToolUse", StateWorking, PhaseTool, "*"},
		{"PermissionRequest", StateBlocked, PhaseApproval, "*"},
		{"Stop", StateIdle, PhaseNone, "*"},
		{"SessionEnd", StateRelease, PhaseNone, "*"},
	}
}

func hookCommand(path string, action string, phase string) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`cmd.exe /d /q /c ""%s" %s %s"`, path, action, phase)
	}
	return fmt.Sprintf("bash %s %s %s", shellSingleQuote(path), action, phase)
}

func codexHookCommand(path string, spec agentStatusHookSpec) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`cmd.exe /d /q /c "call ""%s"" %s %s >nul 2>nul & exit /b 0"`, path, spec.action, spec.phase)
	}
	return fmt.Sprintf("bash %s %s %s >/dev/null 2>&1; exit 0", shellSingleQuote(path), spec.action, spec.phase)
}

func claudeHookCommand(path string, action string, phase string) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`powershell -NoProfile -ExecutionPolicy Bypass -File "%s" "%s" "%s"`, path, action, phase)
	}
	return hookCommand(path, action, phase)
}

func agentStatusHookScript(provider string) string {
	if runtime.GOOS == "windows" {
		if provider == HookTargetClaude {
			return agentStatusPowerShellHookScript(provider)
		}
		return agentStatusBatchHookScript(provider)
	}
	return agentStatusShellHookScript(provider)
}

func agentStatusBatchHookScript(provider string) string {
	return fmt.Sprintf(`@echo off
rem installed by Snorkeling
rem managed by Snorkeling; reinstalling the integration overwrites this file.
rem %s%s
rem %s%d
rem ENTER line written before setlocal to distinguish cmd-not-started from call-parse-failure
if not "%%LOCALAPPDATA%%"=="" (echo [%%DATE%% %%TIME%%] ENTER provider=%s args=[%%~1] [%%~2] block=%%WAVETERM_BLOCKID%% cwd=%%CD%% >>"%%LOCALAPPDATA%%\snorkeling-agentstatus-hook.log" 2>nul) else if not "%%TEMP%%"=="" (echo [%%DATE%% %%TIME%%] ENTER provider=%s args=[%%~1] [%%~2] block=%%WAVETERM_BLOCKID%% cwd=%%CD%% >>"%%TEMP%%\snorkeling-agentstatus-hook.log" 2>nul)

setlocal
set "ACTION=%%~1"
set "PHASE=%%~2"
set "DEBUG_LOG="
if not "%%LOCALAPPDATA%%"=="" set "DEBUG_LOG=%%LOCALAPPDATA%%\snorkeling-agentstatus-hook.log"
if "%%DEBUG_LOG%%"=="" if not "%%TEMP%%"=="" set "DEBUG_LOG=%%TEMP%%\snorkeling-agentstatus-hook.log"
call :debug_log "alive provider=%s action=%%ACTION%% phase=%%PHASE%% block=%%WAVETERM_BLOCKID%% localappdata-set=%%LOCALAPPDATA%%-nonempty jwt-set=%%WAVETERM_JWT%%-nonempty cwd=%%CD%% wshbindir=%%WAVETERM_WSHBINDIR%%"
call :debug_log "start provider=%s action=%%ACTION%% phase=%%PHASE%%"

if "%%ACTION%%"=="" (
    call :debug_log "exit missing-action"
    exit /b 0
)
if not "%%ACTION%%"=="working" if not "%%ACTION%%"=="idle" if not "%%ACTION%%"=="blocked" if not "%%ACTION%%"=="release" if not "%%ACTION%%"=="unknown" (
    call :debug_log "exit invalid-action action=%%ACTION%%"
    exit /b 0
)
if "%%WAVETERM_BLOCKID%%"=="" (
    call :debug_log "exit missing-block"
    exit /b 0
)
if "%%WAVETERM_JWT%%"=="" (
    call :debug_log "exit missing-jwt block=%%WAVETERM_BLOCKID%%"
    exit /b 0
)
set "WSH_BIN="
if not "%%WAVETERM_WSHBINDIR%%"=="" if exist "%%WAVETERM_WSHBINDIR%%\wsh.exe" set "WSH_BIN=%%WAVETERM_WSHBINDIR%%\wsh.exe"
if not "%%WSH_BIN%%"=="" goto wsh_ready

for /f "delims=" %%%%I in ('where.exe wsh.exe 2^>nul') do (
    set "WSH_BIN=%%%%I"
    goto wsh_ready
)

if "%%LOCALAPPDATA%%"=="" goto check_userprofile_wsh
if exist "%%LOCALAPPDATA%%\snorkeling\Data\bin\wsh.exe" set "WSH_BIN=%%LOCALAPPDATA%%\snorkeling\Data\bin\wsh.exe"
if not "%%WSH_BIN%%"=="" goto wsh_ready

:check_userprofile_wsh
if "%%USERPROFILE%%"=="" (
    call :debug_log "exit missing-userprofile"
    exit /b 0
)
if exist "%%USERPROFILE%%\.snorkeling\bin\wsh.exe" set "WSH_BIN=%%USERPROFILE%%\.snorkeling\bin\wsh.exe"
if "%%WSH_BIN%%"=="" (
    call :debug_log "exit missing-wsh"
    exit /b 0
)

:wsh_ready

if "%%PHASE%%"=="thinking" goto report
if "%%PHASE%%"=="tool" goto report
if "%%PHASE%%"=="shell-command" goto report
if "%%PHASE%%"=="approval" goto report
if "%%PHASE%%"=="none" goto report
if "%%PHASE%%"=="unknown" goto report

if "%%ACTION%%"=="idle" set "PHASE=none"
if "%%ACTION%%"=="release" set "PHASE=none"
if "%%ACTION%%"=="blocked" set "PHASE=approval"
if "%%ACTION%%"=="working" set "PHASE=thinking"
if "%%ACTION%%"=="unknown" set "PHASE=unknown"

:report
call :debug_log "report provider=%s action=%%ACTION%% phase=%%PHASE%% block=%%WAVETERM_BLOCKID%% wsh=%%WSH_BIN%%"
if "%%ACTION%%"=="working" (
"%%WSH_BIN%%" agentstatus "%%ACTION%%" --provider "%s" --source hook --phase "%%PHASE%%" --ttl-ms 300000 <nul >nul 2>nul
) else (
"%%WSH_BIN%%" agentstatus "%%ACTION%%" --provider "%s" --source hook --phase "%%PHASE%%" <nul >nul 2>nul
)
set "WSH_EXIT=%%ERRORLEVEL%%"
call :debug_log "done exit=%%WSH_EXIT%%"
exit /b 0

:debug_log
if not "%%DEBUG_LOG%%"=="" echo [%%DATE%% %%TIME%%] %%~1>>"%%DEBUG_LOG%%" 2>nul
exit /b 0
`, integrationIdMarker, provider, versionMarker, hookInstallVersion, provider, provider, provider, provider, provider, provider, provider)
}

func agentStatusPowerShellHookScript(provider string) string {
	return fmt.Sprintf(`# installed by Snorkeling
# managed by Snorkeling; reinstalling the integration overwrites this file.
# %s%s
# %s%d

param(
    [string]$Action = "",
    [string]$Phase = ""
)

$fireLog = ""
if ($env:LOCALAPPDATA) {
    $fireLog = Join-Path $env:LOCALAPPDATA "snorkeling-agentstatus-hook.log"
} elseif ($env:TEMP) {
    $fireLog = Join-Path $env:TEMP "snorkeling-agentstatus-hook.log"
}
if ($fireLog) {
    $dateStr = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $fireLog -Value ("$dateStr [ENTER] provider=%s args=[$Action] [$Phase] block=$env:WAVETERM_BLOCKID cwd=$PWD") -ErrorAction SilentlyContinue
}

if ($Action -notin @("working", "idle", "blocked", "release", "unknown")) {
    exit 0
}

if ([string]::IsNullOrEmpty($env:WAVETERM_BLOCKID)) { exit 0 }
if ([string]::IsNullOrEmpty($env:WAVETERM_JWT)) { exit 0 }

$wshBin = ""
if ($env:WAVETERM_WSHBINDIR) {
    $candidate = Join-Path $env:WAVETERM_WSHBINDIR "wsh.exe"
    if (Test-Path $candidate -PathType Leaf) { $wshBin = $candidate }
}
if (-not $wshBin) {
    $found = Get-Command "wsh.exe" -ErrorAction SilentlyContinue
    if ($found) { $wshBin = $found.Source }
}
if (-not $wshBin -and $env:LOCALAPPDATA) {
    $candidate = Join-Path $env:LOCALAPPDATA "snorkeling\Data\bin\wsh.exe"
    if (Test-Path $candidate -PathType Leaf) { $wshBin = $candidate }
}
if (-not $wshBin -and $env:USERPROFILE) {
    $candidate = Join-Path $env:USERPROFILE ".snorkeling\bin\wsh.exe"
    if (Test-Path $candidate -PathType Leaf) { $wshBin = $candidate }
}
if (-not $wshBin) { exit 0 }

$validPhases = @("thinking", "tool", "shell-command", "approval", "none", "unknown")
if ($Phase -notin $validPhases) {
    if ($Action -eq "idle") { $Phase = "none" }
    elseif ($Action -eq "release") { $Phase = "none" }
    elseif ($Action -eq "blocked") { $Phase = "approval" }
    elseif ($Action -eq "working") { $Phase = "thinking" }
    else { $Phase = "unknown" }
}

if ($Action -eq "working") {
    & $wshBin agentstatus $Action --provider "%s" --source hook --phase $Phase --ttl-ms 300000 *> $null
} else {
    & $wshBin agentstatus $Action --provider "%s" --source hook --phase $Phase *> $null
}
exit $LASTEXITCODE
`, integrationIdMarker, provider, versionMarker, hookInstallVersion, provider, provider, provider)
}

func agentStatusShellHookScript(provider string) string {
	return fmt.Sprintf(`#!/bin/sh
# installed by Snorkeling
# managed by Snorkeling; reinstalling the integration overwrites this file.
# %s%s
# %s%d

action="${1:-}"
phase_arg="${2:-}"
case "$action" in
  working|idle|blocked|release|unknown) ;;
  *) exit 0 ;;
esac

[ -n "${WAVETERM_BLOCKID:-}" ] || exit 0
[ -n "${WAVETERM_JWT:-}" ] || exit 0

resolve_hook_path() {
  candidate="$1"
  if [ -e "$candidate" ]; then
    printf '%%s\n' "$candidate"
    return 0
  fi
  if command -v cygpath >/dev/null 2>&1; then
    converted="$(cygpath -u "$candidate" 2>/dev/null)"
    if [ -n "$converted" ] && [ -e "$converted" ]; then
      printf '%%s\n' "$converted"
      return 0
    fi
  fi
  if command -v wslpath >/dev/null 2>&1; then
    converted="$(wslpath -u "$candidate" 2>/dev/null)"
    if [ -n "$converted" ] && [ -e "$converted" ]; then
      printf '%%s\n' "$converted"
      return 0
    fi
  fi
  return 1
}

check_wsh_candidate() {
  candidate="$1"
  [ -n "$candidate" ] || return 1
  resolved="$(resolve_hook_path "$candidate")" || return 1
  [ -x "$resolved" ] || return 1
  wsh_bin="$resolved"
  return 0
}

wsh_bin=""
if [ -n "${WAVETERM_WSHBINDIR:-}" ]; then
  check_wsh_candidate "${WAVETERM_WSHBINDIR}/wsh" || check_wsh_candidate "${WAVETERM_WSHBINDIR}/wsh.exe" || true
fi
if [ -z "$wsh_bin" ] && command -v wsh >/dev/null 2>&1; then
  wsh_bin="$(command -v wsh)"
fi
if [ -z "$wsh_bin" ] && command -v wsh.exe >/dev/null 2>&1; then
  wsh_bin="$(command -v wsh.exe)"
fi
if [ -z "$wsh_bin" ] && [ -n "${LOCALAPPDATA:-}" ]; then
  check_wsh_candidate "${LOCALAPPDATA}\snorkeling\Data\bin\wsh.exe" || true
fi
if [ -z "$wsh_bin" ] && [ -n "${USERPROFILE:-}" ]; then
  check_wsh_candidate "${USERPROFILE}\.snorkeling\bin\wsh.exe" || true
fi
[ -n "$wsh_bin" ] || exit 0

hook_input_file="$(mktemp "${TMPDIR:-/tmp}/snorkeling-agent-status.XXXXXX")" || exit 0
trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
cat >"$hook_input_file" 2>/dev/null || true

if command -v python3 >/dev/null 2>&1; then
  SNORKELING_AGENT_ACTION="$action" \
  SNORKELING_AGENT_PHASE="$phase_arg" \
  SNORKELING_AGENT_PROVIDER="%s" \
  SNORKELING_HOOK_INPUT_FILE="$hook_input_file" \
  SNORKELING_WSH_BIN="$wsh_bin" \
  python3 - <<'PY'
import json
import os
import subprocess
import time

action = os.environ.get("SNORKELING_AGENT_ACTION", "")
phase_arg = os.environ.get("SNORKELING_AGENT_PHASE", "")
provider = os.environ.get("SNORKELING_AGENT_PROVIDER", "")
wsh_bin = os.environ.get("SNORKELING_WSH_BIN", "wsh")
hook_input_file = os.environ.get("SNORKELING_HOOK_INPUT_FILE", "")

hook_input = {}
if hook_input_file:
    try:
        with open(hook_input_file, encoding="utf-8") as handle:
            content = handle.read()
        if content.strip():
            hook_input = json.loads(content)
    except Exception:
        hook_input = {}

hook_event_name = str(hook_input.get("hook_event_name") or "")
if provider == "claude" and hook_event_name == "SubagentStop":
    raise SystemExit(0)
if provider == "claude" and hook_input.get("agent_id") and action in ("idle", "release"):
    raise SystemExit(0)

tool_name = hook_input.get("tool_name")
if not isinstance(tool_name, str):
    tool_name = ""
tool_name = tool_name.strip()

session_id = hook_input.get("session_id")
if not isinstance(session_id, str):
    session_id = ""
session_id = session_id.strip()

phase = phase_arg if phase_arg in ("thinking", "tool", "shell-command", "approval", "none", "unknown") else "unknown"
if phase == "unknown":
    if action in ("idle", "release"):
        phase = "none"
    elif action == "blocked":
        phase = "approval"
    elif action == "working":
        phase = "tool" if tool_name or hook_event_name == "PreToolUse" else "thinking"

cmd = [
    wsh_bin,
    "agentstatus",
    action,
    "--provider",
    provider,
    "--source",
    "hook",
    "--phase",
    phase,
    "--seq",
    str(time.time_ns()),
]
if tool_name:
    cmd.extend(["--tool", tool_name])
if session_id:
    cmd.extend(["--session-id", session_id])
if action == "working":
    # watchdog: a working report that is not renewed within 5min decays to stale
    cmd.extend(["--ttl-ms", "300000"])

try:
    subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
except Exception:
    pass
PY
else
  case "$phase_arg" in
    thinking|tool|shell-command|approval|none|unknown) phase="$phase_arg" ;;
    *) phase="unknown" ;;
  esac
  [ "$phase" = "unknown" ] && [ "$action" = "idle" ] && phase="none"
  [ "$phase" = "unknown" ] && [ "$action" = "release" ] && phase="none"
  [ "$phase" = "unknown" ] && [ "$action" = "blocked" ] && phase="approval"
  [ "$phase" = "unknown" ] && [ "$action" = "working" ] && phase="thinking"
  if [ "$action" = "working" ]; then
    "$wsh_bin" agentstatus "$action" --provider "%s" --source hook --phase "$phase" --ttl-ms 300000 >/dev/null 2>&1 || true
  else
    "$wsh_bin" agentstatus "$action" --provider "%s" --source hook --phase "$phase" >/dev/null 2>&1 || true
  fi
fi
`, integrationIdMarker, provider, versionMarker, hookInstallVersion, provider, provider, provider)
}

func configDirFromEnvOrHome(envName string, homeRelative string) (string, error) {
	if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
		return expandTilde(value)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, homeRelative), nil
}

// openCodeConfigDir returns the OpenCode global config directory (where plugins
// and opencode.json live). OpenCode resolves it as <xdgConfig>/opencode, honoring
// OPENCODE_CONFIG_DIR overrides. On Windows the default is %APPDATA%\opencode.
// The plugin subdir is auto-discovered by OpenCode, so no opencode.json edit is
// needed to enable the integration.
func openCodeConfigDir() (string, error) {
	if value := strings.TrimSpace(os.Getenv(openCodeConfigEnvVar)); value != "" {
		return expandTilde(value)
	}
	if runtime.GOOS == "windows" {
		if appData := strings.TrimSpace(os.Getenv("APPDATA")); appData != "" {
			return filepath.Join(appData, "opencode"), nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "AppData", "Roaming", "opencode"), nil
	}
	// XDG config home, fall back to ~/.config
	if xdg := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); xdg != "" {
		return filepath.Join(xdg, "opencode"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "opencode"), nil
}

// piAgentConfigDir returns the Pi agent config directory where global extensions are
// auto-discovered from <dir>/extensions/*.ts. Pi honors PI_CODING_AGENT_DIR; the
// default is ~/.pi/agent.
func piAgentConfigDir() (string, error) {
	if value := strings.TrimSpace(os.Getenv(piConfigEnvVar)); value != "" {
		return expandTilde(value)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".pi", "agent"), nil
}

func expandTilde(path string) (string, error) {
	if path == "~" {
		return os.UserHomeDir()
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, strings.TrimPrefix(path, "~/")), nil
	}
	return path, nil
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func readOptionalFile(path string) (string, error) {
	barr, err := os.ReadFile(path)
	if err == nil {
		return string(barr), nil
	}
	if os.IsNotExist(err) {
		return "", nil
	}
	return "", err
}

func readJSONObjectFile(path string) (map[string]any, error) {
	barr, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(barr))) == 0 {
		return map[string]any{}, nil
	}
	var data map[string]any
	if err := json.Unmarshal(barr, &data); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	if data == nil {
		data = map[string]any{}
	}
	return data, nil
}

func writeJSONFile(path string, data map[string]any) error {
	barr, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	barr = append(barr, '\n')
	return os.WriteFile(path, barr, 0o644)
}

func ensureHooksObject(data map[string]any, path string) (map[string]any, error) {
	rawHooks, found := data["hooks"]
	if !found {
		hooks := map[string]any{}
		data["hooks"] = hooks
		return hooks, nil
	}
	hooks, ok := rawHooks.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("hooks in %s must be a JSON object", path)
	}
	return hooks, nil
}

func ensureCommandHook(hooks map[string]any, event string, command string, timeout int, matcher string) error {
	entries, err := hookEntries(hooks[event], event)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		entryObj, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		hookList, ok := entryObj["hooks"].([]any)
		if !ok {
			continue
		}
		for _, hook := range hookList {
			hookObj, ok := hook.(map[string]any)
			if !ok {
				continue
			}
			if hookObj["type"] == "command" && hookObj["command"] == command {
				return nil
			}
		}
	}

	hook := map[string]any{
		"type":    "command",
		"command": command,
		"timeout": float64(timeout),
	}
	entry := map[string]any{
		"hooks": []any{hook},
	}
	if matcher != "" {
		entry["matcher"] = matcher
	}
	hooks[event] = append(entries, entry)
	return nil
}

func hookEntries(raw any, event string) ([]any, error) {
	if raw == nil {
		return []any{}, nil
	}
	entries, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("hook entries for %s must be a JSON array", event)
	}
	return entries, nil
}

func hookScriptVersion(script string) int {
	for _, line := range strings.Split(script, "\n") {
		line = strings.TrimSpace(line)
		for _, prefix := range []string{"#", "//", "rem"} {
			if strings.HasPrefix(line, prefix) {
				line = strings.TrimSpace(strings.TrimPrefix(line, prefix))
				break
			}
		}
		if !strings.HasPrefix(line, versionMarker) {
			continue
		}
		var version int
		if _, err := fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(line, versionMarker)), "%d", &version); err == nil {
			return version
		}
	}
	return 0
}

func commandHookInstalled(path string, event string, command string) bool {
	file, err := readJSONObjectFile(path)
	if err != nil {
		return false
	}
	hooks, err := ensureHooksObject(file, path)
	if err != nil {
		return false
	}
	entries, err := hookEntries(hooks[event], event)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		entryObj, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		hookList, ok := entryObj["hooks"].([]any)
		if !ok {
			continue
		}
		for _, hook := range hookList {
			hookObj, ok := hook.(map[string]any)
			if !ok {
				continue
			}
			if hookObj["type"] == "command" && hookObj["command"] == command {
				return true
			}
		}
	}
	return false
}

func pruneManagedCommandHooks(hooks map[string]any) {
	for event, rawEntries := range hooks {
		entries, ok := rawEntries.([]any)
		if !ok {
			continue
		}
		var keptEntries []any
		for _, entry := range entries {
			entryObj, ok := entry.(map[string]any)
			if !ok {
				keptEntries = append(keptEntries, entry)
				continue
			}
			hookList, ok := entryObj["hooks"].([]any)
			if !ok {
				keptEntries = append(keptEntries, entry)
				continue
			}
			var keptHooks []any
			for _, hook := range hookList {
				hookObj, ok := hook.(map[string]any)
				if !ok {
					keptHooks = append(keptHooks, hook)
					continue
				}
				if hookObj["type"] == "command" && isManagedHookCommand(fmt.Sprint(hookObj["command"])) {
					continue
				}
				keptHooks = append(keptHooks, hook)
			}
			if len(keptHooks) == 0 {
				continue
			}
			entryObj["hooks"] = keptHooks
			keptEntries = append(keptEntries, entryObj)
		}
		if len(keptEntries) == 0 {
			delete(hooks, event)
		} else {
			hooks[event] = keptEntries
		}
	}
}

func isManagedHookCommand(command string) bool {
	return strings.Contains(command, hookInstallBaseName+".sh") ||
		strings.Contains(command, hookInstallBaseName+".ps1") ||
		strings.Contains(command, hookInstallBaseName+".cmd")
}

func codexHookCommandsInstalled(hooksPath string, hookPath string) bool {
	for _, spec := range codexHookSpecs() {
		if !commandHookInstalled(hooksPath, spec.event, codexHookCommand(hookPath, spec)) {
			return false
		}
	}
	return true
}

func claudeHookCommandsInstalled(settingsPath string, hookPath string) bool {
	for _, spec := range claudeHookSpecs() {
		if !commandHookInstalled(settingsPath, spec.event, claudeHookCommand(hookPath, spec.action, spec.phase)) {
			return false
		}
	}
	return true
}

func codexConfigHooksEnabled(path string) bool {
	content, err := readOptionalFile(path)
	if err != nil {
		return false
	}
	inTopLevelFeatures := false
	for _, line := range strings.Split(content, "\n") {
		if header, ok := tomlTableHeader(line); ok {
			inTopLevelFeatures = header == "[features]"
			continue
		}
		if !inTopLevelFeatures || !isTOMLKey(line, "hooks") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "hooks"))
		value = strings.TrimSpace(strings.TrimPrefix(value, "="))
		return strings.EqualFold(value, "true")
	}
	return false
}

func buildCodexConfigWithHooks(content string) string {
	lines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	if content == "" {
		lines = nil
	}
	trailingNewline := strings.HasSuffix(content, "\n")
	inTopLevelFeatures := false
	featuresHeaderIndex := -1
	hooksIndex := -1
	var deprecatedIndexes []int
	for idx, line := range lines {
		if header, ok := tomlTableHeader(line); ok {
			inTopLevelFeatures = header == "[features]"
			if inTopLevelFeatures && featuresHeaderIndex == -1 {
				featuresHeaderIndex = idx
			}
			continue
		}
		if !inTopLevelFeatures {
			continue
		}
		if isTOMLKey(line, "codex_hooks") {
			deprecatedIndexes = append(deprecatedIndexes, idx)
		} else if isTOMLKey(line, "hooks") {
			hooksIndex = idx
		}
	}
	if hooksIndex >= 0 {
		lines[hooksIndex] = "hooks = true"
	}
	for idx := len(deprecatedIndexes) - 1; idx >= 0; idx-- {
		removeIdx := deprecatedIndexes[idx]
		lines = append(lines[:removeIdx], lines[removeIdx+1:]...)
	}
	if hooksIndex == -1 {
		if featuresHeaderIndex >= 0 {
			lines = append(lines[:featuresHeaderIndex+1], append([]string{"hooks = true"}, lines[featuresHeaderIndex+1:]...)...)
			return joinConfigLines(lines, trailingNewline)
		}
		result := strings.TrimRight(content, "\n")
		if result != "" {
			result += "\n\n"
		}
		return result + "[features]\nhooks = true\n"
	}
	return joinConfigLines(lines, trailingNewline)
}

func joinConfigLines(lines []string, trailingNewline bool) string {
	result := strings.Join(lines, "\n")
	if trailingNewline || result == "" {
		result += "\n"
	}
	return result
}

func tomlTableHeader(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "#") || !strings.HasPrefix(trimmed, "[") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "[[") {
		end := strings.Index(trimmed, "]]")
		if end < 0 {
			return "", false
		}
		header := trimmed[:end+2]
		return header, strings.TrimSpace(trimmed[end+2:]) == ""
	}
	end := strings.Index(trimmed, "]")
	if end < 0 {
		return "", false
	}
	header := trimmed[:end+1]
	return header, strings.TrimSpace(trimmed[end+1:]) == ""
}

func isTOMLKey(line string, key string) bool {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "#") || !strings.HasPrefix(trimmed, key) {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(trimmed[len(key):]), "=")
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func shellDoubleQuote(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func makeExecutable(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	return os.Chmod(path, info.Mode()|0o755)
}
