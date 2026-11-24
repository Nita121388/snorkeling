// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

// Session restore for the Agent Control Surface (F-1121-agent-resume, design
// §3/§4). This file is the single backend implementation of the restore
// context the GUI has been building in
// pkg/service/aisessionsservice/aisessionsservice.go RestoreContext, plus the
// block meta builder that must stay field-for-field identical to the frontend
// restoreMetaForSession (frontend/app/view/aisessions/utils.ts:737). The parity
// test in restore_test.go locks the two together; change either side without
// the other and it goes red.

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// debugEnabled gates the restore-context debug lines (same env var the
// aisessionsservice debug lines use, so one flag turns on the whole trail).
func debugEnabled() bool {
	value := strings.TrimSpace(os.Getenv("WAVETERM_AI_SESSIONS_DEBUG"))
	return value != "" && value != "0" && strings.ToLower(value) != "false"
}

func debugf(format string, args ...any) {
	if debugEnabled() {
		log.Printf("[aisessions-debug] "+format, args...)
	}
}

// CodeVendorUnavailable mirrors the GUI's VendorConfigurationUnavailableError
// (aisessionsservice) as a stable agent-readable code. The message is the
// exact string the frontend matches on, so the service layer maps this code
// back to its own constant when it delegates (see ResolveVendorRestoreContext).
const CodeVendorUnavailable = "E_VENDOR_UNAVAILABLE"

// VendorConfigurationUnavailableMessage is byte-identical to
// aisessionsservice.VendorConfigurationUnavailableError so both surfaces agree.
const VendorConfigurationUnavailableMessage = "Vendor configuration is no longer available"

// RestoreContext is the backend twin of the frontend's
// AISessionsRestoreContextResponse: everything needed to rebuild one session's
// agent block. SessionId/Source/ProjectPath come from the summary; the
// ConfigDir/Vendor* trio is claude-vendor isolation detail (empty = plain
// claude with no cc-switch vendor); the Hero* trio is the owning hero identity
// (empty = the session belongs to no hero).
type RestoreContext struct {
	SessionId   string
	Source      string
	ProjectPath string
	ConfigDir   string
	VendorId    string
	VendorName  string
	// HeroId is the hero id (= home-base directory name); empty = no hero.
	HeroId string
	// HeroName is the plain display name (never carries the emoji prefix;
	// falls back to HeroId when hero.json's name is blank).
	HeroName string
	// HeroEmoji is the hero emoji; empty = do not stamp agent:emoji.
	HeroEmoji string
}

// Block meta keys stamped for a restored hero session. They mirror
// frontend/app/workspace/hero-launch.ts buildHeroLaunchBlockDef exactly (the
// launch path is the reference contract): hero identity is an identity of the
// block, so a resumed hero session displays like its stage entry instead of
// falling back to the provider logo + basename(cmd:cwd).
const (
	heroMetaKeyHero        = "hero"
	heroMetaKeyName        = "hero:name"
	heroMetaKeyDisplayName = "display:name"
	heroMetaKeyAgentEmoji  = "agent:emoji"
)

// resumeCmdBySource is the AgentResumeCmdBySource table from
// frontend/app/view/aisessions/utils.ts (restoreMetaForSession). The two tables
// must carry exactly these four rows; the parity test fixtures in
// restore_test.go lock one row each. Unlike the frontend's `?? "codex"`
// fallback, an unknown source is refused here (design D4): resuming a gemini
// session with the codex binary is a guaranteed wrong-agent launch, not a
// reasonable default.
var resumeCmdBySource = map[string]string{
	aisessions.SourceClaude:   "claude",
	aisessions.SourceCodex:    "codex",
	aisessions.SourceOpenCode: "opencode",
	aisessions.SourcePi:       "pi",
}

// ResolveRestoreContext resolves what a resume of this session needs: the
// session identity fields plus, for claude, the cc-switch vendor configuration
// the session was created under. Unknown sources are refused with E_USAGE
// (no silent codex fallback — design D4). Claude vendor resolution failure is
// E_VENDOR_UNAVAILABLE, the same verdict the GUI's RestoreContext RPC returns.
func ResolveRestoreContext(ctx context.Context, summary *aisessions.SessionSummary) (*RestoreContext, error) {
	if summary == nil {
		return nil, newError(CodeUsage, "session summary is required")
	}
	if _, known := resumeCmdBySource[summary.Source]; !known {
		return nil, newError(CodeUsage, "source %q has no known resume command", summary.Source).
			WithHint("resumable sources are claude/codex/opencode/pi; the GUI's codex fallback for other sources is a known defect, handled separately")
	}
	return ResolveVendorRestoreContext(ctx, summary)
}

