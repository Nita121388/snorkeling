// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// AgentIsolationModeSystem is the only isolation mode v1 can produce: vendor
	// isolation (cc-switch per-block config dirs) is a separate package because it
	// needs the vendor catalogs, which the backend does not own today.
	AgentIsolationModeSystem = "system"

	// maxModelCandidates bounds the E_MODEL_NOT_IN_CATALOG hint so an agent with a
	// 20-model catalog (pi) does not get a wall of text back.
	maxModelCandidates = 20
)

// AgentLaunchCommand creates a TUI agent block (term block + agent:* meta) from
// the agent catalog. It is the programmatic twin of the GUI "New Agent" flow:
// the same catalog decides which commands and models are legal, and the block is
// created through the one existing write path (CreateBlockCommand), so the
// frontend sees exactly the same events as `wsh createblock` / `block open`.
//
// The caller can only choose *which* catalog entry to run, plus where. It can
// never inject a command, args or env: those come from the catalog only.
func (ws *WshServer) AgentLaunchCommand(ctx context.Context, data wshrpc.AgentLaunchRequest) (*wshrpc.AgentLaunchResult, error) {
	if err := validateLaunchConnection(data.Connection); err != nil {
		return nil, err
	}
	profile, resolvedModel, err := resolveLaunchProfile(data.Profile, data.Model)
	if err != nil {
		return nil, err
	}
	meta := buildAgentBlockMeta(profile, resolvedModel, data)

	// Resolve the target tab through the same path `block open` uses; a `new`
	// tab is created before any block exists, so a failure here writes nothing.
	tabId, err := resolveTabTarget(ctx, data.Tab, data.WorkspaceId)
	if err != nil {
		return nil, err
	}

	targetBlockId, targetAction, err := splitTargetAction(data.Split, "")
	if err != nil {
		return nil, err
	}
	if targetAction != "" && targetAction != "replace" && targetBlockId == "" {
		targetBlockId = lastBlockInTab(ctx, tabId)
	}

	oref, err := ws.CreateBlockCommand(ctx, wshrpc.CommandCreateBlockData{
		TabId:         tabId,
		BlockDef:      &waveobj.BlockDef{Meta: meta},
		Magnified:     data.Magnified,
		Focused:       !data.NoFocus,
		TargetBlockId: targetBlockId,
		TargetAction:  targetAction,
	})
	if err != nil {
		return nil, fmt.Errorf("create block: %w", err)
	}

	rtn := &wshrpc.AgentLaunchResult{
		Version:   wshrpc.AgentControlVersion,
		Ok:        true,
		TabId:     tabId,
		BlockId:   oref.OID,
		Profile:   profile.Name,
		Model:     resolvedModel,
		Cmd:       profile.Cmd,
		Args:      meta.GetStringArray(waveobj.MetaKey_CmdArgs),
		Isolation: AgentIsolationModeSystem,
		SyncState: BlockSyncStateDbOnly,
		Meta:      agentMetaEcho(meta),
	}

	if data.Wait {
		rtn.SyncState, rtn.WaitedMs, rtn.Warnings = waitForLayoutApplied(ctx, tabId, oref.OID, data.WaitMs, rtn.Warnings)
	}

	// One-shot "create + deliver". A text-delivery failure does not roll back the
	// block: the block exists and is usable, and the caller gets the block id back
	// inside the error path via the returned result only on success — so on error
	// we still return the partial result together with the error.
	if data.Send != nil {
		sendReq := *data.Send
		sendReq.BlockId = oref.OID
		sendRtn, sendErr := ws.AgentSendCommand(ctx, sendReq)
		rtn.Send = sendRtn
		if sendErr != nil {
			return rtn, sendErr
		}
	}
	return rtn, nil
}

// validateLaunchConnection rejects remote connections for now: block creation
// works there, but text injection over a remote PTY route has not been verified,
// and silently degrading would look like a successful send.
func validateLaunchConnection(conn string) error {
	c := strings.TrimSpace(conn)
	if c == "" || c == "local" || strings.HasPrefix(c, "local:") {
		return nil
	}
	return fmt.Errorf("E_UNSUPPORTED: --connection %q is not supported by agent launch yet (local only)", c)
}

