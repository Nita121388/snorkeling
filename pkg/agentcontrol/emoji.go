// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Session emoji control surface (emoji-preference track, design.md §3/§8.2):
//
//   - get:          read ai_session_props emoji + source + updatedAt
//   - set:          agent-channel write — source is always "ai", user-authored
//     values are skipped, --if-absent makes an existing slot an idempotent
//     no-op. Lands through the agentdata patch pipeline (audit + backup +
//     dry-run + hash preconditions built in).
//   - inject:       external agent pushes live recommendations for a session
//     (design §8.2: 所有推荐来源都是外部；内部只展示).
//   - recommendations: read the injected payload (found=false when absent or
//     expired → the picker hides the recommendation section).
//   - prefs:        preference counters for the external recommender to consult.
package agentcontrol

import (
	"context"

	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// SessionEmojiGet reads the session's backend emoji prop. Empty Emoji means
// the slot was never set (the frontend then falls through to localStorage /
// provider persona).
func SessionEmojiGet(ctx context.Context, req wshrpc.SessionEmojiGetRequest) (*wshrpc.SessionEmojiGetResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	summary, err := sessionSummaryForControl(ctx, identifier)
	if err != nil {
		return nil, err
	}
	result := &wshrpc.SessionEmojiGetResult{SessionKey: summary.Key, ID: summary.ID}
	if cell, ok := summary.Props["emoji"]; ok {
		if emoji, isString := cell.Value.(string); isString {
			result.Emoji = emoji
			result.Source = cell.Source
			result.UpdatedAt = cell.UpdatedAt
		}
	}
	return result, nil
}

// SessionEmojiSet writes the emoji through the agentdata patch pipeline. The
// stored source is always "ai" (ApplyAIProperties fixes it); a user-authored
// value is skipped unless Force. IfAbsent turns an existing slot into an
// idempotent no-op (E_CONFLICT_EXISTS on paper, skipped in practice — agents
// branch on changed=false + skipped, same as the card pipeline).
func SessionEmojiSet(ctx context.Context, req wshrpc.SessionEmojiSetRequest) (*wshrpc.SessionEmojiSetResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	summary, err := sessionSummaryForControl(ctx, identifier)
	if err != nil {
		return nil, err
	}

	normalized, err := aisessions.NormalizeEmoji(req.Emoji)
	if err != nil {
		return nil, newError(CodeInvalidEmoji, "invalid emoji %q", req.Emoji).
			WithHint("a valid emoji is one grapheme that renders as a color glyph; use --json for details")
	}

	dryRun := req.DryRun || !req.Yes
	// 拍板 #2: --if-absent alone is a valid precondition for a real write (it is
	// the "never overwrite" contract); without it we require hash/updatedAt.
	expectedHash := strings.TrimSpace(req.ExpectedHash)
	if !dryRun && !req.IfAbsent && expectedHash == "" && req.ExpectedUpdatedAt == 0 {
		return nil, newError(CodeUsage, "real apply requires a precondition").
			WithHint("pass --if-absent (idempotent never-overwrite) or --expected-hash from 'wsh session emoji get'")
	}

	prop := agentdata.PropPatch{Type: "text", Value: normalized, IfAbsent: req.IfAbsent}
	op := agentdata.PatchOperation{
		Type:              "session_emoji.update",
		SessionKey:        summary.Key,
		Props:             map[string]agentdata.PropPatch{"emoji": prop},
		ExpectedHash:      expectedHash,
		ExpectedUpdatedAt: req.ExpectedUpdatedAt,
		Force:             req.Force,
	}
	patch := agentdata.Patch{
		Version:    agentdata.PatchVersion,
		Source:     "wsh session emoji set",
		Operations: []agentdata.PatchOperation{op},
	}
	report, applyErr := agentdata.ApplyPatch(ctx, patch, agentdata.ApplyOptions{DryRun: dryRun, Yes: req.Yes})
	result := &wshrpc.SessionEmojiSetResult{DryRun: dryRun}
	if applyErr != nil {
		return result, mapEmojiApplyError(applyErr)
	}
	flattenEmojiSetReport(result, report)
	return result, nil
}

// SessionEmojiInject stores one external agent's live recommendations for the
// session, replacing any previous injection wholesale. Every candidate is
// validated (one invalid emoji rejects the whole injection); an empty
// candidates list clears the section (设计: 有就显示，没有就不显示).
func SessionEmojiInject(ctx context.Context, req wshrpc.SessionEmojiInjectRequest) (*wshrpc.SessionEmojiInjectResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	summary, err := sessionSummaryForControl(ctx, identifier)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.InjectedBy) == "" {
		return nil, newError(CodeUsage, "injectedBy is required").
			WithHint("identify the recommending agent, e.g. injected-by \"hero:watchdog\"")
	}
	candidates := make([]aisessions.EmojiRecommendationCandidate, 0, len(req.Candidates))
	for _, candidate := range req.Candidates {
		candidates = append(candidates, aisessions.EmojiRecommendationCandidate{
			Emoji:  candidate.Emoji,
			Reason: candidate.Reason,
		})
	}
	var ttl time.Duration
	if req.TTLSeconds > 0 {
		ttl = time.Duration(req.TTLSeconds) * time.Second
	}
	manager := aisessions.NewManager("", nil)
	if err := manager.SetEmojiRecommendations(ctx, summary.Key, req.InjectedBy, candidates, ttl); err != nil {
		return nil, newError(CodeInvalidEmoji, "%s", err.Error())
	}
	return &wshrpc.SessionEmojiInjectResult{SessionKey: summary.Key, Candidates: len(candidates)}, nil
}

