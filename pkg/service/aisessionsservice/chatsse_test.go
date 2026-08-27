// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package aisessionsservice

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestChatStreamHandler_AttachOnly exercises the full SSE plumbing without a
// real LLM call: POST with no sessionId (fresh pi session) + empty message
// → session_state snapshot, stream ends. Uses real httptest.Server.
func TestChatStreamHandler_AttachOnly(t *testing.T) {
	if _, err := exec.LookPath("pi"); err != nil {
		t.Skip("pi binary not found; skipping SSE integration test")
	}
	srv := httptest.NewServer(http.HandlerFunc(AISessionsChatStreamHandler))
	defer srv.Close()

	// No sessionId → pi creates a fresh session; message empty → attach-only.
	body := `{"source":"pi","sessionDir":"/tmp/aisessions-chat-e2e","message":""}`
	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", resp.StatusCode)
	}

	// Scan SSE lines for the session_state data frame (may take up to 2s for pi boot).
	found := false
	done := make(chan struct{})
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 1<<20), 1<<20)
	go func() {
		defer close(done)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") && strings.Contains(line, `"type":"session_state"`) {
				found = true
				return
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
	}
	if !found {
		t.Fatalf("expected session_state SSE frame within 30s; scanner err=%v", scanner.Err())
	}
}

// TestChatStreamHandler_RejectsBadSource verifies the handler rejects unknown
// agents before spawning anything.
func TestChatStreamHandler_RejectsBadSource(t *testing.T) {
	reqBody := `{"source":"nonexistent","sessionId":"x","message":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/aisessions-chat", strings.NewReader(reqBody))
	rec := httptest.NewRecorder()
	AISessionsChatStreamHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown source, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestChatStreamHandler_ListsAvailableSources(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/aisessions-chat", nil)
	rec := httptest.NewRecorder()
	AISessionsChatStreamHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"source":"pi"`) {
		t.Fatalf("source list did not include pi: %s", rec.Body.String())
	}
}
