// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import "testing"

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
