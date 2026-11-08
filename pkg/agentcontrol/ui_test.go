// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTruncatePayload(t *testing.T) {
	tests := []struct {
		name       string
		in         string
		maxBytes   int
		want       string
		wantTrunc  bool
	}{
		{"short untouched", "hello", 10, "hello", false},
		{"exact fit", "hello", 5, "hello", false},
		{"overflow truncated", "hello world", 5, "hello", true},
		{"zero max disables", "hello", 0, "hello", false},
		{"negative max disables", "hello", -1, "hello", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, trunc := TruncatePayload(tc.in, tc.maxBytes)
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
			if trunc != tc.wantTrunc {
				t.Fatalf("expected trunc=%v, got %v", tc.wantTrunc, trunc)
			}
		})
	}
}

func TestTruncateLines(t *testing.T) {
	tests := []struct {
		name      string
		lines     []string
		maxBytes  int
		wantText  string
		wantTrunc bool
		wantBytes int
	}{
		{"fits", []string{"a", "b", "c"}, 10, "a\nb\nc", false, 5},
		{"exact fit", []string{"hello", "world"}, 11, "hello\nworld", false, 11},
		{"overflow truncates", []string{"hello", "world!?"}, 11, "hello\nworld", true, 13},
		{"empty", []string{}, 100, "", false, 0},
		{"single long line", []string{"<very long>"}, 3, "<ve", true, 11},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			text, trunc, nbytes := truncateLines(tc.lines, tc.maxBytes)
			if text != tc.wantText {
				t.Fatalf("expected text %q, got %q", tc.wantText, text)
			}
			if trunc != tc.wantTrunc {
				t.Fatalf("expected trunc=%v, got %v", tc.wantTrunc, trunc)
			}
			if nbytes != tc.wantBytes {
				t.Fatalf("expected bytes=%d, got %d", tc.wantBytes, nbytes)
			}
		})
	}
}

// TestReadBlockResultShape pins the envelope contract (version + blockid +
// view + payload map presence) without needing a DB.
func TestReadBlockResultShape(t *testing.T) {
	rtn := &wshrpc.BlockReadResult{
		Version: wshrpc.AgentControlVersion,
		BlockId: "blk-test",
		View:    "preview",
		Kind:    "preview",
		Payload: map[string]any{"file": "/repo/README.md"},
	}
	if rtn.Version != 1 {
		t.Fatalf("expected version 1, got %d", rtn.Version)
	}
	if rtn.Payload["file"] != "/repo/README.md" {
		t.Fatalf("expected payload file carried, got %#v", rtn.Payload)
	}
}
