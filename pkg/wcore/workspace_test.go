// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestMakeUniqueTabNameFromBase(t *testing.T) {
	tests := []struct {
		name     string
		baseName string
		existing []string
		expected string
	}{
		{
			name:     "first suffix",
			baseName: "Files",
			existing: []string{"T1", "Files"},
			expected: "Files-01",
		},
		{
			name:     "skips used suffixes",
			baseName: "Files",
			existing: []string{"Files-01", "Files-02"},
			expected: "Files-03",
		},
		{
			name:     "blank base",
			baseName: "  ",
			existing: []string{"Tab-01"},
			expected: "Tab-02",
		},
		{
			name:     "source tab name increments numerically",
			baseName: "Agent",
			existing: []string{"Agent", "Agent-01", "Agent-02"},
			expected: "Agent-03",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := makeUniqueTabNameFromBase(tc.baseName, tc.existing)
			if actual != tc.expected {
				t.Fatalf("expected %q, got %q", tc.expected, actual)
			}
		})
	}
}

// New tabs must start with no blocks: the frontend renders the "no blocks"
// hint and the user adds blocks explicitly. Regression guard for the old
// behavior where CreateTab applied a default term layout.
func TestCreateTabStartsEmpty(t *testing.T) {
	setupBlockScopeStore(t)
	ctx := context.Background()

	wsId := "wstest-ws-newtab"
	if err := wstore.DBInsert(ctx, &waveobj.Workspace{
		OID:    wsId,
		Name:   "newtab-test",
		TabIds: []string{},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ws, _ := wstore.DBGet[*waveobj.Workspace](ctx, wsId)
		if ws != nil {
			for _, tabId := range ws.TabIds {
				_, _ = DeleteTab(ctx, wsId, tabId, false)
			}
		}
		_ = wstore.DBDelete(ctx, waveobj.OType_Workspace, wsId)
	})

	tabId, err := CreateTab(ctx, wsId, "", true, false)
	if err != nil {
		t.Fatalf("CreateTab: %v", err)
	}

	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil {
		t.Fatalf("load created tab: tab=%v err=%v", tab, err)
	}
	if len(tab.BlockIds) != 0 {
		t.Fatalf("new tab should have 0 blocks, got %d: %#v", len(tab.BlockIds), tab.BlockIds)
	}

	ws, err := wstore.DBGet[*waveobj.Workspace](ctx, wsId)
	if err != nil || ws == nil {
		t.Fatalf("load workspace: ws=%v err=%v", ws, err)
	}
	if ws.ActiveTabId != tabId {
		t.Fatalf("expected new tab %q to be active, got %q", tabId, ws.ActiveTabId)
	}
}