// resolveLaunchProfile resolves a profile name + model against the catalog.
//
// Unknown profile names must be refused outright: agentcatalog.Resolve falls
// back to "run this binary with --model" for unknown names, which would turn a
// typo into arbitrary process execution.
func resolveLaunchProfile(name string, model string) (agentcatalog.ProfileInfo, string, error) {
	profileName := strings.TrimSpace(name)
	if profileName == "" {
		return agentcatalog.ProfileInfo{}, "", fmt.Errorf("E_USAGE: --profile is required")
	}
	catalog := agentcatalog.List()
	var found *agentcatalog.ProfileInfo
	names := make([]string, 0, len(catalog))
	for i := range catalog {
		names = append(names, catalog[i].Name)
		if catalog[i].Name == profileName {
			found = &catalog[i]
		}
	}
	if found == nil {
		return agentcatalog.ProfileInfo{}, "", fmt.Errorf(
			"E_PROFILE_UNKNOWN: profile %q is not in the agent catalog (known: %s)",
			profileName, strings.Join(names, ", "))
	}
	resolved, err := resolveLaunchModel(*found, model)
	if err != nil {
		return *found, "", err
	}
	return *found, resolved, nil
}

// resolveLaunchModel applies the model rules of design §4:
//   - empty -> profile default (may be empty: the block then runs without --model)
//   - exact models[].id match -> pass through unchanged (unless ambiguous, see
//     canonicalizeModelArg)
//   - provider/id -> must match a models[] entry with that provider and id
//   - anything else -> E_MODEL_NOT_IN_CATALOG with bounded candidates
func resolveLaunchModel(profile agentcatalog.ProfileInfo, model string) (string, error) {
	requested := strings.TrimSpace(model)
	if requested == "" {
		return canonicalizeModelArg(profile, strings.TrimSpace(profile.DefaultModel)), nil
	}
	if len(profile.Models) == 0 {
		return "", fmt.Errorf(
			"E_MODEL_NOT_IN_CATALOG: profile %q has no model list; omit --model to use the profile default",
			profile.Name)
	}
	// Exact id first: a catalog id may itself contain a slash, and matching the
	// literal string is always the least surprising interpretation.
	for _, m := range profile.Models {
		if m.Id == requested {
			return canonicalizeModelArg(profile, requested), nil
		}
	}
	if provider, id, ok := strings.Cut(requested, "/"); ok && provider != "" && id != "" {
		for _, m := range profile.Models {
			if m.Provider == provider && m.Id == id {
				return requested, nil
			}
		}
	}
	return "", fmt.Errorf("E_MODEL_NOT_IN_CATALOG: model %q is not in the %q catalog (candidates: %s)",
		requested, profile.Name, modelCandidateHint(profile.Models))
}

// canonicalizeModelArg turns a bare catalog id into `provider/id` whenever the
// catalog entry carries a provider.
//
// Why unconditionally: pi resolves a bare id against every *authenticated*
// provider, and its own default ("deepseek-v4.1-flash") is ambiguous across
// 8 providers in the user's pi config, so pi refuses to start with
// `Error: Model "..." is ambiguous across providers ... Use --provider or
// provider/model.` The catalog already knows the provider for that entry, so the
// launch — not the caller — supplies it. Profiles whose catalog entries carry no
// provider (claude / codex) are untouched, because those CLIs expect bare names.
//
// When several entries share the id, the Default-flagged one wins.
func canonicalizeModelArg(profile agentcatalog.ProfileInfo, model string) string {
	if model == "" || strings.Contains(model, "/") {
		return model
	}
	var match *agentcatalog.ModelInfo
	for i := range profile.Models {
		m := &profile.Models[i]
		if m.Id != model || m.Provider == "" {
			continue
		}
		if match == nil || (m.Default && !match.Default) {
			match = m
		}
	}
	if match != nil {
		return match.Provider + "/" + match.Id
	}
	return model
}

