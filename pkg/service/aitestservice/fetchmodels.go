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

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
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
	// The mode config's ai:endpoint may be the full request URL
	// (…/chat/completions) or just a base URL (https://host/v1);
	// aiutil.ResolveModelsEndpoint accepts both, so the "Fetch from endpoint"
	// button and the chat request now agree on what the endpoint means.
	base := aiutil.ResolveModelsEndpoint(request.Endpoint)
	if base == "" {
		return &AIFetchModelsResponse{Error: "endpoint is required"}, nil
	}

	// Same token priority as the chat path. A secret store failure is not fatal
	// here: anonymous endpoints must keep working, and the non-200 branch below
	// explains that no API key was sent.
	tokenResult, tokenErr := aiusechat.ResolveAPIToken(request.APIToken, request.SecretName)
	token := tokenResult.Token

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
		errMsg := fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		if token == "" && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			reason := tokenResult.MissingReason()
			if tokenErr != nil {
				reason = fmt.Sprintf("could not read secret %q: %v", tokenResult.SecretName, tokenErr)
			}
			errMsg += fmt.Sprintf(" (no API key was sent: %s)", reason)
		}
		return &AIFetchModelsResponse{Error: errMsg}, nil
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
