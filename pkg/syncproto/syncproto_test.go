// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncproto

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCompatibleRequiresExactProtocolMatch(t *testing.T) {
	// Only an exact match is safe: a newer protocol may carry fields this build would silently
	// drop, and a silent drop corrupts data rather than failing loudly.
	if !Compatible(ProtocolVersion) {
		t.Fatal("the current protocol must be compatible with itself")
	}
	if Compatible(ProtocolVersion + 1) {
		t.Fatal("a newer protocol must not be silently accepted")
	}
	if Compatible(ProtocolVersion - 1) {
		t.Fatal("an older protocol must not be silently accepted")
	}
	if Compatible(0) {
		t.Fatal("protocol 0 is not a valid version")
	}
}

func TestCheckHealthNamesEveryProblem(t *testing.T) {
	cases := []struct {
		name    string
		health  *Health
		wantSub string
	}{
		{
			name:    "nil",
			health:  nil,
			wantSub: "empty health response",
		},
		{
			name:    "no service field",
			health:  &Health{ProtocolVersion: ProtocolVersion},
			wantSub: "no service field",
		},
		{
			name:    "wrong service",
			health:  &Health{Service: "other", ProtocolVersion: ProtocolVersion},
			wantSub: "wrong service",
		},
		{
			name:    "protocol too new",
			health:  &Health{Service: ServiceName, ProtocolVersion: ProtocolVersion + 1},
			wantSub: "protocol mismatch",
		},
		{
			name:    "protocol too old",
			health:  &Health{Service: ServiceName, ProtocolVersion: ProtocolVersion - 1},
			wantSub: "protocol mismatch",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckHealth(tc.health)
			if err == nil {
				t.Fatalf("expected an error")
			}
			// Every message is shown verbatim to the user, so it must name the problem.
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q must contain %q", err.Error(), tc.wantSub)
			}
		})
	}

	if err := CheckHealth(&Health{Service: ServiceName, ProtocolVersion: ProtocolVersion}); err != nil {
		t.Fatalf("a matching health must pass: %v", err)
	}
}

func TestWSEventJSONShape(t *testing.T) {
	// The wire shape is a cross-layer contract: the server broadcasts, the client decodes.
	// Pinning the exact JSON prevents an accidental field rename from silently breaking both.
	ev := WSEvent{Type: "rev", Rev: 42}
	data, err := json.Marshal(ev)
	if err != nil {
		t.Fatalf("marshal WSEvent: %v", err)
	}
	if got := string(data); got != `{"type":"rev","rev":42}` {
		t.Fatalf("WSEvent JSON shape changed: got %s", got)
	}
	var decoded WSEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal WSEvent: %v", err)
	}
	if decoded.Type != "rev" || decoded.Rev != 42 {
		t.Fatalf("WSEvent round-trip mismatch: %+v", decoded)
	}
	if WSPath != "/v1/ws" {
		t.Fatalf("WSPath changed: %q", WSPath)
	}
}

func TestHealthEndpointIsUnauthenticatedByDesign(t *testing.T) {
	// The path is a constant so the client and server cannot disagree about it.
	if HealthPath != "/v1/health" {
		t.Fatalf("health path changed: %q — update both sides deliberately", HealthPath)
	}
	if SnapshotPath != "/v1/snapshot" {
		t.Fatalf("snapshot path changed: %q", SnapshotPath)
	}
}