// modelCandidateHint renders a bounded, de-duplicated candidate list. `provider/id`
// entries are shown when the catalog carries a provider, because that is the form
// that survives a profile with duplicated model ids across providers.
func modelCandidateHint(models []agentcatalog.ModelInfo) string {
	seen := map[string]bool{}
	out := make([]string, 0, maxModelCandidates)
	for _, m := range models {
		label := m.Id
		if m.Provider != "" {
			label = m.Provider + "/" + m.Id
		}
		if label == "" || seen[label] {
			continue
		}
		seen[label] = true
		out = append(out, label)
		if len(out) >= maxModelCandidates {
			break
		}
	}
	if len(out) == 0 {
		return "none"
	}
	return strings.Join(out, ", ")
}

// buildAgentBlockMeta mirrors the frontend createAgentBlockDef meta contract
// (design §5). Keep the two in sync: a divergence here is a block that looks
// different depending on who created it.
func buildAgentBlockMeta(profile agentcatalog.ProfileInfo, resolvedModel string, data wshrpc.AgentLaunchRequest) waveobj.MetaMapType {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View:                    "term",
		waveobj.MetaKey_Controller:              "cmd",
		waveobj.MetaKey_Cmd:                     profile.Cmd,
		waveobj.MetaKey_CmdShell:                false,
		waveobj.MetaKey_CmdRunOnStart:           true,
		waveobj.MetaKey_CmdJwt:                  true,
		blockcontroller.MetaKey_AgentAutoResume: true,
		blockcontroller.MetaKey_AgentProvider:   agentProviderName(profile),
		agentIsolationModeMetaKey:               AgentIsolationModeSystem,
	}
	args := append([]string(nil), profile.Args...)
	if resolvedModel != "" {
		modelFlag := strings.TrimSpace(profile.ModelFlag)
		if modelFlag == "" {
			args = append(args, resolvedModel)
		} else {
			args = append(args, modelFlag, resolvedModel)
		}
		meta[agentRequestedModelMetaKey] = resolvedModel
	}
	if len(args) > 0 {
		meta[waveobj.MetaKey_CmdArgs] = args
	}
	if len(profile.Env) > 0 {
		env := make(map[string]string, len(profile.Env))
		for k, v := range profile.Env {
			env[k] = v
		}
		meta[waveobj.MetaKey_CmdEnv] = env
	}
	if cwd := strings.TrimSpace(data.Cwd); cwd != "" {
		meta[waveobj.MetaKey_CmdCwd] = cwd
	}
	if conn := strings.TrimSpace(data.Connection); conn != "" && conn != "local" {
		meta[waveobj.MetaKey_Connection] = conn
	}
	return meta
}

// agentProviderName mirrors the frontend resolveAgentProvider: the provider is the
// basename of the command, not the catalog key, so a profile named "claude-work"
// with cmd "claude" still lands as provider "claude".
func agentProviderName(profile agentcatalog.ProfileInfo) string {
	cmd := strings.ReplaceAll(strings.TrimSpace(profile.Cmd), "\\", "/")
	base := cmd
	if idx := strings.LastIndex(cmd, "/"); idx >= 0 {
		base = cmd[idx+1:]
	}
	base = strings.ToLower(base)
	for _, suffix := range []string{".exe", ".cmd", ".bat", ".ps1"} {
		base = strings.TrimSuffix(base, suffix)
	}
	if base != "" {
		return base
	}
	return profile.Name
}

