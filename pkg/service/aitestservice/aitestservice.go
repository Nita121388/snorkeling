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
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

// AITestConnectionRequest carries the fields needed to verify an AI endpoint.
// It mirrors AIModeConfigType but is intentionally a plain struct so the visual
// editor can test an unsaved form without touching the config file.
type AITestConnectionRequest struct {
	APIType   string `json:"apitType,omitempty"`
	Endpoint  string `json:"endpoint,omitempty"`
	Model     string `json:"model,omitempty"`
	Provider  string `json:"provider,omitempty"`
	APIToken  string `json:"apiToken,omitempty"`
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
	token := strings.TrimSpace(request.APIToken)
	if token == "" && strings.TrimSpace(request.SecretName) != "" {
		if value, ok, err := secretstore.GetSecret(request.SecretName); err == nil && ok {
			token = value
		}
	}
	if token == "" {
		return &AITestConnectionResponse{Ok: false, Message: "API key is missing; save it in the Secrets tab or fill it here"}, nil
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