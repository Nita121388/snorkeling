// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aitestservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

// AIFetchModelsRequest fetches the model id list advertised by an
// OpenAI-compatible endpoint (GET <endpoint>/models). Endpoint here is the base
// URL without the trailing /models path.
type AIFetchModelsRequest struct {
	Endpoint   string `json:"endpoint,omitempty"`
	APIToken   string `json:"apiToken,omitempty"`
	SecretName string `json:"secretName,omitempty"`
}

type AIFetchModelsResponse struct {
	Models []string `json:"models,omitempty"`
	Error  string   `json:"error,omitempty"`
}

func (svc *AITestService) FetchModels_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list models advertised by an OpenAI-compatible endpoint without saving",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "model id list or an error message",
	}
}

func (svc *AITestService) FetchModels(ctx context.Context, request *AIFetchModelsRequest) (*AIFetchModelsResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("fetch models request is required")
	}
	base := strings.TrimSpace(request.Endpoint)
	if base == "" {
		return &AIFetchModelsResponse{Error: "endpoint is required"}, nil
	}
	// The mode config's ai:endpoint is the full request URL for chat/completions;
	// derive the base by trimming /chat/completions, /responses, or a trailing slash.
	for _, suffix := range []string{"/chat/completions", "/responses", "/v1/chat/completions", "/v1/responses"} {
		if strings.HasSuffix(base, suffix) {
			base = strings.TrimSuffix(base, suffix)
			break
		}
	}
	base = strings.TrimRight(base, "/")
	if !strings.HasSuffix(base, "/models") {
		base = base + "/models"
	}

	token := strings.TrimSpace(request.APIToken)
	if token == "" && strings.TrimSpace(request.SecretName) != "" {
		if value, ok, err := secretstore.GetSecret(request.SecretName); err == nil && ok {
			token = value
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base, nil)
	if err != nil {
		return &AIFetchModelsResponse{Error: err.Error()}, nil
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return &AIFetchModelsResponse{Error: err.Error()}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &AIFetchModelsResponse{Error: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))}, nil
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return &AIFetchModelsResponse{Error: fmt.Sprintf("failed to parse /models response: %v", err)}, nil
	}
	var ids []string
	for _, m := range payload.Data {
		if strings.TrimSpace(m.ID) != "" {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return &AIFetchModelsResponse{Error: "endpoint returned no models"}, nil
	}
	return &AIFetchModelsResponse{Models: ids}, nil
}