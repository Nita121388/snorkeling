// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeCodexRollout writes a codex rollout JSONL fixture under
// <root>/sessions/2026/11/19/ and returns its path.
func writeCodexRollout(t *testing.T, root string, name string, content string) string {
	t.Helper()
	dir := filepath.Join(root, "sessions", "2026", "11", "19")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// codexCurrentModel: two turn_context lines (each turn) — the model of the last
// turn wins. The provider lives in session_meta.payload.model_provider, NOT in
// turn_context.payload (verified against real rollouts: model_provider="custom"
// sits on the first session_meta line). session_meta is the FIRST line, the
// last turn_context is near the tail, so the bounded tail read must also read
// the header for the provider.
const codexCurrentModel = `{"timestamp":"2026-11-19T05:00:00Z","type":"session_meta","payload":{"id":"codex-model-1","cwd":"/home/user/project","model_provider":"custom","originator":"codex_cli_rs"}}` + "\n" +
	`{"timestamp":"2026-11-19T05:00:01Z","type":"turn_context","payload":{"model":"gpt-5"}}` + "\n" +
	`{"timestamp":"2026-11-19T05:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":"hello"}}` + "\n" +
	`{"timestamp":"2026-11-19T05:00:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"hi"}}` + "\n" +
	`{"timestamp":"2026-11-19T05:01:00Z","type":"turn_context","payload":{"model":"gpt-5.1-codex"}}` + "\n"

func TestCodexCurrentModelState(t *testing.T) {
	// The planned optional interface (design.md §3.1): codex provider must
	// implement CurrentModelState. Red proof — the type does not exist today.
	var _ ModelStateProvider = (*CodexProvider)(nil)

	root := t.TempDir()
	path := writeCodexRollout(t, root, "rollout-2026-11-19T05-00-00-codex-model-1.jsonl", codexCurrentModel)
	state, ok := NewCodexProvider(root).CurrentModelState(context.Background(), path)
	if !ok {
		t.Fatalf("expected CurrentModelState ok=true")
	}
	if state.Model != "gpt-5.1-codex" {
		t.Fatalf("expected last turn_context model gpt-5.1-codex, got %q", state.Model)
	}
	if state.Provider != "custom" {
		t.Fatalf("expected provider custom from session_meta.payload.model_provider, got %q", state.Provider)
	}
}

// TestCodexCurrentModelStateFallsBackToMessageModel covers a rollout whose only
// model evidence is the assistant message itself (no turn_context): the model
// must fall back to the last message.model, and the provider still comes from
// session_meta.
func TestCodexCurrentModelStateFallsBackToMessageModel(t *testing.T) {
	var _ ModelStateProvider = (*CodexProvider)(nil)

	root := t.TempDir()
	content := `{"timestamp":"2026-11-19T06:00:00Z","type":"session_meta","payload":{"id":"codex-model-2","cwd":"/home/user/project","model_provider":"custom"}}` + "\n" +
		`{"timestamp":"2026-11-19T06:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":"hello"}}` + "\n" +
		`{"timestamp":"2026-11-19T06:00:05Z","type":"response_item","payload":{"type":"message","role":"assistant","model":"gpt-5-mini","content":"hi"}}` + "\n"
	path := writeCodexRollout(t, root, "rollout-2026-11-19T06-00-00-codex-model-2.jsonl", content)
	state, ok := NewCodexProvider(root).CurrentModelState(context.Background(), path)
	if !ok {
		t.Fatalf("expected CurrentModelState ok=true")
	}
	if state.Model != "gpt-5-mini" {
		t.Fatalf("expected fallback model gpt-5-mini, got %q", state.Model)
	}
	if !strings.EqualFold(state.Provider, "custom") {
		t.Fatalf("expected provider custom, got %q", state.Provider)
	}
}