// SessionEmojiRecommendations reads the current injected payload.
func SessionEmojiRecommendations(ctx context.Context, req wshrpc.SessionEmojiRecommendationsRequest) (*wshrpc.SessionEmojiRecommendationsResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	summary, err := sessionSummaryForControl(ctx, identifier)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	payload, found, err := manager.EmojiRecommendationsFor(ctx, summary.Key)
	if err != nil {
		return nil, newError(CodeInternal, "read recommendations: %s", err.Error())
	}
	result := &wshrpc.SessionEmojiRecommendationsResult{SessionKey: summary.Key, Found: found}
	if !found {
		return result, nil
	}
	result.InjectedBy = payload.InjectedBy
	result.InjectedAt = payload.InjectedAt
	result.ExpiresAt = payload.ExpiresAt
	for _, candidate := range payload.Candidates {
		result.Candidates = append(result.Candidates, wshrpc.SessionEmojiRecommendation{
			Emoji:  candidate.Emoji,
			Reason: candidate.Reason,
		})
	}
	return result, nil
}

// SessionEmojiPrefs reads the three preference buckets for the external
// recommender. The persona dim key follows 拍板 #1: props.hero when present,
// otherwise "provider:<source>".
func SessionEmojiPrefs(ctx context.Context, req wshrpc.SessionEmojiPrefsRequest) (*wshrpc.SessionEmojiPrefsResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	summary, err := sessionSummaryForControl(ctx, identifier)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	personaKey := personaDimKey(summary)
	// Read the three buckets without failing the whole call on a disabled index
	// (empty buckets are a valid "no preference history yet" answer).
	project, _ := manager.EmojiPrefsForDim(ctx, aisessions.EmojiPrefDimProject, summary.ProjectPath)
	persona, _ := manager.EmojiPrefsForDim(ctx, aisessions.EmojiPrefDimPersona, personaKey)
	global, _ := manager.EmojiPrefsForDim(ctx, aisessions.EmojiPrefDimGlobal, "")
	version, _ := manager.EmojiPrefVersion(ctx)
	return &wshrpc.SessionEmojiPrefsResult{
		SessionKey:  summary.Key,
		Project:     project,
		Persona:     persona,
		Global:      global,
		PrefVersion: version,
	}, nil
}

