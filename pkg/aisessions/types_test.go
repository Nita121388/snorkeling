// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSessionSummarySerializesSize(t *testing.T) {
	summary := SessionSummary{
		Key:      "codex:test:/tmp/test.jsonl",
		ID:       "test",
		Source:   SourceCodex,
		FilePath: "/tmp/test.jsonl",
		Size:     1234,
	}

	data, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"size":1234`) {
		t.Fatalf("expected size in json, got %s", data)
	}
}
