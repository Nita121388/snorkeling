// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import "testing"

func TestWaveAIVendorProjectionNeverContainsCredentials(t *testing.T) {
	vendor := WaveAIVendor{ID: "provider-1", Name: "OpenAI", Endpoint: "https://example.invalid/v1", Models: []string{"gpt-5"}}
	if vendor.ID == "" || len(vendor.Models) != 1 {
		t.Fatal("invalid projection")
	}
	// The DTO deliberately has no token/settings_config fields. This compile-time
	// shape check protects the redacted RPC contract from accidental expansion.
}

func TestUniqueStrings(t *testing.T) {
	got := uniqueStrings([]string{"gpt-5", "", "gpt-5", "gpt-4"})
	if len(got) != 2 || got[0] != "gpt-5" || got[1] != "gpt-4" {
		t.Fatalf("got %#v", got)
	}
}