// personaDimKey implements 拍板 #1 (design.md §8.1): hero id when the session
// carries a props.hero, otherwise "provider:<source>".
func personaDimKey(summary aisessions.SessionSummary) string {
	if cell, ok := summary.Props["hero"]; ok {
		if heroID, isString := cell.Value.(string); isString && strings.TrimSpace(heroID) != "" {
			return strings.TrimSpace(heroID)
		}
	}
	return "provider:" + summary.Source
}

// sessionSummaryForControl resolves a session for the emoji commands with the
// stable E_NOT_FOUND shape the CLI/MCP branch on.
func sessionSummaryForControl(ctx context.Context, identifier string) (aisessions.SessionSummary, error) {
	manager := aisessions.NewManager("", nil)
	summary, err := manager.Summary(ctx, identifier, false)
	if err != nil {
		return aisessions.SessionSummary{}, newError(CodeNotFound, "session %q not found", identifier).
			WithHint("use 'wsh session list' or 'wsh session live' to find a session key or id")
	}
	return summary, nil
}

func flattenEmojiSetReport(result *wshrpc.SessionEmojiSetResult, report agentdata.Report) {
	for _, operation := range report.Operations {
		if operation.Target != "" {
			result.Target = operation.Target
		}
		if operation.Changed {
			result.Changed = true
		}
		result.Messages = append(result.Messages, operation.Messages...)
		result.Skipped = append(result.Skipped, operation.Skipped...)
		if operation.Error != "" {
			result.Messages = append(result.Messages, "error: "+operation.Error)
		}
	}
}

// mapEmojiApplyError turns agentdata failures into the stable control-surface
// codes agents branch on (card pipeline mapping + the emoji-specific codes).
func mapEmojiApplyError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "invalid emoji"):
		return newError(CodeInvalidEmoji, "%s", message)
	case strings.Contains(message, "exists (--if-absent)"):
		return newError(CodeConflictExists, "%s", message).
			WithHint("the slot already holds a value; this is an idempotent no-op")
	case strings.Contains(message, "user-authored"):
		return newError(CodeConflictUser, "%s", message).
			WithHint("the emoji is user-authored; re-run with --force to overwrite")
	}
	return mapApplyError(err)
}

// RecordEmojiPick records one UI hand-pick: the emoji prop written with
// source=user plus the three preference counters, in a single transaction
// (design.md §2.2/§3.3, prd.md R3). Empty Emoji is the "clear" action. This is
// the ONLY path that writes source=user — agent writes go through
// SessionEmojiSet (source=ai, no preference recorded).
func RecordEmojiPick(ctx context.Context, req wshrpc.SessionEmojiRecordPickRequest) (*wshrpc.SessionEmojiRecordPickResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	summary, err := sessionSummaryForControl(ctx, identifier)
	if err != nil {
		return nil, err
	}
	// Persona dim key per 拍板 #1: props.hero, else provider:<source>.
	personaKey := "provider:" + summary.Source
	if cell, ok := summary.Props["hero"]; ok {
		if heroID, isString := cell.Value.(string); isString && strings.TrimSpace(heroID) != "" {
			personaKey = strings.TrimSpace(heroID)
		}
	}
	manager := aisessions.NewManager("", nil)
	idx, err := manager.OpenSQLiteIndex()
	if err != nil {
		return nil, newError(CodeInternal, "open ai session index: %s", err.Error())
	}
	defer idx.Close()
	cleared := strings.TrimSpace(req.Emoji) == ""
	normalized := ""
	if !cleared {
		var err error
		normalized, err = aisessions.NormalizeEmoji(req.Emoji)
		if err != nil {
			return nil, newError(CodeInvalidEmoji, "invalid emoji %q", req.Emoji).
				WithHint("a valid emoji is one grapheme that renders as a color glyph")
		}
	}
	if err := idx.RecordEmojiPick(ctx, summary.Key, normalized, aisessions.EmojiPickDims{
		ProjectKey: summary.ProjectPath,
		PersonaKey: personaKey,
	}); err != nil {
		return nil, newError(CodeInternal, "record emoji pick: %s", err.Error())
	}
	return &wshrpc.SessionEmojiRecordPickResult{
		SessionKey: summary.Key,
		ID:         summary.ID,
		Emoji:      normalized,
		Cleared:    cleared,
	}, nil
}

