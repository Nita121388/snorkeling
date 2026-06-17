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
