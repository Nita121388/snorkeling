// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentguide

import (
	"strings"
	"testing"
)

// N-1124-idxbadges-agent-surface：能力表必须含 block refresh，
// 且把「功能默认关 + 开关命令」写进 Notes（agent 只看这一张表就能用上索引徽标）。

func TestGuideHasBlockRefreshEntry(t *testing.T) {
	var entry *Command
	for i := range Commands() {
		if Commands()[i].Cmd == "block refresh" {
			entry = &Commands()[i]
			break
		}
	}
	if entry == nil {
		t.Fatalf("agent guide 能力表缺 block refresh 条目")
	}
	if entry.Scope != "navigate" {
		t.Errorf("block refresh scope = %q, want navigate", entry.Scope)
	}
	joined := strings.Join(entry.Notes, "\n")
	if !strings.Contains(joined, "preview:idxbadges") {
		t.Errorf("block refresh 的 Notes 应写明开关键 preview:idxbadges，实际: %v", entry.Notes)
	}
	if !strings.Contains(joined, "index.md") {
		t.Errorf("block refresh 的 Notes 应提到 index.md（刷新后重读的数据源），实际: %v", entry.Notes)
	}
}
