// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import "testing"

// The CLI advertises `--marked true|false`, the index filter speaks
// starred/unstarred. A missing normalization silently returns every row
// (verify-run 20261121T17220: 500 rows for --marked true).
func TestNormalizeMarkedFilter(t *testing.T) {
	cases := map[string]string{
		"true":      "starred",
		"TRUE":      "starred",
		"yes":       "starred",
		"1":         "starred",
		"false":     "unstarred",
		"no":        "unstarred",
		"0":         "unstarred",
		"starred":   "starred",
		"unstarred": "unstarred",
		"":          "",
	}
	for in, want := range cases {
		if got := normalizeMarkedFilter(in); got != want {
			t.Errorf("normalizeMarkedFilter(%q) = %q, want %q", in, got, want)
		}
	}
}
