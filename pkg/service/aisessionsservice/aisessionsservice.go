// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

type AISessionsService struct{}

type AISessionsListRequest struct {
	Source     string `json:"source,omitempty"`
	Project    string `json:"project,omitempty"`
	Query      string `json:"query,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	Refresh    bool   `json:"refresh,omitempty"`
	MarkedOnly bool   `json:"markedOnly,omitempty"`
}

type AISessionsListResponse struct {
	Sessions []aisessions.SessionSummary `json:"sessions"`
}

type AISessionsDetailRequest struct {
	ID           string `json:"id"`
	Refresh      bool   `json:"refresh,omitempty"`
	Tail         int    `json:"tail,omitempty"`
	IncludeTools bool   `json:"includeTools,omitempty"`
}

type AISessionsSummaryRequest struct {
	ID      string `json:"id"`
	Refresh bool   `json:"refresh,omitempty"`
}

func (svc *AISessionsService) List_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list local AI sessions",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session summaries",
	}
}

func (svc *AISessionsService) List(ctx context.Context, request *AISessionsListRequest) (*AISessionsListResponse, error) {
	if request == nil {
		request = &AISessionsListRequest{}
	}
	limit := request.Limit
	if limit == 0 {
		limit = 100
	}
	manager := aisessions.NewManager("", nil)
	sessions, err := manager.ScanList(ctx, aisessions.ListOptions{
		Source:     request.Source,
		Project:    request.Project,
		Limit:      limit,
		MarkedOnly: request.MarkedOnly,
	}, request.Query)
	if err != nil {
		return nil, err
	}
	return &AISessionsListResponse{Sessions: sessions}, nil
}

func (svc *AISessionsService) Detail_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load a local AI session detail",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session detail",
	}
}

func (svc *AISessionsService) Detail(ctx context.Context, request *AISessionsDetailRequest) (*aisessions.SessionDetail, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	detail, err := aisessions.NewManager("", nil).Load(ctx, request.ID, aisessions.LoadOptions{
		Refresh:      request.Refresh,
		IncludeTools: request.IncludeTools,
	})
	if err != nil {
		return nil, err
	}
	tail := request.Tail
	if tail > 0 && len(detail.Messages) > tail {
		detail.Messages = detail.Messages[len(detail.Messages)-tail:]
	}
	return &detail, nil
}

func (svc *AISessionsService) Summary_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load a local AI session summary without loading messages",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session summary",
	}
}

func (svc *AISessionsService) Summary(ctx context.Context, request *AISessionsSummaryRequest) (*aisessions.SessionSummary, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	summary, err := aisessions.NewManager("", nil).Summary(ctx, request.ID, request.Refresh)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) Mark_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "mark or unmark a local AI session",
		ArgNames:   []string{"ctx", "id", "marked"},
		ReturnDesc: "updated AI session summary",
	}
}

func (svc *AISessionsService) Mark(ctx context.Context, id string, marked bool) (*aisessions.SessionSummary, error) {
	summary, err := aisessions.NewManager("", nil).Mark(ctx, id, marked)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) Note_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "set a local AI session note",
		ArgNames:   []string{"ctx", "id", "note"},
		ReturnDesc: "updated AI session summary",
	}
}

func (svc *AISessionsService) Note(ctx context.Context, id string, note string) (*aisessions.SessionSummary, error) {
	summary, err := aisessions.NewManager("", nil).Note(ctx, id, note)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) Delete_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "delete a local AI session by moving its source file to deleted storage",
		ArgNames:   []string{"ctx", "id"},
		ReturnDesc: "deleted AI session summary",
	}
}

func (svc *AISessionsService) Delete(ctx context.Context, id string) (*aisessions.SessionSummary, error) {
	summary, err := aisessions.NewManager("", nil).Delete(ctx, id)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}