// ResolveVendorRestoreContext is the claude-vendor resolution half of the old
// aisessionsservice.RestoreContext. It is shared (single implementation, no
// drift) but deliberately does NOT carry the unknown-source refusal: the GUI
// path must keep its historical behavior for non-resumable sources (frontend
// still falls back to the codex cmd there), while the CLI/MCP resume path
// refuses them (design D4, PRD non-goal "GUI 恢复链路改动").
func ResolveVendorRestoreContext(ctx context.Context, summary *aisessions.SessionSummary) (*RestoreContext, error) {
	restoreCtx := &RestoreContext{
		SessionId:   summary.ID,
		Source:      summary.Source,
		ProjectPath: summary.ProjectPath,
	}
	// Hero identity is resolved before the claude-vendor branch so both the GUI
	// RestoreContext RPC and the CLI/MCP resume path carry it from one place,
	// and vendor-specific refusals never depend on it. Best-effort: a missing
	// roster just leaves the trio empty (no hero stamping, today's behavior).
	if heroIdentity := ResolveHeroForSummary(summary); heroIdentity.ID != "" {
		restoreCtx.HeroId = heroIdentity.ID
		restoreCtx.HeroName = heroIdentity.Name
		restoreCtx.HeroEmoji = heroIdentity.Emoji
		debugf("RestoreContext hero key=%q hero=%q name=%q", summary.Key, heroIdentity.ID, heroIdentity.Name)
	}
	if summary.Source != aisessions.SourceClaude {
		return restoreCtx, nil
	}
	vendorID, configDir, vendorSession := ccswitch.ResolveClaudeVendorSessionPath(summary.FilePath)
	if !vendorSession {
		if summary.VendorID != "" || summary.ConfigDir != "" {
			return nil, newError(CodeVendorUnavailable, "%s", VendorConfigurationUnavailableMessage)
		}
		return restoreCtx, nil
	}
	if (summary.VendorID != "" && summary.VendorID != vendorID) ||
		(summary.ConfigDir != "" && !SameCleanPath(summary.ConfigDir, configDir)) {
		debugf("RestoreContext provenance mismatch key=%q vendor=%q file=%q", summary.Key, vendorID, summary.FilePath)
		return nil, newError(CodeVendorUnavailable, "%s", VendorConfigurationUnavailableMessage)
	}
	vendors, err := ccswitch.ListClaudeVendors(ctx)
	if err != nil || vendors == nil || !vendors.Detected {
		debugf("RestoreContext vendor list unavailable key=%q vendor=%q err=%v", summary.Key, vendorID, err)
		return nil, newError(CodeVendorUnavailable, "%s", VendorConfigurationUnavailableMessage)
	}
	for _, vendor := range vendors.Vendors {
		if vendor.ID != vendorID || vendor.ClaudeConfigDir == "" || !SameCleanPath(vendor.ClaudeConfigDir, configDir) {
			continue
		}
		if !regularVendorSettings(configDir) {
			break
		}
		restoreCtx.VendorId = vendorID
		restoreCtx.VendorName = vendor.Name
		restoreCtx.ConfigDir = configDir
		debugf("RestoreContext success key=%q vendor=%q configdir=%q", summary.Key, vendorID, configDir)
		return restoreCtx, nil
	}
	debugf("RestoreContext stale vendor key=%q vendor=%q file=%q", summary.Key, vendorID, summary.FilePath)
	return nil, newError(CodeVendorUnavailable, "%s", VendorConfigurationUnavailableMessage)
}

// isUsageError reports whether err is an agentcontrol usage error (E_USAGE).
// Used by the restore parity tests to assert refusal rather than a transport
// failure.
func isUsageError(err error) bool {
	var controlErr *Error
	if errors.As(err, &controlErr) {
		return controlErr.Code == CodeUsage
	}
	return false
}

