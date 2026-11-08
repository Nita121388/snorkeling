// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentmcphost builds the MCP server entry an external agent host needs
// to launch `wsh mcp serve --stdio`.
//
// It is shared by the `wsh agent mcp-config` CLI and the in-app Agent Access
// panel so the two cannot drift: a user who copies the panel's snippet and the
// user who pipes the CLI get byte-identical config.
package agentmcphost

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DefaultTokenPath is where `wsh auth grant` writes by default.
func DefaultTokenPath() string {
	return filepath.Join("~", ".config", "snorkeling", "agent-token.json")
}

// wshPath returns the absolute path of the running wsh binary, falling back to
// the bare name so a config built anywhere still resolves via PATH.
func wshPath() string {
	exe, err := os.Executable()
	if err != nil || strings.TrimSpace(exe) == "" {
		return "wsh"
	}
	return exe
}

// serverEntry is the tool-agnostic shape both host flavours share.
func serverEntry() map[string]any {
	return map[string]any{
		"command": wshPath(),
		"args":    []string{"mcp", "serve", "--stdio"},
		// The token goes in env, never in args: args are visible in the host's
		// process list and get pasted into config files and bug reports.
		"env": map[string]string{"SNORKELING_AGENT_TOKEN_FILE": DefaultTokenPath()},
	}
}

// Config returns the JSON snippet for a host flavour. Unknown hosts are an
// error rather than a guess: writing the wrong shape silently produces a host
// that starts and then reports zero tools.
func Config(host string) (string, error) {
	var payload map[string]any
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "", "claude", "cursor", "pi":
		payload = map[string]any{"mcpServers": map[string]any{"snorkeling": serverEntry()}}
	case "codex":
		payload = map[string]any{"mcp": map[string]any{"servers": map[string]any{"snorkeling": serverEntry()}}}
	default:
		return "", fmt.Errorf("E_USAGE: unknown host %q (claude|cursor|codex|pi)", host)
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}
