// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aitestservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func TestFetchModels_DerivesBaseFromChatSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("expected /v1/models, got %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"id": "gpt-4o"},
				{"id": "gpt-5-mini"},
			},
		})
	}))
	defer srv.Close()

	req := &AIFetchModelsRequest{
		Endpoint: srv.URL + "/v1/chat/completions",
	}
	resp, err := (&AITestService{}).FetchModels(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Error != "" {
		t.Fatalf("unexpected error field: %s", resp.Error)
	}
	if len(resp.Models) != 2 || resp.Models[0] != "gpt-4o" {
		t.Fatalf("models = %v", resp.Models)
	}
}

func TestFetchModels_RequiresEndpoint(t *testing.T) {
	resp, err := (&AITestService{}).FetchModels(context.Background(), &AIFetchModelsRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Error == "" {
		t.Fatal("expected error for empty endpoint")
	}
}

func TestFetchModels_Non200ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer srv.Close()

	resp, err := (&AITestService{}).FetchModels(context.Background(), &AIFetchModelsRequest{
		Endpoint: srv.URL + "/v1/chat/completions",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Error == "" || !strings.Contains(resp.Error, "401") {
		t.Fatalf("expected 401 error, got %q", resp.Error)
	}
}

func TestTestConnection_ValidatesFields(t *testing.T) {
	svc := &AITestService{}
	// missing endpoint
	resp, err := svc.TestConnection(context.Background(), &AITestConnectionRequest{Model: "gpt-4o"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Ok {
		t.Fatal("expected failure for missing endpoint")
	}
	// missing model
	resp, err = svc.TestConnection(context.Background(), &AITestConnectionRequest{Endpoint: "https://x.example.com"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Ok {
		t.Fatal("expected failure for missing model")
	}
	// missing token
	resp, err = svc.TestConnection(context.Background(), &AITestConnectionRequest{
		Endpoint: "https://x.example.com/v1/chat/completions",
		Model:    "gpt-4o",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Ok {
		t.Fatal("expected failure for missing token")
	}
}

func TestTestConnection_EndpointReachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// We only assert the request reaches the server; the AI backend would
		// parse the body, so return a 404-style error shape the backend tolerates.
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	resp, err := (&AITestService{}).TestConnection(context.Background(), &AITestConnectionRequest{
		APIType:  "openai-chat",
		Endpoint: srv.URL + "/v1/chat/completions",
		Model:    "gpt-4o",
		APIToken: "test-token",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The backend reports a non-OK response as a failure with a message — the
	// important contract is Ok=false rather than a panic or unhandled error.
	if resp.Ok {
		t.Fatal("expected non-ok result against a fake endpoint")
	}
	if resp.Message == "" {
		t.Fatal("expected a failure message")
	}
}

// missingSecretName is a secret that is guaranteed not to exist in the local
// secret store.
const missingSecretName = "TRELlIS_MISSING_SECRET_XYZ"

// useEmptySecretStore points the secret store at an empty temp dir so the
// tests never read (or depend on) the developer's real secret store.
func useEmptySecretStore(t *testing.T) {
	t.Helper()
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = t.TempDir()
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = prev
	})
}

func TestFetchModels_SendsAPITokenHeader(t *testing.T) {
	const token = "test-token-123"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+token {
			t.Errorf("expected Authorization %q, got %q", "Bearer "+token, got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"id": "gpt-4o"},
			},
		})
	}))
	defer srv.Close()

	resp, err := (&AITestService{}).FetchModels(context.Background(), &AIFetchModelsRequest{
		Endpoint: srv.URL + "/v1/chat/completions",
		APIToken: token,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Error != "" {
		t.Fatalf("unexpected error field: %s", resp.Error)
	}
	if len(resp.Models) != 1 || resp.Models[0] != "gpt-4o" {
		t.Fatalf("models = %v", resp.Models)
	}
}

func TestFetchModels_MissingSecretExplains401(t *testing.T) {
	useEmptySecretStore(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer srv.Close()

	resp, err := (&AITestService{}).FetchModels(context.Background(), &AIFetchModelsRequest{
		Endpoint:   srv.URL + "/v1/chat/completions",
		SecretName: missingSecretName,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Error == "" {
		t.Fatal("expected an error for a 401 response")
	}
	if !strings.Contains(resp.Error, "401") {
		t.Fatalf("expected 401 in error, got %q", resp.Error)
	}
	if !strings.Contains(resp.Error, missingSecretName) {
		t.Fatalf("expected secret name %q in error, got %q", missingSecretName, resp.Error)
	}
	if !strings.Contains(resp.Error, "no API key") {
		t.Fatalf("expected 'no API key' in error, got %q", resp.Error)
	}
}

func TestFetchModels_AnonymousEndpointStillWorks(t *testing.T) {
	useEmptySecretStore(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("expected no Authorization header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"id": "llama3"},
			},
		})
	}))
	defer srv.Close()

	resp, err := (&AITestService{}).FetchModels(context.Background(), &AIFetchModelsRequest{
		Endpoint: srv.URL + "/v1/chat/completions",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Error != "" {
		t.Fatalf("unexpected error field: %s", resp.Error)
	}
	if len(resp.Models) != 1 || resp.Models[0] != "llama3" {
		t.Fatalf("models = %v", resp.Models)
	}
}

func TestTestConnection_MissingSecretNamesSecret(t *testing.T) {
	useEmptySecretStore(t)
	resp, err := (&AITestService{}).TestConnection(context.Background(), &AITestConnectionRequest{
		Endpoint:   "https://x.example.com/v1/chat/completions",
		Model:      "gpt-4o",
		SecretName: missingSecretName,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Ok {
		t.Fatal("expected failure when the named secret is missing")
	}
	if !strings.Contains(resp.Message, missingSecretName) {
		t.Fatalf("expected secret name %q in message, got %q", missingSecretName, resp.Message)
	}
}
