// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/pslog"
)

func TestHandlePslogStructuredEventValidation(t *testing.T) {
	pslog.SetEnabled(false)
	t.Cleanup(func() {
		pslog.ResetForTesting()
	})
	tests := []struct {
		name   string
		body   string
		status int
	}{
		{
			name:   "v1 event",
			body:   `tag=agent.note {"v":1,"ts":"stale","event":"agent.note","stage":"render","blockid":"block-1"}`,
			status: http.StatusOK,
		},
		{
			name:   "malformed json",
			body:   `tag=agent.note {not-json}`,
			status: http.StatusBadRequest,
		},
		{
			name:   "unsupported version",
			body:   `tag=agent.note {"v":2,"event":"agent.note"}`,
			status: http.StatusBadRequest,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/wave/pslog", strings.NewReader(test.body))
			handlePslog(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("status=%d, want %d; body=%q", recorder.Code, test.status, recorder.Body.String())
			}
		})
	}
}

func TestHandlePslogWritesStructuredEvent(t *testing.T) {
	dir := t.TempDir()
	pslog.SetDataDirForTesting(dir)
	pslog.SetEnabled(true)
	t.Cleanup(func() {
		pslog.SetEnabled(false)
		pslog.ResetForTesting()
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/wave/pslog",
		strings.NewReader(`tag=agent.note {"v":1,"event":"agent.note","stage":"render","blockid":"block-1"}`),
	)
	handlePslog(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d, body=%q", recorder.Code, recorder.Body.String())
	}
	matches, err := filepath.Glob(filepath.Join(dir, "pslog-*.log"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("expected one pslog file, matches=%v err=%v", matches, err)
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read pslog: %v", err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("invalid JSONL event: %v", err)
		}
		if event["event"] != "agent.note" || event["blockid"] != "block-1" {
			t.Fatalf("unexpected event: %#v", event)
		}
		return
	}
	t.Fatal("structured event line not found")
}
