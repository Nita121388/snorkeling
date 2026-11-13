// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RenameResult reports a rename (or its --dry-run plan).
type RenameResult struct {
	OldID      string `json:"oldId"`
	NewID      string `json:"newId"`
	OldDir     string `json:"oldDir"`
	NewDir     string `json:"newDir"`
	Applied    bool   `json:"applied"`
	MetaRefs   int    `json:"metaRefs"`   // block meta hero:<id> references rewritten
	RosterRef  int    `json:"rosterRefs"` // roster entries referencing newID after rewrite
	Now        string `json:"now,omitempty"`
	DryRunNote string `json:"dryRunNote,omitempty"`
}

// Rename is the only legal way to change a hero id (design §3.1):
// move the directory, rewrite hero.json.id, regenerate the roster, and
// (once A3 writes them) rewrite block meta hero:<id> references.
//
// A1 ships the block-meta hook as a documented no-op: hero:<id> block meta
// is introduced by A3, so the reference set is empty here by construction.
func Rename(root, oldID, newID string, dryRun bool) (*RenameResult, error) {
	rootResolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(oldID); err != nil {
		return nil, err
	}
	if err := ValidateID(newID); err != nil {
		return nil, fmt.Errorf("invalid new id: %w", err)
	}
	if oldID == newID {
		return nil, errors.New("old and new id are identical")
	}
	oldDir := heroDir(rootResolved, oldID)
	newDir := heroDir(rootResolved, newID)
	identityPath := filepath.Join(oldDir, ".hero", "hero.json")
	p, err := readHeroFile(identityPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, oldID)
		}
		return nil, err
	}
	if _, err := os.Stat(newDir); err == nil {
		return nil, fmt.Errorf("target id already exists: %s (refusing to overwrite)", newID)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("checking target %s: %w", newID, err)
	}

	res := &RenameResult{OldID: oldID, NewID: newID, OldDir: oldDir, NewDir: newDir}
	if dryRun {
		res.DryRunNote = "dry-run: nothing moved; pass --yes to apply"
		return res, nil
	}

	if err := os.Rename(oldDir, newDir); err != nil {
		return nil, fmt.Errorf("moving %s -> %s: %w", oldDir, newDir, err)
	}
	// The directory move is done; keep the id in the identity card in sync.
	// On failure, move back so the on-disk state stays consistent.
	p.ID = newID
	if err := writeJSON(filepath.Join(newDir, ".hero", "hero.json"), p); err != nil {
		_ = os.Rename(newDir, oldDir)
		return nil, err
	}
	res.MetaRefs = rewriteBlockMetaReferences(oldID, newID)
	if _, err := WriteRoster(rootResolved); err != nil {
		return nil, err
	}
	if heroes, err := List(rootResolved); err == nil {
		for _, x := range heroes {
			if x.ID == newID {
				res.RosterRef++
			}
		}
	}
	res.Applied = true
	return res, nil
}

// rewriteBlockMetaReferences is the A3 hook: when hero:<id> lands in block
// meta, this walks the block store (via RPC) and rewrites oldID -> newID.
// Until then the set is empty, so the honest return value is 0.
func rewriteBlockMetaReferences(oldID, newID string) int {
	_ = oldID
	_ = newID
	return 0
}

func writeJSON(path string, v any) error {
	barr, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", path, err)
	}
	barr = append(barr, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, barr, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replacing %s: %w", path, err)
	}
	return nil
}

// countRosterIDRefs returns how many roster lines carry id in the id column.
// Used by tests; the CLI's rename output reports the same count.
func countRosterIDRefs(roster, id string) int {
	count := 0
	for _, line := range strings.Split(roster, "\n") {
		if strings.HasPrefix(line, id+" | ") || strings.HasPrefix(line, "🎭 "+id+" | ") {
			count++
		}
	}
	return count
}
