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

// AISessionsSessionInfoRequest is the layer-0 size probe: enough metadata to
// pick a read strategy, no content.
type AISessionsSessionInfoRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	Origin     string `json:"origin,omitempty"`
	// Refresh re-parses this one session's messages when the message index is
	// stale (single-file, no directory scan) before probing.
	Refresh bool `json:"refresh,omitempty"`
}

// AISessionsSessionUsersRequest is the layer-1 paged user-prompt read.
type AISessionsSessionUsersRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	Origin     string `json:"origin,omitempty"`
	// Limit defaults to 20, max 100.
	Limit int `json:"limit,omitempty"`
	// BeforeSeq pages older (seq < BeforeSeq); 0 starts from the newest.
	BeforeSeq int `json:"beforeSeq,omitempty"`
	// Refresh re-parses this one session's messages when the message index is
	// stale (single-file, no directory scan) before reading.
	Refresh bool `json:"refresh,omitempty"`
}

// AISessionsSessionTurnsRequest is the layer-2 paged turn-summary read.
type AISessionsSessionTurnsRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	Origin     string `json:"origin,omitempty"`
	// Limit must be passed explicitly and be within 1-10 (design §5 gate).
	Limit int `json:"limit"`
	// BeforeTurn pages older turns (turn < BeforeTurn); 0 starts from the newest.
	BeforeTurn int `json:"beforeTurn,omitempty"`
	// Refresh re-parses this one session's messages when the message index is
	// stale (single-file, no directory scan) before reading.
	Refresh bool `json:"refresh,omitempty"`
}

// AISessionsSessionTurnRequest is the layer-3 single-turn original-message read.
type AISessionsSessionTurnRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	Origin     string `json:"origin,omitempty"`
	// Turn is the 1-based turn number (see AISessionsSessionTurnsRequest rows).
	Turn int `json:"turn"`
	// Chars must be passed explicitly and be within 1-8000 (design §5 gate).
	Chars int `json:"chars"`
	// Refresh re-parses this one session's messages when the message index is
	// stale (single-file, no directory scan) before reading.
	Refresh bool `json:"refresh,omitempty"`
}

func (svc *AISessionsService) SessionInfo_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "probe one AI session's size (counts/bytes/verdict) without loading content",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session size info",
	}
}

// SessionInfo returns the size probe for one session (small/medium/large plus
// counts). It never loads message content.
func (svc *AISessionsService) SessionInfo(ctx context.Context, request *AISessionsSessionInfoRequest) (*aisessions.SessionReadInfo, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForScope(ctx, request.ID, request.Connection, request.Origin)
	if err != nil {
		return nil, err
	}
	info, err := manager.ReadInfo(ctx, request.ID, request.Refresh)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

func (svc *AISessionsService) SessionUsers_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "read one page of user prompts from an AI session",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session user prompt page",
	}
}

func (svc *AISessionsService) SessionUsers(ctx context.Context, request *AISessionsSessionUsersRequest) (*aisessions.SessionUserPage, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForScope(ctx, request.ID, request.Connection, request.Origin)
	if err != nil {
		return nil, err
	}
	page, err := manager.ReadUsers(ctx, request.ID, request.BeforeSeq, request.Limit, request.Refresh)
	if err != nil {
		return nil, err
	}
	return &page, nil
}

func (svc *AISessionsService) SessionTurns_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "read one page of AI session turn summaries (requires explicit limit 1-10)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session turn page",
	}
}

func (svc *AISessionsService) SessionTurns(ctx context.Context, request *AISessionsSessionTurnsRequest) (*aisessions.SessionTurnPage, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForScope(ctx, request.ID, request.Connection, request.Origin)
	if err != nil {
		return nil, err
	}
	page, err := manager.ReadTurns(ctx, request.ID, request.BeforeTurn, request.Limit, request.Refresh)
	if err != nil {
		return nil, err
	}
	return &page, nil
}

func (svc *AISessionsService) SessionTurn_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "read one AI session turn's original messages under a chars budget (requires explicit chars 1-8000)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session turn messages",
	}
}

func (svc *AISessionsService) SessionTurn(ctx context.Context, request *AISessionsSessionTurnRequest) (*aisessions.SessionTurnMessages, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForScope(ctx, request.ID, request.Connection, request.Origin)
	if err != nil {
		return nil, err
	}
	result, err := manager.ReadTurn(ctx, request.ID, request.Turn, request.Chars, request.Refresh)
	if err != nil {
		return nil, err
	}
	return &result, nil
}
