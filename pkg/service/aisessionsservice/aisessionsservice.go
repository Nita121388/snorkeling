// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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

type AISessionsUserOutlineRequest struct {
	ID      string `json:"id"`
	Refresh bool   `json:"refresh,omitempty"`
	Limit   int    `json:"limit,omitempty"`
}

type AISessionsUserOutlineResponse struct {
	Summary          aisessions.SessionSummary `json:"summary"`
	Messages         []aisessions.Message      `json:"messages"`
	UserMessageCount int                       `json:"userMessageCount"`
}

type AISessionsSummaryRequest struct {
	ID      string `json:"id"`
	Refresh bool   `json:"refresh,omitempty"`
}

type AISessionsStatRequest struct {
	ID       string `json:"id,omitempty"`
	FilePath string `json:"filePath,omitempty"`
}

type AISessionsStatResponse struct {
	ID       string `json:"id,omitempty"`
	FilePath string `json:"filePath,omitempty"`
	MTime    int64  `json:"mtime,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Missing  bool   `json:"missing,omitempty"`
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

func (svc *AISessionsService) UserOutline_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load latest user messages for a local AI session outline",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session user outline",
	}
}

func (svc *AISessionsService) UserOutline(ctx context.Context, request *AISessionsUserOutlineRequest) (*AISessionsUserOutlineResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	detail, err := aisessions.NewManager("", nil).Load(ctx, request.ID, aisessions.LoadOptions{
		Refresh: request.Refresh,
	})
	if err != nil {
		return nil, err
	}
	messages, count := latestUserOutlineMessages(detail.Messages, request.Limit)
	return &AISessionsUserOutlineResponse{
		Summary:          detail.Summary,
		Messages:         messages,
		UserMessageCount: count,
	}, nil
}

func latestUserOutlineMessages(messages []aisessions.Message, limit int) ([]aisessions.Message, int) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	var latest []aisessions.Message
	count := 0
	for _, message := range messages {
		if message.Role != aisessions.RoleUser || strings.TrimSpace(message.Text) == "" {
			continue
		}
		count++
		if len(latest) < limit {
			latest = append(latest, message)
			continue
		}
		copy(latest, latest[1:])
		latest[len(latest)-1] = message
	}
	return latest, count
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

func isKnownAISessionFilePath(filePath string) bool {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" || !strings.EqualFold(filepath.Ext(filePath), ".jsonl") {
		return false
	}
	absPath, err := filepath.Abs(filepath.Clean(filePath))
	if err != nil {
		return false
	}
	var roots []string
	if codexRoot := aisessions.DefaultCodexSessionsDir(); codexRoot != "" {
		roots = append(roots, codexRoot)
	}
	roots = append(roots, aisessions.DefaultClaudeProjectDirs()...)
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		absRoot, err := filepath.Abs(filepath.Clean(root))
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(absRoot, absPath)
		if err != nil {
			continue
		}
		if rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (svc *AISessionsService) Stat_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "stat a local AI session file without loading messages",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session file stat",
	}
}

func (svc *AISessionsService) Stat(ctx context.Context, request *AISessionsStatRequest) (*AISessionsStatResponse, error) {
	if request == nil || (strings.TrimSpace(request.ID) == "" && strings.TrimSpace(request.FilePath) == "") {
		return nil, fmt.Errorf("session id or file path is required")
	}
	filePath := strings.TrimSpace(request.FilePath)
	if filePath == "" {
		summary, err := aisessions.NewManager("", nil).Summary(ctx, request.ID, false)
		if err != nil {
			return nil, err
		}
		filePath = summary.FilePath
	}
	if !isKnownAISessionFilePath(filePath) {
		return nil, fmt.Errorf("session file path is outside known AI session roots")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	stat, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return &AISessionsStatResponse{
				ID:       strings.TrimSpace(request.ID),
				FilePath: filePath,
				Missing:  true,
			}, nil
		}
		return nil, err
	}
	return &AISessionsStatResponse{
		ID:       strings.TrimSpace(request.ID),
		FilePath: filePath,
		MTime:    stat.ModTime().UnixMilli(),
		Size:     stat.Size(),
	}, nil
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
