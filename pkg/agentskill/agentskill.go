// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentskill ships the external-agent skill inside the wsh binary so a
// released user does not need the source repo to install it.
//
// The files under content/ are the single source of truth; `wsh agent
// install-skill` writes them out to the agent's skill directory.
package agentskill

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed all:content
var contentFS embed.FS

// SkillName is the directory name created under a skill root.
const SkillName = "snorkeling-control"

const contentRoot = "content/" + SkillName

// Files returns every embedded path relative to the skill directory, sorted so
// installs are deterministic.
func Files() ([]string, error) {
	var files []string
	err := fs.WalkDir(contentFS, contentRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(path, contentRoot+"/")
		files = append(files, rel)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

// Read returns one embedded file (path relative to the skill directory).
func Read(rel string) ([]byte, error) {
	return contentFS.ReadFile(contentRoot + "/" + rel)
}

// Install writes the skill into root/snorkeling-control, overwriting files from
// a previous install. It refuses to touch anything else, so a typo in the target
// cannot delete unrelated user files.
func Install(root string) ([]string, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("E_USAGE: empty skill root")
	}
	files, err := Files()
	if err != nil {
		return nil, err
	}
	target := filepath.Join(root, SkillName)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return nil, err
	}
	var written []string
	for _, rel := range files {
		data, err := Read(rel)
		if err != nil {
			return nil, err
		}
		dst := filepath.Join(target, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, err
		}
		// Scripts must stay executable; everything else is a plain file.
		mode := os.FileMode(0o644)
		if strings.HasSuffix(rel, ".sh") {
			mode = 0o755
		}
		if err := os.WriteFile(dst, data, mode); err != nil {
			return nil, err
		}
		written = append(written, dst)
	}
	return written, nil
}

// DefaultRoots returns the skill directories of the agents this fork targets,
// using the platform conventions each tool documents.
func DefaultRoots(home string) []string {
	if home == "" {
		return nil
	}
	return []string{
		filepath.Join(home, ".claude", "skills"),   // Claude Code
		filepath.Join(home, ".codex", "skills"),    // Codex
		filepath.Join(home, ".agents", "skills"),   // pi / shared convention
	}
}
