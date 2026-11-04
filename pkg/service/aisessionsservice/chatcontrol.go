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

// AISessionsChatControlRequest is used by the ChatAbort / ChatClose RPC
// methods that the frontend calls to manage a live chat session.
type AISessionsChatControlRequest struct {
	Source    string `json:"source"`
	SessionID string `json:"sessionId"`
}

// AISessionsLiveSessionStateRequest asks for the current model state of a
// live GUI chat session. It never starts a session: if no live session matches
// the source+sessionId, the response reports Live=false.
type AISessionsLiveSessionStateRequest struct {
	Source    string `json:"source"`
	SessionID string `json:"sessionId"`
}

// AISessionsLiveSessionStateResponse carries the model/thinking level of a
// live GUI chat session, or Live=false when the session is not currently live.
type AISessionsLiveSessionStateResponse struct {
	Live          bool   `json:"live"`
	ModelProvider string `json:"modelProvider,omitempty"`
	ModelID       string `json:"modelId,omitempty"`
	ModelName     string `json:"modelName,omitempty"`
	ThinkingLevel string `json:"thinkingLevel,omitempty"`
}

func (svc *AISessionsService) ChatAbort_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "abort a running turn in a live chat session",
		ArgNames: []string{"ctx", "request"},
	}
}

// ChatAbort stops the in-flight turn for a live chat session. Safe to call
// when no turn is running. Exposed via callBackendService("aisessions","ChatAbort",...).
func (svc *AISessionsService) ChatAbort(ctx context.Context, request *AISessionsChatControlRequest) error {
	if request == nil || request.Source == "" || request.SessionID == "" {
		return fmt.Errorf("source and sessionId are required")
	}
	s := chatManager.Get(request.Source, request.SessionID)
	if s == nil {
		return nil // not running; nothing to abort
	}
	return s.Abort(ctx)
}

func (svc *AISessionsService) ChatClose_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "shut down a live chat session and its underlying subprocess",
		ArgNames: []string{"ctx", "request"},
	}
}

// ChatClose tears down a live chat session. Exposed via
// callBackendService("aisessions","ChatClose",...).
func (svc *AISessionsService) ChatClose(ctx context.Context, request *AISessionsChatControlRequest) error {
	if request == nil || request.Source == "" || request.SessionID == "" {
		return fmt.Errorf("source and sessionId are required")
	}
	chatManager.Close(request.Source, request.SessionID)
	return nil
}

func (svc *AISessionsService) LiveSessionState_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "query the current model/thinking level of a live GUI chat session without starting one",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "live session model state (Live=false when no matching live session exists)",
	}
}

// LiveSessionState returns the model/thinking level of a live GUI chat session
// if one exists for the given source+sessionId. It never spawns an agent: the
// frontend uses this to enrich the agent hover card's model line asynchronously
// while immediately showing the requested model from block metadata.
//
// For terminal/TUI agent blocks there may be no live GUI chat session; when
// possible, fall back to the persisted AI session record to resolve the last
// assistant model so agent cards can display a real model.
func (svc *AISessionsService) LiveSessionState(ctx context.Context, request *AISessionsLiveSessionStateRequest) (*AISessionsLiveSessionStateResponse, error) {
	resp := &AISessionsLiveSessionStateResponse{Live: false}
	if request == nil || request.SessionID == "" {
		return resp, nil
	}
	source := request.Source
	if source == "" {
		source = "pi"
	}
	s := chatManager.Get(source, request.SessionID)
	if s != nil {
		st, err := s.GetState(ctx)
		if err == nil {
			resp.Live = true
			if st.Model != nil {
				resp.ModelProvider = st.Model.Provider
				resp.ModelID = st.Model.ID
				resp.ModelName = st.Model.Name
			}
			resp.ThinkingLevel = st.ThinkingLevel
			return resp, nil
		}
		// A live entry may still be cold / not queryable; fall through to disk resolution.
	}

	// Disk fallback: resolve from persisted AI session (terminal agents).
	manager, err := svc.managerForIdentifier(ctx, request.SessionID)
	if err != nil || manager == nil {
		return resp, nil
	}
	summary, err := manager.Summary(ctx, request.SessionID, false)
	if err != nil {
		return resp, nil
	}
	if strings.TrimSpace(summary.Source) != "" {
		resp.ModelProvider = summary.Source
	}
	// Try to load messages to find the last assistant message model.
	detail, err := manager.Load(ctx, request.SessionID, aisessions.LoadOptions{})
	if err != nil {
		return resp, nil
	}
	for i := len(detail.Messages) - 1; i >= 0; i-- {
		m := detail.Messages[i]
		if m.Model != "" {
			resp.ModelID = m.Model
			resp.ModelName = m.Model
			break
		}
	}
	return resp, nil
}
