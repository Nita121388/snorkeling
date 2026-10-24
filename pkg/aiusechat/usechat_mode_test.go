// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestApplyProviderDefaultsGroq(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_Groq,
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIChat {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIChat, config.APIType)
	}
	if config.Endpoint != GroqChatEndpoint {
		t.Fatalf("expected endpoint %q, got %q", GroqChatEndpoint, config.Endpoint)
	}
	if config.APITokenSecretNameValue() != GroqAPITokenSecretName {
		t.Fatalf("expected API token secret name %q, got %q", GroqAPITokenSecretName, config.APITokenSecretNameValue())
	}
}

func TestApplyProviderDefaultsKeepsProxyURL(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_OpenAI,
		Model:    "gpt-5-mini",
		ProxyURL: "http://localhost:8080",
	}
	applyProviderDefaults(&config)
	if config.ProxyURL != "http://localhost:8080" {
		t.Fatalf("expected proxy URL to be preserved, got %q", config.ProxyURL)
	}
}

// An unset secret name still receives the provider default, so legacy configs
// that never mentioned `ai:apitokensecretname` keep working.
func TestApplyProviderDefaultsFillsUnsetSecretName(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_OpenAI,
	}
	applyProviderDefaults(&config)
	if config.APITokenSecretNameValue() != OpenAIAPITokenSecretName {
		t.Fatalf("expected default secret name %q, got %q", OpenAIAPITokenSecretName, config.APITokenSecretNameValue())
	}
}

// An explicitly cleared secret name ("" rather than nil) must survive provider
// defaults: that is what lets "clear the field" stick instead of snapping back
// to OPENAI_KEY on the next config broadcast.
func TestApplyProviderDefaultsKeepsExplicitlyClearedSecretName(t *testing.T) {
	empty := ""
	config := wconfig.AIModeConfigType{
		Provider:           uctypes.AIProvider_OpenAI,
		APITokenSecretName: &empty,
	}
	applyProviderDefaults(&config)
	if config.APITokenSecretName == nil {
		t.Fatal("expected the cleared secret name to stay non-nil")
	}
	if config.APITokenSecretNameValue() != "" {
		t.Fatalf("expected the cleared secret name to stay empty, got %q", config.APITokenSecretNameValue())
	}
}

// The tri-state only works if JSON round-tripping preserves the difference
// between an absent key (nil) and an explicit empty string (pointer to "").
func TestAPITokenSecretNameJSONRoundTrip(t *testing.T) {
	var unset wconfig.AIModeConfigType
	if err := json.Unmarshal([]byte(`{"display:name":"My AI","ai:provider":"openai"}`), &unset); err != nil {
		t.Fatalf("unmarshal unset: %v", err)
	}
	if unset.APITokenSecretName != nil {
		t.Fatalf("absent key must stay nil, got %q", unset.APITokenSecretNameValue())
	}

	var cleared wconfig.AIModeConfigType
	if err := json.Unmarshal([]byte(`{"display:name":"My AI","ai:provider":"openai","ai:apitokensecretname":""}`), &cleared); err != nil {
		t.Fatalf("unmarshal cleared: %v", err)
	}
	if cleared.APITokenSecretName == nil {
		t.Fatal("explicit empty string must unmarshal to a non-nil pointer")
	}
	if cleared.APITokenSecretNameValue() != "" {
		t.Fatalf("expected empty secret name, got %q", cleared.APITokenSecretNameValue())
	}

	// Re-marshaling a cleared value must keep the key so the next read still
	// sees "cleared" rather than falling back to the provider default.
	encoded, err := json.Marshal(cleared)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var again wconfig.AIModeConfigType
	if err := json.Unmarshal(encoded, &again); err != nil {
		t.Fatalf("re-unmarshal: %v", err)
	}
	if again.APITokenSecretName == nil || again.APITokenSecretNameValue() != "" {
		t.Fatalf("cleared secret name did not survive round-trip: %s", encoded)
	}

	resolvedOne := map[string]wconfig.AIModeConfigType{"custom@x": cleared}
	resolved := ComputeResolvedAIModeConfigs(wconfig.FullConfigType{WaveAIModes: resolvedOne})
	if resolved["custom@x"].APITokenSecretNameValue() != "" {
		t.Fatalf("resolved config refilled the cleared secret name: %q", resolved["custom@x"].APITokenSecretNameValue())
	}
}
