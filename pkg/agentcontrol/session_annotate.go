// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Session timeline annotation write for the Agent Control Surface
// (`wsh session annotate`, MCP snorkeling_session_annotate).
//
// The rules live in pkg/aisessions (PrepareMachineAnnotation /
// ApplyMachineAnnotation); this file only resolves the session identifier,
// computes the card hash precondition, converts the outcome to the wire shape
// and maps errors to stable ACS codes.
package agentcontrol

import (
	"context"
	"errors"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// SessionAnnotate writes one machine annotation draft. It resolves `this` from
// the calling block, then delegates to AnnotateSessionWithManager.
func SessionAnnotate(ctx context.Context, req wshrpc.SessionAnnotateRequest) (*wshrpc.SessionAnnotateResult, error) {
	identifier, err := ResolveSessionIdentifier(ctx, req.Identifier, req.BlockId)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	return AnnotateSessionWithManager(ctx, manager, identifier, req)
}

// AnnotateSessionWithManager is the storage-facing assembly shared with the
// service RPC path. identifier must already be a concrete session key/id.
func AnnotateSessionWithManager(ctx context.Context, manager *aisessions.Manager, identifier string, req wshrpc.SessionAnnotateRequest) (*wshrpc.SessionAnnotateResult, error) {
	plan, err := aisessions.PrepareMachineAnnotation(ctx, manager, aisessions.MachineAnnotationRequest{
		Identifier: identifier,
		Anchor:     req.Anchor,
		Kind:       req.Kind,
		Title:      req.Title,
		Body:       req.Body,
		Tags:       req.Tags,
		Status:     req.Status,
		Force:      req.Force,
		AIModel:    req.AIModel,
	})
	if err != nil {
		return nil, annotateError(err)
	}

	dryRun := req.DryRun || !req.Yes
	outcome, err := manager.ApplyMachineAnnotation(ctx, plan, agentdata.HashSession(plan.Summary), req.ExpectedHash, dryRun)
	if err != nil {
		return nil, annotateError(err)
	}

	preview := wshrpc.SessionAnnotatePreview{
		AnchorKey:         plan.Anchor.AnchorKey,
		AnchorPreview:     plan.AnchorPreview,
		AnchorRole:        plan.Anchor.Role,
		Seq:               plan.Anchor.Seq,
		ReplacedID:        outcome.ReplacedID,
		ReplacedUpdatedAt: outcome.ReplacedUpdatedAt,
	}
	return &wshrpc.SessionAnnotateResult{
		DryRun:  outcome.DryRun,
		Written: outcome.Written,
		Created: outcome.Created,
		Row:     annotateRowToWire(outcome.Row),
		Preview: preview,
	}, nil
}

func annotateRowToWire(row aisessions.AnnotationRow) wshrpc.SessionAnnotateRow {
	return wshrpc.SessionAnnotateRow{
		ID:         row.ID,
		AnchorKey:  row.AnchorKey,
		Seq:        row.Seq,
		Kind:       row.Kind,
		Title:      row.Title,
		Body:       row.Body,
		Tags:       row.Tags,
		Status:     row.Status,
		Source:     row.Source,
		AIModel:    row.AIModel,
		AnchorHash: row.AnchorHash,
		UpdatedAt:  row.UpdatedAt,
	}
}

// annotateError maps the shared write errors to the stable codes agents branch
// on. The order matters: hash and protection sentinels carry their own hints.
func annotateError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	switch {
	case errors.Is(err, aisessions.ErrAnnotationHashMismatch):
		return newError(CodeConflict, "%s", message).
			WithHint("the session card changed since you read it; re-read the hash and retry")
	case errors.Is(err, aisessions.ErrAnnotationHashRequired):
		return newError(CodeUsage, "%s", message).
			WithHint("run `wsh session get <id> --json` and pass its card.hash as --expected-hash")
	case errors.Is(err, aisessions.ErrAnnotationProtected):
		return newError(CodeConflict, "%s", message).
			WithHint("a human authored or edited this annotation; it is never overwritten by a machine write")
	case errors.Is(err, aisessions.ErrAnnotationStatusNeedsForce):
		return newError(CodeUsage, "%s", message).
			WithHint("omit --status or keep it draft; a machine cannot accept its own annotation")
	case errors.Is(err, aisessions.ErrAnnotationStatusInvalid):
		return newError(CodeUsage, "%s", message).
			WithHint("status must be draft or accepted")
	case errors.Is(err, aisessions.ErrAnnotationAnchorNotFound):
		return newError(CodeNotFound, "%s", message).
			WithHint("use --anchor tail or an itemKey from `wsh session turn`")
	}
	switch {
	case strings.Contains(message, "session id is required"),
		strings.Contains(message, "annotation anchor is required"):
		return newError(CodeUsage, "%s", message)
	case strings.Contains(message, "not found"):
		return newError(CodeNotFound, "%s", message).
			WithHint("use `wsh session list` or `wsh session live` to find a session key")
	default:
		return newError(CodeInternal, "%s", message)
	}
}
