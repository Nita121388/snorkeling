// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aitestservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

// AITestConnectionRequest carries the fields needed to verify an AI endpoint.
// It mirrors AIModeConfigType but is intentionally a plain struct so the visual
// editor can test an unsaved form without touching the config file.
type AITestConnectionRequest struct {
	APIType    string `json:"apiType,omitempty"`
	Endpoint   string `json:"endpoint,omitempty"`
	Model      string `json:"model,omitempty"`
	Provider   string `json:"provider,omitempty"`
	APIToken   string `json:"apiToken,omitempty"`
	SecretName string `json:"secretName,omitempty"`
}

type AITestConnectionResponse struct {
	Ok        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Message   string `json:"message,omitempty"`
}

type AITestService struct{}

func (svc *AITestService) TestConnection_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "test an AI endpoint with a minimal completion without saving",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "connection test result with latency",
	}
}

func (svc *AITestService) TestConnection(ctx context.Context, request *AITestConnectionRequest) (*AITestConnectionResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("test connection request is required")
	}
	if strings.TrimSpace(request.Endpoint) == "" {
		return &AITestConnectionResponse{Ok: false, Message: "endpoint is required"}, nil
	}
	if strings.TrimSpace(request.Model) == "" {
		return &AITestConnectionResponse{Ok: false, Message: "model is required"}, nil
	}
	// Same token priority as the chat path. Test connection issues a real
	// completion, so a missing key is reported before the request is sent.
	tokenResult, err := aiusechat.ResolveAPIToken(request.APIToken, request.SecretName)
	if err != nil {
		return &AITestConnectionResponse{Ok: false, Message: fmt.Sprintf("failed to retrieve secret %s: %v", request.SecretName, err)}, nil
	}
	token := tokenResult.Token
	if token == "" {
		message := tokenResult.MissingReason()
		if tokenResult.SecretName == "" {
			message = "no API key configured; save one in Settings > Secrets or set ai:apitoken in the mode config"
		}
		return &AITestConnectionResponse{Ok: false, Message: message}, nil
	}

	opts := uctypes.AIOptsType{
		Provider:  request.Provider,
		APIType:   request.APIType,
		Model:     request.Model,
		Endpoint:  request.Endpoint,
		APIToken:  token,
		MaxTokens: 64,
		TimeoutMs: 5000,
	}
	if request.APIType == "google-gemini" {
		opts.Capabilities = []string{"text"}
	}

	start := time.Now()
	reply, err := aiusechat.RunCompletion(ctx, opts, "You are a connectivity test.", "Reply with the single word: ok")
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return &AITestConnectionResponse{Ok: false, LatencyMs: latency, Message: err.Error()}, nil
	}
	msg := fmt.Sprintf("connected (%dms)", latency)
	if strings.TrimSpace(reply) == "" {
		msg += " (empty reply, but endpoint responded)"
	}
	return &AITestConnectionResponse{Ok: true, LatencyMs: latency, Message: msg}, nil
}
