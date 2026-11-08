// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentaccess

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// TokenFile is the on-disk format of a granted agent token.
//
// It contains the token itself, so it is written 0600 from creation (never
// create-then-chmod: that leaves a window where the file is world-readable).
type TokenFile struct {
	Version   int      `json:"version"`
	Name      string   `json:"name"`
	Token     string   `json:"token"`
	Socket    string   `json:"socket,omitempty"`
	Scopes    []string `json:"scopes,omitempty"`
	ExpiresAt int64    `json:"expiresat,omitempty"`
	CreatedAt int64    `json:"createdat,omitempty"`
}

// ExpandHome resolves a leading ~ so the same path string works from the CLI,
// from a shell that already expanded it, and from the settings panel.
func ExpandHome(path string) string {
	if path == "" || !strings.HasPrefix(path, "~") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		return filepath.Join(home, path[2:])
	}
	return path
}

// WriteTokenFile writes the token file with 0600 permissions and returns the
// absolute path that was written.
//
// This is the single writer used by both `wsh auth grant` and the Agent Access
// panel, so "the token file is 0600" is one implementation rather than two.
func WriteTokenFile(path string, payload TokenFile) (string, error) {
	path = ExpandHome(strings.TrimSpace(path))
	if path == "" {
		return "", fmt.Errorf("E_USAGE: empty token path")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	dir := filepath.Dir(abs)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("E_USAGE: cannot create directory %s: %w", dir, err)
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	data = append(data, '\n')
	// O_CREATE with mode 0600: the file never exists with looser permissions.
	f, err := os.OpenFile(abs, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return "", fmt.Errorf("E_USAGE: cannot write %s: %w", abs, err)
	}
	defer f.Close()
	if _, err := f.Write(data); err != nil {
		return "", fmt.Errorf("E_USAGE: cannot write %s: %w", abs, err)
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	// Tighten an existing file that was previously created with looser bits.
	if runtime.GOOS != "windows" {
		if err := os.Chmod(abs, 0o600); err != nil {
			return "", err
		}
	}
	return abs, nil
}
