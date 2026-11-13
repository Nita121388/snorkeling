// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestCreateWritesFullFiles guards the A2.5 regression that exposed an A1 bug:
// plannedFiles used to truncate its "preview" at 400 bytes and Create wrote
// that preview as the file body, so any scaffolded file longer than 400 bytes
// (the agent contract templates, and hero.json once provenance grew) was
// silently corrupted. Every planned file must land byte-identical.
func TestCreateWritesFullFiles(t *testing.T) {
	root := t.TempDir()
	res, err := Create(Options{
		Root:       root,
		Name:       "integrity",
		Emoji:      "🎭",
		Role:       "备份归档与恢复演练，负责每周完整性与可恢复性检查",
		Provider:   "pi",
		Model:      "deepseek",
		Agent:      agentProvenance("pi", "session-0123456789abcdef"),
		ApprovedBy: &Provenance{Kind: "human", Name: "nita", Ts: "2026-11-12T08:00:00Z"},
		Now:        fixedNow,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Applied {
		t.Fatalf("expected an applied create, got %+v", res)
	}
	for _, f := range res.Files {
		disk, err := os.ReadFile(f.Path)
		if err != nil {
			t.Fatalf("reading %s: %v", f.Path, err)
		}
		if strings.HasSuffix(string(disk), "…") {
			t.Fatalf("%s was written with a display truncation marker", f.Path)
		}
		if string(disk) != f.Bytes {
			t.Fatalf("%s on disk (%d bytes) differs from the planned body (%d bytes)",
				f.Path, len(disk), len(f.Bytes))
		}
	}
	// The identity card must be valid JSON even with agent + approver provenance.
	identity := res.Dir + "/.hero/hero.json"
	barr, err := os.ReadFile(identity)
	if err != nil {
		t.Fatal(err)
	}
	var p Hero
	if err := json.Unmarshal(barr, &p); err != nil {
		t.Fatalf("hero.json must parse, got %v:\n%s", err, barr)
	}
	if p.CreatedBy == nil || p.CreatedBy.Kind != "agent" || p.ApprovedBy == nil || p.ApprovedBy.Kind != "human" {
		t.Fatalf("unexpected provenance: createdBy=%+v approvedBy=%+v", p.CreatedBy, p.ApprovedBy)
	}
}
