// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Machine annotation writes (`wsh session annotate` / MCP
// snorkeling_session_annotate). External agents read a session and want to
// write their conclusions back to the timeline; this file is the only write
// path for that, and it is deliberately narrower than AnnotationSave:
//
//   - source is always "ai" (a machine never claims to be the user),
//   - status defaults to draft and "accepted" needs an explicit force,
//   - a repeat write at (session, kind, anchor) replaces the previous machine
//     row in place (count does not grow) and never touches other drafts,
//   - a protected row (source=user or source=ai with user_edited=1) at the
//     same (kind, anchor) is refused outright.
//
// The first two live in PrepareMachineAnnotation; the write semantics live in
// UpsertMachineAnnotation; the precondition/dry-run gate lives in
// ApplyMachineAnnotation. All of them are shared by the service RPC and the
// Agent Control Surface so the two cannot drift.
package aisessions

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	// ErrAnnotationProtected means the existing row is human-owned: either it
	// was authored by a user, or an AI draft was edited by a human. Machine
	// writes never overwrite it (there is no force override).
	ErrAnnotationProtected = errors.New("annotation is protected (user-authored or human-edited)")
	// ErrAnnotationAnchorNotFound means the requested anchorKey does not exist
	// in the session's current anchor set. Hallucinated keys never hit storage.
	ErrAnnotationAnchorNotFound = errors.New("annotation anchor not found")
	// ErrAnnotationStatusInvalid means status is neither draft nor accepted.
	ErrAnnotationStatusInvalid = errors.New("invalid annotation status")
	// ErrAnnotationStatusNeedsForce means a machine tried to store status=accepted.
	ErrAnnotationStatusNeedsForce = errors.New("accepted status requires force")
	// ErrAnnotationHashRequired means a real write omitted the card hash.
	ErrAnnotationHashRequired = errors.New("expected hash is required for a real write")
	// ErrAnnotationHashMismatch means the caller's card hash is stale.
	ErrAnnotationHashMismatch = errors.New("expected hash does not match the current card")
)

// MachineAnnotationRequest is the input shared by the service RPC and the ACS.
// The identifier is a session key / id (already resolved; "this" is an ACS
// concern handled before this layer).
type MachineAnnotationRequest struct {
	Identifier string
	Anchor     string
	Kind       string
	Title      string
	Body       string
	Tags       []string
	Status     string
	Force      bool
	AIModel    string
}

// MachineAnnotationPlan is a validated anchor + row that has not been written
// yet. Summary is returned so the caller can compute the card hash
// (agentdata.HashSession) without a second session lookup.
type MachineAnnotationPlan struct {
	Summary       SessionSummary
	Anchor        AnnotationAnchor
	AnchorPreview string
	Row           AnnotationRow
}

// MachineAnnotationOutcome is the result of ApplyMachineAnnotation, covering
// both the dry-run and the written case.
type MachineAnnotationOutcome struct {
	DryRun            bool
	Written           bool
	Created           bool
	Row               AnnotationRow
	ReplacedID        int64
	ReplacedUpdatedAt int64
}

