// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// A base-URL endpoint (https://host/v1) used to be POSTed verbatim, which many
// gateways answer with `404 page not found`; the request must go to the chat
// completions path instead.
func TestBuildChatHTTPRequest_BaseURLEndpointGetsChatPath(t *testing.T) {
	chatOpts := uctypes.WaveChatOpts{
		ChatId: "test",
		Config: uctypes.AIOptsType{
			Provider: "custom",
			APIType:  uctypes.APIType_OpenAIChat,
			Model:    "gpt-4o-mini",
			Endpoint: "https://api.example.com/v1",
			APIToken: "sk-test",
		},
	}
	req, err := buildChatHTTPRequest(context.Background(), nil, chatOpts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "https://api.example.com/v1/chat/completions"
	if got := req.URL.String(); got != want {
		t.Fatalf("request URL = %q, want %q", got, want)
	}
}

func TestBuildChatHTTPRequest_FullURLEndpointUnchanged(t *testing.T) {
	chatOpts := uctypes.WaveChatOpts{
		ChatId: "test",
		Config: uctypes.AIOptsType{
			Provider: "custom",
			APIType:  uctypes.APIType_OpenAIChat,
			Model:    "gpt-4o-mini",
			Endpoint: "https://api.example.com/v1/chat/completions",
			APIToken: "sk-test",
		},
	}
	req, err := buildChatHTTPRequest(context.Background(), nil, chatOpts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "https://api.example.com/v1/chat/completions"
	if got := req.URL.String(); got != want {
		t.Fatalf("request URL = %q, want %q", got, want)
	}
}
