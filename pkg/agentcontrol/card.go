// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Session card read/write for the Agent Control Surface.
//
// Design rule (design/plans/agent-control-surface.md §6.5, §13 P0.1): there is
// no second write path. `agent card set` translates its flags into a single
// agentdata.Patch and lets agentdata.Apply do validation, dry-run, backup,
// audit and preconditions. Anything that would need to bypass that pipeline is
// out of scope by construction.
package agentcontrol

import (
	"context"
	"errors"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// ResolveSessionIdentifier expands the CLI's `this` shorthand into a session id.
// It is shared by every card command so they all resolve identically.
func ResolveSessionIdentifier(ctx context.Context, identifier string, blockId string) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		identifier = "this"
	}
	if identifier != "this" {
		return identifier, nil
	}
	if strings.TrimSpace(blockId) == "" {
		return "", newError(CodeUsage, "no block context for 'this'").
			WithHint("run inside a Snorkeling agent block or pass an explicit session key")
	}
	return ResolveSessionForBlock(ctx, blockId)
}

// GetAgentCard returns the card view of one session.
func GetAgentCard(ctx context.Context, req wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	summary, err := manager.Summary(ctx, identifier, false)
	if err != nil {
		return nil, newError(CodeNotFound, "session %q not found", identifier).
			WithHint("use 'wsh session list' or 'wsh session live' to find a session key")
	}
	record := wshrpc.SessionLiveRecord{}
	applySummary(&record, summary)
	return &wshrpc.AgentCardResult{
		Version:     wshrpc.AgentControlVersion,
		SessionKey:  summary.Key,
		SessionId:   summary.ID,
		Provider:    summary.Source,
		Summary:     record.Card,
		Title:       summary.Title,
		TitleSource: summary.TitleSource,
		Persona:     nil,
		Hash:        agentdata.HashSession(summary),
		UpdatedAt:   summary.UpdatedAt,
	}, nil
}

// SetAgentCard translates the request into agentdata patch operations and runs
// them through the shared apply pipeline.
func SetAgentCard(ctx context.Context, req wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	summary, err := manager.Summary(ctx, identifier, false)
	if err != nil {
		return nil, newError(CodeNotFound, "session %q not found", identifier).
			WithHint("use 'wsh session list' or 'wsh session live' to find a session key")
	}

	operations, err := buildCardOperations(summary.Key, req)
	if err != nil {
		return nil, err
	}
	if len(operations) == 0 {
		return nil, newError(CodeUsage, "nothing to set").
			WithHint("pass --note, --tags-*, --title or --prop")
	}

	// Real apply requires an explicit confirmation and a precondition. Both are
	// enforced again inside agentdata; failing early keeps the message readable.
	dryRun := req.DryRun || !req.Yes
	expectedHash := strings.TrimSpace(req.ExpectedHash)
	if !dryRun && expectedHash == "" && req.ExpectedUpdatedAt == 0 {
		return nil, newError(CodeUsage, "real apply requires a precondition").
			WithHint("run without --yes first to preview, then pass --expected-hash from 'wsh agent card get'")
	}
	for idx := range operations {
		if operations[idx].ExpectedHash == "" && operations[idx].ExpectedUpdatedAt == 0 {
			operations[idx].ExpectedHash = expectedHash
			operations[idx].ExpectedUpdatedAt = req.ExpectedUpdatedAt
		}
	}

	patch := agentdata.Patch{
		Version:    agentdata.PatchVersion,
		Source:     "wsh agent card set",
		Operations: operations,
	}
	report, applyErr := agentdata.ApplyPatch(ctx, patch, agentdata.ApplyOptions{
		DryRun: dryRun,
		Yes:    req.Yes,
	})
	result := flattenCardReport(report, dryRun)
	if applyErr != nil {
		return result, mapApplyError(applyErr)
	}
	return result, nil
}

// buildCardOperations maps the request onto patch operations. Note/tags share
// one operation (they are stored together); title and props are separate
// operations so each keeps its own precondition and force semantics.
func buildCardOperations(sessionKey string, req wshrpc.AgentCardSetRequest) ([]agentdata.PatchOperation, error) {
	var operations []agentdata.PatchOperation

	if req.Note != nil || req.Tags != nil {
		op := agentdata.PatchOperation{Type: "session_note.update", SessionKey: sessionKey, Note: req.Note}
		if req.Tags != nil {
			op.Tags = &agentdata.TagPatch{
				Set:    req.Tags.Set,
				Add:    req.Tags.Add,
				Remove: req.Tags.Remove,
			}
		}
		operations = append(operations, op)
	}

	if req.Title != nil {
		title := *req.Title
		operations = append(operations, agentdata.PatchOperation{
			Type:       "session_title.update",
			SessionKey: sessionKey,
			Title:      &title,
			Force:      req.Force,
		})
	}

	if len(req.Props) > 0 {
		props := make(map[string]agentdata.PropPatch, len(req.Props))
		for key, prop := range req.Props {
			props[key] = agentdata.PropPatch{Type: prop.Type, Value: prop.Value, Name: prop.Name}
		}
		operations = append(operations, agentdata.PatchOperation{
			Type:       "session_prop.update",
			SessionKey: sessionKey,
			Props:      props,
			Force:      req.Force,
		})
	}

	return operations, nil
}

func flattenCardReport(report agentdata.Report, dryRun bool) *wshrpc.AgentCardSetResult {
	result := &wshrpc.AgentCardSetResult{DryRun: dryRun}
	for _, operation := range report.Operations {
		if operation.Target != "" {
			result.Target = operation.Target
		}
		if operation.Changed {
			result.Changed = true
		}
		for _, change := range operation.Changes {
			result.Changes = append(result.Changes, wshrpc.AgentCardChangeReport{
				Field:  change.Field,
				Before: change.Before,
				After:  change.After,
			})
		}
		result.Messages = append(result.Messages, operation.Messages...)
		result.Skipped = append(result.Skipped, operation.Skipped...)
		if operation.Error != "" {
			result.Messages = append(result.Messages, "error: "+operation.Error)
		}
	}
	for _, backup := range report.Backups {
		result.BackupIds = append(result.BackupIds, backup.ID)
	}
	return result
}

// mapApplyError turns agentdata failures into the stable control-surface codes
// agents branch on.
func mapApplyError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	switch {
	case errors.Is(err, aisessions.ErrTitleProtected) || strings.Contains(message, "title conflict"):
		return newError(CodeConflict, "%s", message).
			WithHint("the existing title is user-authored; re-run with --force to overwrite")
	case strings.Contains(message, "hash mismatch"), strings.Contains(message, "updatedAt mismatch"):
		return newError(CodeConflict, "%s", message).
			WithHint("the session card changed since you read it; re-read the hash and retry")
	case strings.Contains(message, "requires expectedHash"):
		return newError(CodeUsage, "%s", message).
			WithHint("pass --expected-hash from 'wsh agent card get'")
	case strings.Contains(message, "not found"):
		return newError(CodeNotFound, "%s", message)
	case strings.Contains(message, "unsupported property type"),
		strings.Contains(message, "unsupported type"),
		strings.Contains(message, "unknown field"),
		strings.Contains(message, "is required"),
		strings.Contains(message, "has an empty property key"):
		return newError(CodeUsage, "%s", message)
	default:
		return newError(CodeInternal, "%s", message)
	}
}