// PrepareMachineAnnotation resolves the summary + one anchor and builds the row
// that would be written. It performs every non-precondition validation in one
// place, so the service and the ACS cannot disagree about "draft by default" or
// "accepted needs force".
func PrepareMachineAnnotation(ctx context.Context, manager *Manager, req MachineAnnotationRequest) (MachineAnnotationPlan, error) {
	identifier := strings.TrimSpace(req.Identifier)
	if identifier == "" {
		return MachineAnnotationPlan{}, fmt.Errorf("session id is required")
	}
	anchor := strings.TrimSpace(req.Anchor)
	if anchor == "" {
		return MachineAnnotationPlan{}, fmt.Errorf("annotation anchor is required")
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status == "" {
		status = AnnotationStatusDraft
	}
	switch status {
	case AnnotationStatusDraft:
	case AnnotationStatusAccepted:
		if !req.Force {
			return MachineAnnotationPlan{}, fmt.Errorf("%w: pass force to store an accepted annotation", ErrAnnotationStatusNeedsForce)
		}
	default:
		return MachineAnnotationPlan{}, fmt.Errorf("%w: %q", ErrAnnotationStatusInvalid, req.Status)
	}

	summary, err := manager.Summary(ctx, identifier, false)
	if err != nil {
		return MachineAnnotationPlan{}, err
	}
	detail, err := LoadAnnotationDetail(ctx, manager, summary.Key)
	if err != nil {
		return MachineAnnotationPlan{}, err
	}
	target, preview, err := ResolveAnnotationAnchorTarget(detail.Messages, detail.ToolCalls, anchor)
	if err != nil {
		return MachineAnnotationPlan{}, err
	}

	row := AnnotationRow{
		SessionKey:    summary.Key,
		AnchorKey:     target.AnchorKey,
		Seq:           target.Seq,
		Kind:          normalizeAnnotationKind(req.Kind),
		Title:         req.Title,
		Body:          req.Body,
		Tags:          req.Tags,
		Status:        status,
		Source:        AnnotationSourceAI,
		UserEdited:    false,
		AIModel:       strings.TrimSpace(req.AIModel),
		AnchorHash:    target.Hash,
		AnchorPreview: preview,
	}
	return MachineAnnotationPlan{
		Summary:       summary,
		Anchor:        target,
		AnchorPreview: preview,
		Row:           row,
	}, nil
}

// ApplyMachineAnnotation enforces the optimistic lock and, when dryRun is
// false, performs the single-row write. currentHash is the card hash the caller
// just read (agentdata.HashSession(summary)); expectedHash is what the caller
// echoed back. Dry-run applies the same hash check when expectedHash is given.
func (m *Manager) ApplyMachineAnnotation(
	ctx context.Context,
	plan MachineAnnotationPlan,
	currentHash string,
	expectedHash string,
	dryRun bool,
) (MachineAnnotationOutcome, error) {
	expectedHash = strings.TrimSpace(expectedHash)
	if expectedHash != "" && expectedHash != strings.TrimSpace(currentHash) {
		return MachineAnnotationOutcome{}, fmt.Errorf("%w: expected %s, current %s", ErrAnnotationHashMismatch, expectedHash, currentHash)
	}
	if !dryRun && expectedHash == "" {
		return MachineAnnotationOutcome{}, fmt.Errorf("%w: read the card hash first", ErrAnnotationHashRequired)
	}
	if dryRun {
		// A dry-run must answer the same questions as the real write without
		// writing: would it create (created=true) or replace which row, and is
		// the target protected? Reads only; no transaction, no write.
		outcome := MachineAnnotationOutcome{DryRun: true, Written: false, Created: true, Row: plan.Row}
		rows, err := m.ListAnnotations(ctx, plan.Row.SessionKey)
		if err != nil {
			return MachineAnnotationOutcome{}, err
		}
		var existing *AnnotationRow
		for i := range rows {
			candidate := &rows[i]
			if candidate.Kind != plan.Row.Kind || candidate.AnchorKey != plan.Row.AnchorKey {
				continue
			}
			if existing == nil || candidate.ID > existing.ID {
				existing = candidate
			}
		}
		if existing != nil {
			if !CanReplace(*existing) {
				return MachineAnnotationOutcome{}, fmt.Errorf("%w: annotation %d at %s", ErrAnnotationProtected, existing.ID, existing.AnchorKey)
			}
			outcome.Created = false
			outcome.ReplacedID = existing.ID
			outcome.ReplacedUpdatedAt = existing.UpdatedAt
		}
		return outcome, nil
	}
	outcome, err := m.UpsertMachineAnnotation(ctx, plan.Row)
	if err != nil {
		return MachineAnnotationOutcome{}, err
	}
	outcome.DryRun = false
	outcome.Written = true
	return outcome, nil
}

// UpsertMachineAnnotation writes one machine annotation in a single
// transaction. The latest row at the same (session_key, kind, anchor_key) is
// deleted and replaced only when CanReplace allows it; a user-authored or
// human-edited row is refused with ErrAnnotationProtected and nothing changes.
//
// The open transaction owns the single pooled connection, so every query here
// must go through tx (querying idx.db would deadlock).
func (idx *SQLiteIndex) UpsertMachineAnnotation(ctx context.Context, row AnnotationRow) (MachineAnnotationOutcome, error) {
	row.SessionKey = strings.TrimSpace(row.SessionKey)
	row.AnchorKey = strings.TrimSpace(row.AnchorKey)
	if row.SessionKey == "" || row.AnchorKey == "" {
		return MachineAnnotationOutcome{}, fmt.Errorf("session key and anchor key are required")
	}
	row.Kind = normalizeAnnotationKind(row.Kind)
	// Strict status: anything other than ""/draft/accepted is refused rather than
	// silently normalized. normalizeAnnotationStatus maps junk to "accepted";
	// a machine write must never land as accepted because of a typo upstream.
	switch strings.ToLower(strings.TrimSpace(row.Status)) {
	case "", AnnotationStatusDraft:
		row.Status = AnnotationStatusDraft
	case AnnotationStatusAccepted:
		row.Status = AnnotationStatusAccepted
	default:
		return MachineAnnotationOutcome{}, fmt.Errorf("%w: %q", ErrAnnotationStatusInvalid, row.Status)
	}
	// A machine entry is always source=ai and starts unedited.
	row.Source = AnnotationSourceAI
	row.UserEdited = false
	row.Body = clampAnnotationBody(row.Body)
	if row.Tags != nil {
		row.TagsJSON = annotationTagsJSON(row.Tags)
	}

	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return MachineAnnotationOutcome{}, err
	}
	defer func() { _ = tx.Rollback() }()

	outcome := MachineAnnotationOutcome{Created: true}
	// Look at every row at this identity, not just source='ai': a user-authored
	// row at the same (kind, anchor) must refuse the machine write rather than
	// stack a second opinion next to it (AC: source=user is protected).
	identityRows, err := tx.QueryContext(ctx,
		`SELECT `+annotationColumns+` FROM ai_session_annotations
		 WHERE session_key = ? AND kind = ? AND anchor_key = ?
		 ORDER BY id DESC`,
		row.SessionKey, row.Kind, row.AnchorKey)
	if err != nil {
		return MachineAnnotationOutcome{}, err
	}
	var existing []AnnotationRow
	for identityRows.Next() {
		scanned, scanErr := scanAnnotationRow(identityRows)
		if scanErr != nil {
			identityRows.Close()
			return MachineAnnotationOutcome{}, scanErr
		}
		existing = append(existing, scanned)
	}
	if closeErr := identityRows.Close(); closeErr != nil {
		return MachineAnnotationOutcome{}, closeErr
	}
	if scanErr := identityRows.Err(); scanErr != nil {
		return MachineAnnotationOutcome{}, scanErr
	}
	if len(existing) > 0 {
		// Replace only what the frozen rule allows; user rows and human-edited
		// AI rows are refused outright (no force override).
		newest := existing[0]
		if !CanReplace(newest) {
			return MachineAnnotationOutcome{}, fmt.Errorf("%w: annotation %d at %s", ErrAnnotationProtected, newest.ID, newest.AnchorKey)
		}
		// The newest row decides replace vs create; every other CanReplace row at
		// the same identity is redundant machine output (AnnotationSave can stack
		// duplicates), so it is converged here too — the count must not grow.
		for _, old := range existing {
			if !CanReplace(old) {
				continue
			}
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM ai_session_annotations WHERE id = ? AND session_key = ?`, old.ID, row.SessionKey); err != nil {
				return MachineAnnotationOutcome{}, err
			}
		}
		outcome.Created = false
		outcome.ReplacedID = newest.ID
		outcome.ReplacedUpdatedAt = newest.UpdatedAt
	}

	now := time.Now().UnixMilli()
	row.ID = 0
	row.CreatedAt = now
	row.UpdatedAt = now
	result, err := tx.ExecContext(ctx,
		`INSERT INTO ai_session_annotations
			(session_key, anchor_key, seq, kind, title, body, tags_json, status, source, user_edited,
			 ai_model, anchor_hash, anchor_preview, node_text, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		row.SessionKey, row.AnchorKey, row.Seq, row.Kind, row.Title, row.Body,
		annotationTagsJSON(decodeAnnotationTags(row.TagsJSON)), row.Status, row.Source,
		0, row.AIModel, row.AnchorHash, row.AnchorPreview, clampAnnotationNodeText(row.NodeText), now, now)
	if err != nil {
		return MachineAnnotationOutcome{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return MachineAnnotationOutcome{}, err
	}
	if err := tx.Commit(); err != nil {
		return MachineAnnotationOutcome{}, err
	}
	row.ID = id
	row.Tags = decodeAnnotationTags(row.TagsJSON)
	outcome.Row = row
	return outcome, nil
}

// UpsertMachineAnnotation is the Manager wrapper (opens/closes the index).
func (m *Manager) UpsertMachineAnnotation(ctx context.Context, row AnnotationRow) (MachineAnnotationOutcome, error) {
	var outcome MachineAnnotationOutcome
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		outcome, inner = idx.UpsertMachineAnnotation(ctx, row)
		return inner
	})
	return outcome, err
}
