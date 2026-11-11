// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
)

func TestNormalizePropScope(t *testing.T) {
	cases := []struct {
		raw     string
		want    string
		wantErr bool
	}{
		{"", "session", false},
		{"session", "session", false},
		{" Agent ", "agent", false},
		{"all", "all", false},
		{"team", "", true},
	}
	for _, tc := range cases {
		got, err := normalizePropScope(tc.raw)
		if tc.wantErr {
			if err == nil {
				t.Fatalf("expected error for %q", tc.raw)
			}
			if !strings.Contains(err.Error(), tc.raw) && !strings.Contains(err.Error(), strings.TrimSpace(tc.raw)) {
				t.Fatalf("error should name the offending value, got %v", err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("unexpected error for %q: %v", tc.raw, err)
		}
		if got != tc.want {
			t.Fatalf("normalizePropScope(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}
