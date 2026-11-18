// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionAnnotate is the service-side machine annotation write entry point.
// It shares validation, anchoring and storage with the Agent Control Surface
// (`pkg/agentcontrol/session_annotate.go`), so the GUI RPC and `wsh session
// annotate` cannot disagree about draft/force/hash semantics.
package aisessionsservice

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

// AISessionsSessionAnnotateRequest writes one machine annotation draft.
// Source is deliberately absent: this entry point is always source=ai.
type AISessionsSessionAnnotateRequest struct {
	ID           string   `json:"id"`
	Anchor       string   `json:"anchor"`
	Kind         string   `json:"kind,omitempty"`
	Title        string   `json:"title,omitempty"`
	Body         string   `json:"body,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	Status       string   `json:"status,omitempty"`
	Force        bool     `json:"force,omitempty"`
	ExpectedHash string   `json:"expectedHash,omitempty"`
	DryRun       bool     `json:"dryRun,omitempty"`
	Connection   string   `json:"connection,omitempty"`
	Origin       string   `json:"origin,omitempty"`
	AIModel      string   `json:"aiModel,omitempty"`
}

// AISessionsSessionAnnotatePreview describes what the writer resolved/would touch.
type AISessionsSessionAnnotatePreview struct {
	AnchorKey         string `json:"anchorKey"`
	AnchorPreview     string `json:"anchorPreview,omitempty"`
	AnchorRole        string `json:"anchorRole,omitempty"`
	Seq               int    `json:"seq"`
	ReplacedID        int64  `json:"replacedId,omitempty"`
	ReplacedUpdatedAt int64  `json:"replacedUpdatedAt,omitempty"`
}

// AISessionsSessionAnnotateResult reports the (possibly dry-run) outcome.
type AISessionsSessionAnnotateResult struct {
	DryRun  bool                             `json:"dryRun"`
	Written bool                             `json:"written"`
	Created bool                             `json:"created"`
	Row     *aisessions.AnnotationView       `json:"row,omitempty"`
	Preview AISessionsSessionAnnotatePreview `json:"preview"`
}

func (svc *AISessionsService) SessionAnnotate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "write one machine annotation draft (source=ai, status=draft by default, accepted needs force, real write needs the card hash)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "dry-run preview or the written annotation row plus replaced id",
	}
}

func (svc *AISessionsService) SessionAnnotate(ctx context.Context, request *AISessionsSessionAnnotateRequest) (*AISessionsSessionAnnotateResult, error) {
	if request == nil || request.ID == "" {
		return nil, fmt.Errorf("E_USAGE: session id is required")
	}
	manager, err := svc.managerForScope(ctx, request.ID, request.Connection, request.Origin)
	if err != nil {
		return nil, err
	}
	plan, err := aisessions.PrepareMachineAnnotation(ctx, manager, aisessions.MachineAnnotationRequest{
		Identifier: request.ID,
		Anchor:     request.Anchor,
		Kind:       request.Kind,
		Title:      request.Title,
		Body:       request.Body,
		Tags:       request.Tags,
		Status:     request.Status,
		Force:      request.Force,
		AIModel:    request.AIModel,
	})
	if err != nil {
		return nil, err
	}
	outcome, err := manager.ApplyMachineAnnotation(ctx, plan, agentdata.HashSession(plan.Summary), request.ExpectedHash, request.DryRun)
	if err != nil {
		return nil, err
	}
	result := &AISessionsSessionAnnotateResult{
		DryRun:  outcome.DryRun,
		Written: outcome.Written,
		Created: outcome.Created,
		Preview: AISessionsSessionAnnotatePreview{
			AnchorKey:         plan.Anchor.AnchorKey,
			AnchorPreview:     plan.AnchorPreview,
			AnchorRole:        plan.Anchor.Role,
			Seq:               plan.Anchor.Seq,
			ReplacedID:        outcome.ReplacedID,
			ReplacedUpdatedAt: outcome.ReplacedUpdatedAt,
		},
	}
	view := outcome.Row.ToView(false)
	result.Row = &view
	return result, nil
}