// SameCleanPath compares two filesystem paths after Abs/Clean (case-insensitive
// on Windows). Shared by the restore context resolution; exported because
// aisessionsservice used to own this helper and still needs the identical
// comparison where it calls into this package.
func SameCleanPath(left string, right string) bool {
	leftAbs, leftErr := filepath.Abs(filepath.Clean(left))
	rightAbs, rightErr := filepath.Abs(filepath.Clean(right))
	if leftErr != nil || rightErr != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(leftAbs, rightAbs)
	}
	return leftAbs == rightAbs
}

// regularVendorSettings rejects a config dir that is a symlink (or whose
// settings.json is): a swapped vendor dir must fail the restore, not silently
// run under another identity.
func regularVendorSettings(configDir string) bool {
	configInfo, err := os.Lstat(configDir)
	if err != nil || !configInfo.IsDir() || configInfo.Mode()&os.ModeSymlink != 0 {
		return false
	}
	settingsInfo, err := os.Lstat(filepath.Join(configDir, "settings.json"))
	return err == nil && settingsInfo.Mode().IsRegular() && settingsInfo.Mode()&os.ModeSymlink == 0
}

// BuildResumeBlockMeta builds the block meta for a resumed agent block. It is
// the backend twin of restoreMetaForSession (frontend/app/view/aisessions/
// utils.ts): every key below must match that function field for field, and
// restore_test.go locks the contract with golden fixtures. cmd:cwd comes from
// the session's project path; cwdOverride (--cwd) wins when non-empty.
//
// The meta is consumed by the backend shellcontroller (agent:autoresume +
// agent:provider + agent:sessionid -> the provider's real resume args), so the
// block created by `wsh agent resume` is an ordinary autoresume agent block.
func BuildResumeBlockMeta(restoreCtx RestoreContext, cwdOverride string) waveobj.MetaMapType {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View:                    "term",
		waveobj.MetaKey_Controller:              "cmd",
		waveobj.MetaKey_Cmd:                     resumeCmdBySource[restoreCtx.Source],
		waveobj.MetaKey_CmdShell:                false,
		waveobj.MetaKey_CmdRunOnStart:           true,
		waveobj.MetaKey_CmdJwt:                  true,
		blockcontroller.MetaKey_AgentAutoResume: true,
		blockcontroller.MetaKey_AgentProvider:   restoreCtx.Source,
		blockcontroller.MetaKey_AgentSessionId:  restoreCtx.SessionId,
	}
	cwd := strings.TrimSpace(cwdOverride)
	if cwd == "" {
		cwd = strings.TrimSpace(restoreCtx.ProjectPath)
	}
	if cwd != "" {
		meta[waveobj.MetaKey_CmdCwd] = cwd
	}
	if restoreCtx.ConfigDir != "" {
		// map[string]any (not map[string]string): the parity test type-asserts
		// the JSON-decoded shape, and MetaMapType.GetMap treats both as equal.
		meta[waveobj.MetaKey_CmdEnv] = map[string]any{"CLAUDE_CONFIG_DIR": restoreCtx.ConfigDir}
		meta["agent:claudevendorid"] = restoreCtx.VendorId
		meta["agent:claudevendorname"] = restoreCtx.VendorName
	}
	applyHeroResumeMeta(meta, restoreCtx)
	return meta
}

// applyHeroResumeMeta stamps the owning hero identity onto a resumed block,
// matching frontend restoreMetaForSession / hero-launch.ts
// buildHeroLaunchBlockDef field for field. With no hero (HeroId empty) it
// writes nothing, so the zero-hero meta stays byte-identical to before this
// feature; the parity test locks both sides.
func applyHeroResumeMeta(meta waveobj.MetaMapType, restoreCtx RestoreContext) {
	heroID := strings.TrimSpace(restoreCtx.HeroId)
	if heroID == "" {
		return
	}
	meta[heroMetaKeyHero] = heroID
	name := strings.TrimSpace(restoreCtx.HeroName)
	if name == "" {
		name = heroID
	}
	// Plain name only: the emoji lives in agent:emoji (N-1119), otherwise the
	// header would render the same emoji twice.
	meta[heroMetaKeyName] = name
	meta[heroMetaKeyDisplayName] = name
	if emoji := strings.TrimSpace(restoreCtx.HeroEmoji); emoji != "" {
		meta[heroMetaKeyAgentEmoji] = emoji
	}
}
