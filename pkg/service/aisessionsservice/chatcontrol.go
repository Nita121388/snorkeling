// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

// AISessionsChatControlRequest is used by the ChatAbort / ChatClose RPC
// methods that the frontend calls to manage a live chat session.
type AISessionsChatControlRequest struct {
	Source    string `json:"source"`
	SessionID string `json:"sessionId"`
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
