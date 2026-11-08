// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcap

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAgentCapabilityTexts(t *testing.T) {
	for name, text := range map[string]string{
		"guide":    GuideText(),
		"examples": ExamplesText(),
		"prompt":   ExternalAgentPrompt(),
	} {
		if !strings.Contains(text, "wsh data") {
			t.Fatalf("%s text should mention wsh data:\n%s", name, text)
		}
		if !strings.Contains(strings.ToLower(text), "sqlite") {
			t.Fatalf("%s text should warn about direct SQLite edits:\n%s", name, text)
		}
		if !strings.HasSuffix(text, "\n") {
			t.Fatalf("%s text should end with newline", name)
		}
	}
}

func TestSchemaTextIsJSON(t *testing.T) {
	var schema map[string]any
	if err := json.Unmarshal([]byte(SchemaText()), &schema); err != nil {
		t.Fatalf("schema should be valid JSON: %v", err)
	}
	if schema["title"] != "Snorkeling Agent Data Patch" {
		t.Fatalf("unexpected schema title: %#v", schema["title"])
	}
}

// TestSchemaCoversSessionControlOps keeps the advertised schema in sync with the
// operations agentdata actually accepts. An operation missing from the schema is
// invisible to an agent that builds patches from it.
func TestSchemaCoversSessionControlOps(t *testing.T) {
	schemaText := SchemaText()
	for _, op := range []string{
		"session_note.update",
		"session_title.update",
		"session_prop.update",
		"common_text.update",
		"tag.rename",
	} {
		if !strings.Contains(schemaText, `"const": "`+op+`"`) {
			t.Fatalf("schema does not declare operation %q", op)
		}
	}
	var schema map[string]any
	if err := json.Unmarshal([]byte(schemaText), &schema); err != nil {
		t.Fatalf("schema should be valid JSON: %v", err)
	}
	defs, ok := schema["$defs"].(map[string]any)
	if !ok {
		t.Fatal("schema lost its $defs")
	}
	for _, def := range []string{"sessionTitleUpdate", "sessionPropUpdate", "propPatch"} {
		if _, ok := defs[def]; !ok {
			t.Fatalf("schema is missing $defs.%s", def)
		}
	}
}

// TestExamplesCoverSessionControlOps guards the copyable examples the same way.
func TestExamplesCoverSessionControlOps(t *testing.T) {
	examples := ExamplesText()
	for _, want := range []string{"session_title.update", "session_prop.update"} {
		if !strings.Contains(examples, want) {
			t.Fatalf("examples do not show %q", want)
		}
	}
}

// TestAgentCardCommandsAreDiscoverable keeps the card shortcut advertised.
func TestAgentCardCommandsAreDiscoverable(t *testing.T) {
	for name, text := range map[string]string{
		"guide":  GuideText(),
		"prompt": ExternalAgentPrompt(),
	} {
		for _, want := range []string{"wsh agent card get", "wsh agent card set"} {
			if !strings.Contains(text, want) {
				t.Fatalf("%s text must advertise %q", name, want)
			}
		}
	}
}

// TestLiveSessionCommandsAreDiscoverable guards the agent-control discovery
// contract: the read-only session commands must be advertised in the guidance an
// agent actually loads, otherwise the capability exists but is unreachable.
func TestLiveSessionCommandsAreDiscoverable(t *testing.T) {
	for name, text := range map[string]string{
		"guide":  GuideText(),
		"prompt": ExternalAgentPrompt(),
	} {
		for _, want := range []string{"wsh session live", "wsh session get"} {
			if !strings.Contains(text, want) {
				t.Fatalf("%s text must advertise %q:\n%s", name, want, text)
			}
		}
		if strings.Contains(text, "\n`this` ") {
			t.Fatalf("%s text must not use backticks inside the raw literal", name)
		}
	}
}

// TestUIAndNavigateCommandsAreDiscoverable guards the P0.2 discovery contract:
// ui observe and block/tab navigation must be advertised where an agent looks,
// otherwise the capability exists but is unreachable.
func TestUIAndNavigateCommandsAreDiscoverable(t *testing.T) {
	for name, text := range map[string]string{
		"guide":  GuideText(),
		"prompt": ExternalAgentPrompt(),
	} {
		for _, want := range []string{"wsh ui active", "wsh block read"} {
			if !strings.Contains(text, want) {
				t.Fatalf("%s text must advertise %q:\n%s", name, want, text)
			}
		}
	}
	// the sync-state contract must be documented, not just the command name
	guide := GuideText()
	for _, want := range []string{"layout-queued", "layout-applied", "db-only"} {
		if !strings.Contains(guide, want) {
			t.Fatalf("guide must document syncState %q", want)
		}
	}
}