// agentMetaEcho exposes the agent-relevant meta the caller may assert on, without
// leaking the whole map (which includes transport details the caller does not need).
func agentMetaEcho(meta waveobj.MetaMapType) map[string]any {
	echo := map[string]any{
		"view":                meta.GetString(waveobj.MetaKey_View, ""),
		"controller":          meta.GetString(waveobj.MetaKey_Controller, ""),
		"cmd":                 meta.GetString(waveobj.MetaKey_Cmd, ""),
		"cmd:shell":           meta.GetBool(waveobj.MetaKey_CmdShell, false),
		"cmd:runonstart":      meta.GetBool(waveobj.MetaKey_CmdRunOnStart, false),
		"cmd:jwt":             meta.GetBool(waveobj.MetaKey_CmdJwt, false),
		"agent:autoresume":    meta.GetBool(blockcontroller.MetaKey_AgentAutoResume, false),
		"agent:provider":      meta.GetString(blockcontroller.MetaKey_AgentProvider, ""),
		"agent:isolationmode": meta.GetString(agentIsolationModeMetaKey, ""),
	}
	if args := meta.GetStringArray(waveobj.MetaKey_CmdArgs); len(args) > 0 {
		echo["cmd:args"] = args
	}
	if model := meta.GetString(agentRequestedModelMetaKey, ""); model != "" {
		echo["agent:requestedmodel"] = model
	}
	if cwd := meta.GetString(waveobj.MetaKey_CmdCwd, ""); cwd != "" {
		echo["cmd:cwd"] = cwd
	}
	if env := meta.GetStringMap(waveobj.MetaKey_CmdEnv, false); len(env) > 0 {
		envCopy := make(map[string]any, len(env))
		for k, v := range env {
			envCopy[k] = v
		}
		echo["cmd:env"] = envCopy
	}
	return echo
}

// agentIsolationModeMetaKey / agentRequestedModelMetaKey live in blockcontroller's
// shell controller constants today; they are duplicated here because those
// constants are unexported there and the meta contract is owned by this handler.
const (
	agentIsolationModeMetaKey  = "agent:isolationmode"
	agentRequestedModelMetaKey = "agent:requestedmodel"
)

// resolveTabTarget is the shared tab resolution used by `block open` and
// `agent launch`: active tab of the current workspace, a brand new tab, or an
// explicitly verified tab id.
func resolveTabTarget(ctx context.Context, tab string, workspaceId string) (string, error) {
	switch tab {
	case "", "active":
		client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
		if err != nil {
			return "", fmt.Errorf("E_NO_ROUTE: no active window")
		}
		if len(client.WindowIds) == 0 {
			return "", fmt.Errorf("E_NO_ROUTE: no active window")
		}
		win, err := wcore.GetWindow(ctx, client.WindowIds[0])
		if err != nil {
			return "", err
		}
		wsObj, err := wcore.GetWorkspace(ctx, win.WorkspaceId)
		if err != nil {
			return "", err
		}
		if wsObj.ActiveTabId == "" {
			return "", fmt.Errorf("E_NO_ROUTE: no active tab")
		}
		return wsObj.ActiveTabId, nil
	case "new":
		wsId := workspaceId
		if wsId == "" {
			client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
			if err != nil || len(client.WindowIds) == 0 {
				return "", fmt.Errorf("E_NO_ROUTE: no active window for --tab new")
			}
			win, err := wcore.GetWindow(ctx, client.WindowIds[0])
			if err != nil {
				return "", err
			}
			wsId = win.WorkspaceId
		}
		newTabId, err := wcore.CreateTab(ctx, wsId, "", true, false)
		if err != nil {
			return "", err
		}
		return newTabId, nil
	default:
		if _, err := wstore.DBMustGet[*waveobj.Tab](ctx, tab); err != nil {
			return "", fmt.Errorf("E_NOT_FOUND: tab %q not found", tab)
		}
		return tab, nil
	}
}

// waitForLayoutApplied polls until the frontend has consumed the layout action.
// `db-only` is deliberately not a success state: the row exists as soon as the
// backend writes it, long before the block is on screen.
func waitForLayoutApplied(ctx context.Context, tabId string, blockId string, waitMs int, warnings []string) (syncState string, waitedMs int, outWarnings []string) {
	if waitMs <= 0 {
		waitMs = 5000
	}
	start := time.Now()
	deadline := start.Add(time.Duration(waitMs) * time.Millisecond)
	for time.Now().Before(deadline) {
		if wcore.LayoutAppliedToFrontend(ctx, tabId, blockId) {
			return BlockSyncStateLayoutApplied, int(time.Since(start).Milliseconds()), warnings
		}
		time.Sleep(100 * time.Millisecond)
	}
	return BlockSyncStateLayoutQueued, int(time.Since(start).Milliseconds()), append(warnings, "layout-not-applied")
}
