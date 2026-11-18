// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import "testing"

// In-process meta builders use typed Go slices/maps, while a JSON round-trip
// (DB load) produces []any / map[string]any. The getters must treat both
// shapes identically, otherwise a freshly built block reads back differently
// from the same block after a restart.
func TestGetArrayAcceptsTypedStringSlice(t *testing.T) {
	meta := MetaMapType{"args": []string{"--model", "x"}}
	got := meta.GetStringArray("args")
	if len(got) != 2 || got[0] != "--model" || got[1] != "x" {
		t.Fatalf("GetStringArray from []string = %v", got)
	}
}

func TestGetMapAcceptsTypedStringMap(t *testing.T) {
	meta := MetaMapType{"env": map[string]string{"FOO": "bar"}}
	got := meta.GetStringMap("env", false)
	if got["FOO"] != "bar" {
		t.Fatalf("GetStringMap from map[string]string = %v", got)
	}
}
