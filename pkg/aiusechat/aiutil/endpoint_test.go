// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import "testing"

func TestResolveChatEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		apiType  string
		want     string
	}{
		{
			name:     "full chat url stays",
			endpoint: "https://api.openai.com/v1/chat/completions",
			apiType:  "openai-chat",
			want:     "https://api.openai.com/v1/chat/completions",
		},
		{
			name:     "version base gets chat path",
			endpoint: "https://api.inferaiapi.com/v1",
			apiType:  "openai-chat",
			want:     "https://api.inferaiapi.com/v1/chat/completions",
		},
		{
			name:     "version base with trailing slash",
			endpoint: "https://api.deepseek.com/v1/",
			apiType:  "openai-chat",
			want:     "https://api.deepseek.com/v1/chat/completions",
		},
		{
			name:     "bare host gets version and chat path",
			endpoint: "https://api.openai.com",
			apiType:  "openai-chat",
			want:     "https://api.openai.com/v1/chat/completions",
		},
		{
			name:     "versioned path without v1",
			endpoint: "https://open.bigmodel.cn/api/paas/v4",
			apiType:  "openai-chat",
			want:     "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		},
		{
			name:     "v1beta base gets chat path",
			endpoint: "https://generativelanguage.googleapis.com/v1beta",
			apiType:  "openai-chat",
			want:     "https://generativelanguage.googleapis.com/v1beta/chat/completions",
		},
		{
			name:     "responses terminal respected",
			endpoint: "https://api.openai.com/v1",
			apiType:  "openai-responses",
			want:     "https://api.openai.com/v1/responses",
		},
		{
			name:     "anthropic terminal",
			endpoint: "https://api.anthropic.com",
			apiType:  "anthropic-messages",
			want:     "https://api.anthropic.com/v1/messages",
		},
		{
			name:     "wave proxy path untouched",
			endpoint: "https://cfapi.waveterm.dev/api/waveai",
			apiType:  "openai-chat",
			want:     "https://cfapi.waveterm.dev/api/waveai",
		},
		{
			name:     "query string preserved",
			endpoint: "https://my-resource.openai.azure.com/openai/deployments/d/chat/completions?api-version=2025-04-01-preview",
			apiType:  "openai-chat",
			want:     "https://my-resource.openai.azure.com/openai/deployments/d/chat/completions?api-version=2025-04-01-preview",
		},
		{
			name:     "gemini endpoint untouched for chat api type",
			endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
			apiType:  "google-gemini",
			want:     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
		},
		{
			name:     "empty endpoint stays empty",
			endpoint: "",
			apiType:  "openai-chat",
			want:     "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveChatEndpoint(tc.endpoint, tc.apiType)
			if got != tc.want {
				t.Fatalf("ResolveChatEndpoint(%q, %q) = %q, want %q", tc.endpoint, tc.apiType, got, tc.want)
			}
		})
	}
}

func TestResolveModelsEndpoint(t *testing.T) {
	tests := []struct {
		endpoint string
		want     string
	}{
		{"https://api.inferaiapi.com/v1", "https://api.inferaiapi.com/v1/models"},
		{"https://api.inferaiapi.com/v1/", "https://api.inferaiapi.com/v1/models"},
		{"https://api.inferaiapi.com/v1/chat/completions", "https://api.inferaiapi.com/v1/models"},
		{"https://api.openai.com", "https://api.openai.com/v1/models"},
		{"https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/models"},
		{"https://api.openai.com/v1/models", "https://api.openai.com/v1/models"},
		{"https://cfapi.waveterm.dev/api/waveai", "https://cfapi.waveterm.dev/api/waveai/models"},
		{"", ""},
	}
	for _, tc := range tests {
		if got := ResolveModelsEndpoint(tc.endpoint); got != tc.want {
			t.Fatalf("ResolveModelsEndpoint(%q) = %q, want %q", tc.endpoint, got, tc.want)
		}
	}
}

func TestResolveGeminiEndpoint(t *testing.T) {
	tests := []struct {
		endpoint string
		model    string
		want     string
	}{
		{
			endpoint: "https://generativelanguage.googleapis.com",
			model:    "gemini-2.0-flash",
			want:     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
		},
		{
			endpoint: "https://generativelanguage.googleapis.com/v1beta",
			model:    "gemini-2.0-flash",
			want:     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
		},
		{
			endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
			model:    "gemini-2.0-flash",
			want:     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
		},
		{
			endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=k",
			model:    "gemini-2.0-flash",
			want:     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=k",
		},
	}
	for _, tc := range tests {
		if got := ResolveGeminiEndpoint(tc.endpoint, tc.model); got != tc.want {
			t.Fatalf("ResolveGeminiEndpoint(%q, %q) = %q, want %q", tc.endpoint, tc.model, got, tc.want)
		}
	}
}
