// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// 截断的 id 绝不能解析成另一个会话：定位只认精确 key/id。
// （回归证：以前 HasPrefix(ID, identifier) 唯一命中时静默返回该会话。）
func TestManagerLoadRejectsTruncatedID(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	t.Setenv("WAVETERM_AI_SESSIONS_DELETED_DIR", filepath.Join(t.TempDir(), "deleted"))

	sessionID := "exact-session-id-1234"
	sessionPath := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-11-18T10:00:00Z","type":"session_meta","payload":{"id":"`+sessionID+`","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-11-18T10:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":"hello"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{NewCodexProvider(dir)})

	// 精确 id 正常命中（对照组）。
	if _, err := manager.Load(context.Background(), sessionID, LoadOptions{}); err != nil {
		t.Fatalf("exact id should resolve, got err: %v", err)
	}

	// 截断 id 必须报错，绝不能静默命中前缀匹配的会话。
	if _, err := manager.Load(context.Background(), "exact-session-id", LoadOptions{}); err == nil {
		t.Fatal("expected error for truncated id, got nil (silent prefix match)")
	}
}
