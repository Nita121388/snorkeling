// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// N-1124-idxbadges-agent-surface：`wsh block refresh` 子命令契约。
// 语义化刷新入口：agent 不需要背 preview:idxrefresh 键名。

func findSubCommand(t *testing.T, parent *cobra.Command, name string) *cobra.Command {
	t.Helper()
	for _, sub := range parent.Commands() {
		if sub.Name() == name {
			return sub
		}
	}
	return nil
}

func TestBlockRefreshSubcommand(t *testing.T) {
	refresh := findSubCommand(t, blockCmd, "refresh")
	if refresh == nil {
		t.Fatalf("wsh block refresh 子命令未注册（可用: %v）", blockCmd.Commands())
	}
	if refresh.Short == "" {
		t.Errorf("block refresh 缺 Short 说明")
	}
	for _, flag := range []string{"key", "value", "json"} {
		// --json 是 blockCmd 的 persistent flag（继承），用 Flag() 同时查本地与继承
		if refresh.Flag(flag) == nil {
			t.Errorf("block refresh 缺 flag --%s", flag)
		}
	}
	// 默认刷新键必须与前端 folder-index-meta.ts 的 IDX_REFRESH_META_KEY 一致
	if BlockRefreshDefaultKey != "preview:idxrefresh" {
		t.Errorf("BlockRefreshDefaultKey = %q, want %q", BlockRefreshDefaultKey, "preview:idxrefresh")
	}
}

func TestBlockRefreshUsageMentionsBlock(t *testing.T) {
	refresh := findSubCommand(t, blockCmd, "refresh")
	if refresh == nil {
		t.Skip("no refresh subcommand")
	}
	if !strings.Contains(refresh.Use, "<block|this>") {
		t.Errorf("block refresh 的 Use 应含 <block|this>，实际 %q", refresh.Use)
	}
}
