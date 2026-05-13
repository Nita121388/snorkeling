// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package objectservice

import "testing"

func TestResolveMoveBlockToNewTabBaseName(t *testing.T) {
	tests := []struct {
		name           string
		sourceTabName  string
		fallbackBase   string
		expectedResult string
	}{
		{
			name:           "prefers source tab name",
			sourceTabName:  "Project",
			fallbackBase:   "Block",
			expectedResult: "Project",
		},
		{
			name:           "falls back to provided base",
			sourceTabName:  "   ",
			fallbackBase:   "Block",
			expectedResult: "Block",
		},
		{
			name:           "falls back to Tab",
			sourceTabName:  "   ",
			fallbackBase:   "   ",
			expectedResult: "Tab",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := resolveMoveBlockToNewTabBaseName(tc.sourceTabName, tc.fallbackBase)
			if actual != tc.expectedResult {
				t.Fatalf("expected %q, got %q", tc.expectedResult, actual)
			}
		})
	}
}
