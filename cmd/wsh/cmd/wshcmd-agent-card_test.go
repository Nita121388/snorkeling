// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

func TestParseCardPropAddOptions(t *testing.T) {
	got, err := parseCardPropAddOptions([]string{"status=闲置, 阻断", "status=闲置", "priority=P1,P1,p2"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 keys, got %#v", got)
	}
	if strings.Join(got["status"], "|") != "闲置|阻断" {
		t.Fatalf("comma-split + trim + dedupe failed: %#v", got["status"])
	}
	if strings.Join(got["priority"], "|") != "P1|p2" {
		t.Fatalf("case-insensitive dedupe failed: %#v", got["priority"])
	}
	for _, invalid := range []string{"status", "status=", "=x", " =x"} {
		if _, err := parseCardPropAddOptions([]string{invalid}); err == nil {
			t.Fatalf("invalid entry %q must be rejected", invalid)
		}
	}
	if got, err := parseCardPropAddOptions(nil); err != nil || got != nil {
		t.Fatalf("no flags must stay a no-op, got (%#v, %v)", got, err)
	}
}

func TestMergeCardPropAddOptions(t *testing.T) {
	props := map[string]wshrpc.AgentCardPropPatch{"status": {Type: "status", Value: "Active"}}

	// Session scope refuses the append outright (E_USAGE at the CLI layer).
	if _, err := mergeCardPropAddOptions(props, []string{"status=闲置"}, "session"); err == nil ||
		!strings.Contains(err.Error(), "--prop-scope") {
		t.Fatalf("session scope must reject --prop-add-option, got %v", err)
	}

	// The property key must also be set with --prop in the same call.
	if _, err := mergeCardPropAddOptions(props, []string{"owner=nita"}, "agent"); err == nil ||
		!strings.Contains(err.Error(), "owner") {
		t.Fatalf("option without a matching --prop entry must be rejected, got %v", err)
	}

	merged, err := mergeCardPropAddOptions(props, []string{"status=闲置,阻断", "status=闲置"}, "agent")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(merged["status"].AddOptions, "|") != "闲置|阻断" {
		t.Fatalf("options must fold into the prop patch, got %#v", merged["status"].AddOptions)
	}
	if merged["status"].Type != "status" || merged["status"].Value != "Active" {
		t.Fatalf("the --prop entry must survive the merge, got %#v", merged["status"])
	}
}