// SessionEmojiPropsList returns every backend emoji prop (read-only) so an
// app window can hydrate its frontend backend-emoji layer at startup without
// loading the filtered AI Sessions list (design: session-emoji bootstrap, D1).
// ID is empty when the session row is gone; callers key by either form.
func SessionEmojiPropsList(ctx context.Context) (*wshrpc.SessionEmojiPropsListResult, error) {
	manager := aisessions.NewManager("", nil)
	idx, err := manager.OpenSQLiteIndex()
	if err != nil {
		return nil, newError(CodeInternal, "open ai session index: %s", err.Error())
	}
	defer idx.Close()
	rows, err := idx.EmojiPropsAll(ctx)
	if err != nil {
		return nil, newError(CodeInternal, "list emoji props: %s", err.Error())
	}
	result := &wshrpc.SessionEmojiPropsListResult{Entries: make([]wshrpc.SessionEmojiPropEntry, 0, len(rows))}
	for _, row := range rows {
		result.Entries = append(result.Entries, wshrpc.SessionEmojiPropEntry{
			SessionKey: row.SessionKey,
			ID:         row.ID,
			Emoji:      row.Emoji,
			Source:     row.Source,
			UpdatedAt:  row.UpdatedAt,
		})
	}
	return result, nil
}

// MigrateSessionEmojis replays legacy localStorage values into the backend
// (design.md §2.4, prd.md R1): each entry is written as source=user through the
// same pick pipeline — but ONLY when the session's emoji slot is empty
// (if-absent). Unknown sessions and already-set slots are reported in Skipped.
// Idempotent by construction: a repeat run sees the slot occupied and skips,
// and preferences were only recorded on the first success.
func MigrateSessionEmojis(ctx context.Context, req wshrpc.SessionEmojiMigrateRequest) (*wshrpc.SessionEmojiMigrateResult, error) {
	result := &wshrpc.SessionEmojiMigrateResult{}
	for _, entry := range req.Entries {
		identifier := strings.TrimSpace(entry.Identifier)
		if identifier == "" {
			result.Skipped = append(result.Skipped, wshrpc.SessionEmojiMigrationSkip{Reason: "empty identifier"})
			continue
		}
		summary, err := SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: identifier})
		if err != nil {
			// Resolution / read failure: keep the localStorage key for a retry.
			result.Skipped = append(result.Skipped, wshrpc.SessionEmojiMigrationSkip{Identifier: identifier, Reason: err.Error()})
			continue
		}
		if summary.Emoji != "" {
			result.Skipped = append(result.Skipped, wshrpc.SessionEmojiMigrationSkip{
				Identifier: identifier,
				Reason:     "emoji already set (skipped; no double-count)",
			})
			continue
		}
		cleaned, nErr := aisessions.NormalizeEmoji(entry.Emoji)
		if nErr != nil {
			result.Skipped = append(result.Skipped, wshrpc.SessionEmojiMigrationSkip{Identifier: identifier, Reason: "invalid emoji: " + nErr.Error()})
			continue
		}
		if _, err := RecordEmojiPick(ctx, wshrpc.SessionEmojiRecordPickRequest{Identifier: identifier, Emoji: cleaned}); err != nil {
			result.Skipped = append(result.Skipped, wshrpc.SessionEmojiMigrationSkip{Identifier: identifier, Reason: err.Error()})
			continue
		}
		result.Migrated = append(result.Migrated, wshrpc.SessionEmojiMigrationResult{
			Identifier: identifier,
			SessionKey: summary.SessionKey,
			Emoji:      cleaned,
		})
	}
	return result, nil
}
