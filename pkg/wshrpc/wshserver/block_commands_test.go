// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import "testing"

// TestSplitTargetAction pins the --split/--replace → TargetAction mapping
// (implement.md stage 5.5). Pure function, no DB.
func TestSplitTargetAction(t *testing.T) {
	tests := []struct {
		name       string
		split      string
		replace    string
		wantTarget string
		wantAction string
		wantErr    bool
	}{
		{"no split means splitright default", "", "", "", "splitright", false},
		{"right", "right", "", "", "splitright", false},
		{"left", "left", "", "", "splitleft", false},
		{"down", "down", "", "", "splitdown", false},
		{"up", "up", "", "", "splitup", false},
		{"replace carries block id", "", "blk9", "blk9", "replace", false},
		{"split+replace mutually exclusive", "right", "blk9", "", "", true},
		{"bad direction rejected", "diagonal", "", "", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			target, action, err := splitTargetAction(tc.split, tc.replace)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if target != tc.wantTarget || action != tc.wantAction {
				t.Fatalf("expected (%q,%q), got (%q,%q)", tc.wantTarget, tc.wantAction, target, action)
			}
		})
	}
}
