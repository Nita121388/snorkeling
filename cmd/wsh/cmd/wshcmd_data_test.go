// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentcap"
	"github.com/wavetermdev/waveterm/pkg/agentdata"
)

func TestFormatApplySummaryIncludesChangesAndErrors(t *testing.T) {
	report := agentdata.Report{
		DryRun: true,
		Source: "test",
		Operations: []agentdata.OperationReport{{
			Index:         0,
			Type:          "session_note.update",
			Target:        "session-1",
			Changed:       true,
			AffectedCount: 1,
			Changes: []agentdata.ChangeReport{
				{Field: "note", Before: "old", After: "new"},
				{Field: "tags", Before: []string{"old"}, After: []string{"new"}},
			},
			Messages: []string{"validated"},
		}, {
			Index: 1,
			Type:  "common_text.update",
			Error: "common text content cannot be empty",
		}},
	}
	summary := formatApplySummary(report)
	for _, expected := range []string{
		"data apply dry-run: 2 operations",
		"source: test",
		"#0 session_note.update changed target=session-1 affected=1",
		`note: "old" -> "new"`,
		"tags: [old] -> [new]",
		"note: validated",
		"#1 common_text.update error",
		"error: common text content cannot be empty",
	} {
		if !strings.Contains(summary, expected) {
			t.Fatalf("expected summary to contain %q, got:\n%s", expected, summary)
		}
	}
}

func TestFormatPruneSummary(t *testing.T) {
	report := agentdata.PruneReport{
		DryRun:    true,
		Keep:      10,
		Days:      30,
		Permanent: false,
		Deleted: []agentdata.BackupManifest{{
			ID:        "sessions-old",
			Type:      "sessions",
			Path:      "/tmp/sessions-old.sqlite",
			CreatedAt: 1700000000000,
		}},
		Kept: []agentdata.BackupManifest{{
			ID:   "sessions-new",
			Type: "sessions",
		}},
	}
	summary := formatPruneSummary(report)
	for _, expected := range []string{
		"data backup prune dry-run: delete=1 keep=1 policy=keep:10 days:30 permanent:false",
		"delete:",
		"sessions sessions-old",
		"/tmp/sessions-old.sqlite",
	} {
		if !strings.Contains(summary, expected) {
			t.Fatalf("expected summary to contain %q, got:\n%s", expected, summary)
		}
	}
}

func TestDataPromptRunWritesExternalAgentPrompt(t *testing.T) {
	var out bytes.Buffer
	prevStdout := WrappedStdout
	WrappedStdout = &out
	t.Cleanup(func() {
		WrappedStdout = prevStdout
	})

	if err := dataPromptRun(nil, nil); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if got != agentcap.ExternalAgentPrompt() {
		t.Fatalf("unexpected prompt output:\n%s", got)
	}
}
