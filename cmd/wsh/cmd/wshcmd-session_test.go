// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"
)

// TestSessionCmdSubcommandsRegistered guards against the wiring bug where a
// session subcommand is defined (and its own children attached) but never
// added to sessionCmd itself, making the whole command group unreachable from
// the CLI while still showing up in `strings` of the shipped binary.
func TestSessionCmdSubcommandsRegistered(t *testing.T) {
	// Every subcommand that is expected to be reachable as `wsh session <name>`.
	expected := []string{
		"live", "get", "list", "for-block", "info", "users", "turns", "turn", "annotate", "emoji",
	}
	for _, name := range expected {
		found := false
		for _, sub := range sessionCmd.Commands() {
			if sub.Name() == name {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("sessionCmd is missing subcommand %q: `wsh session %s` would be unknown", name, name)
		}
	}
}

// TestSessionEmojiCmdSubcommandsRegistered pins the emoji command group shape:
// the five tools must hang off sessionEmojiCmd, and (via the test above)
// sessionEmojiCmd must hang off sessionCmd.
func TestSessionEmojiCmdSubcommandsRegistered(t *testing.T) {
	expected := []string{"get", "set", "inject", "recommendations", "prefs"}
	for _, name := range expected {
		found := false
		for _, sub := range sessionEmojiCmd.Commands() {
			if sub.Name() == name {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("sessionEmojiCmd is missing subcommand %q", name)
		}
	}
}
