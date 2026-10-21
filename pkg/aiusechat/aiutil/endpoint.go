// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"net/url"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// Why this file exists.
//
// `ai:endpoint` has always been documented as the *full request URL*, and every
// built-in provider template writes one (`.../v1/chat/completions`). But two
// other ways of filling the same field write a *base URL* instead:
//
//   - cc-switch import copies the provider's `baseUrl` verbatim
//     (`https://open.bigmodel.cn/api/paas/v4`, `https://api.foo.com/v1`, ...)
//   - users type a base URL because every other tool calls that a "base URL"
//
// `FetchModels` tolerated both shapes (it trims `/chat/completions` and appends
// `/models`), so the model list came back fine — while the chat request POSTed
// to the bare base URL and the server answered `404 page not found`. That is a
// confusing pair: "models load but chat 404s".
//
// The rule below is deliberately narrow: only rewrite an endpoint that is
// unambiguously a base URL (bare host, or path ending in a version segment such
// as `/v1`, `/v4`, `/v1beta`). Anything else — Wave's `/api/waveai`, Azure's
// deployment URLs with `?api-version=`, Gemini's `models/<model>:method` — is
// returned untouched, so no existing working config changes meaning.

// endpointTerminals maps an API type to the path suffix of its request URL.
// An empty value means this API type embeds the model in the path and must not
// be rewritten.
func endpointTerminal(apiType string) string {
	switch apiType {
	case uctypes.APIType_OpenAIResponses:
		return "/responses"
	case uctypes.APIType_AnthropicMessages:
		return "/messages"
	case uctypes.APIType_OpenAIChat:
		return "/chat/completions"
	default:
		return ""
	}
}

// isVersionSegment reports whether a single path segment looks like an API
// version ("v1", "v4", "v1beta", "v2alpha1").
func isVersionSegment(segment string) bool {
	if len(segment) < 2 || segment[0] != 'v' {
		return false
	}
	if segment[1] < '0' || segment[1] > '9' {
		return false
	}
	for _, r := range segment[2:] {
		if (r < '0' || r > '9') && (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') {
			return false
		}
	}
	return true
}

// basePathSuffixes are trailing path segments that are clearly still part of a
// base URL rather than a request path.
var basePathSuffixes = map[string]bool{
	"openai": true,
	"api":    true,
	"v1":     true,
}

func lastPathSegment(path string) string {
	trimmed := strings.TrimRight(path, "/")
	if idx := strings.LastIndex(trimmed, "/"); idx >= 0 {
		return trimmed[idx+1:]
	}
	return trimmed
}

// ResolveChatEndpoint turns any accepted `ai:endpoint` shape into the concrete
// request URL for apiType.
//
// Accepted verbatim: endpoints that already end with the API's terminal path,
// and endpoints with a custom path (Wave proxy, Azure deployments, anything we
// cannot classify). Rewritten: bare hosts (`https://api.openai.com`) and bases
// ending in a version segment (`https://api.deepseek.com/v1`), the two shapes
// that otherwise POST to the wrong path.
func ResolveChatEndpoint(endpoint string, apiType string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return ""
	}
	terminal := endpointTerminal(apiType)
	if terminal == "" {
		return trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return trimmed
	}
	path := strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(path, terminal) {
		if path == parsed.Path {
			return trimmed
		}
		parsed.Path = path
		parsed.RawPath = ""
		return parsed.String()
	}
	lastSegment := lastPathSegment(path)
	if lastSegment != "" && !isVersionSegment(lastSegment) && !basePathSuffixes[lastSegment] {
		// A custom, non-version path: assume the user (or a template) meant it
		// literally and leave it alone.
		return trimmed
	}
	joinPath := terminal
	if !isVersionSegment(lastSegment) {
		joinPath = "/v1" + terminal
	}
	parsed.Path = path + joinPath
	parsed.RawPath = ""
	return parsed.String()
}

// ResolveModelsEndpoint turns any accepted `ai:endpoint` shape into the URL of
// the OpenAI-compatible model list (`<base>/models`), which is what the
// "Fetch from endpoint" button calls. It resolves the endpoint first so that a
// bare host becomes `/v1/models` instead of `/models`.
//
// Unlike the chat path, this never inserts a version segment into an existing
// path: a custom path such as Wave's `/api/waveai` keeps its own shape.
func ResolveModelsEndpoint(endpoint string) string {
	resolved := ResolveChatEndpoint(endpoint, uctypes.APIType_OpenAIChat)
	if resolved == "" {
		return ""
	}
	parsed, err := url.Parse(resolved)
	if err != nil || parsed.Host == "" {
		base := strings.TrimRight(resolved, "/")
		for _, terminal := range []string{"/chat/completions", "/responses", "/messages"} {
			base = strings.TrimSuffix(base, terminal)
		}
		return strings.TrimRight(base, "/") + "/models"
	}
	path := strings.TrimRight(parsed.Path, "/")
	for _, terminal := range []string{"/chat/completions", "/responses", "/messages"} {
		if strings.HasSuffix(path, terminal) {
			path = strings.TrimSuffix(path, terminal)
			break
		}
	}
	path = strings.TrimRight(path, "/")
	if path == "" {
		// Same version assumption ResolveChatEndpoint makes for a bare host.
		path = "/v1"
	}
	if !strings.HasSuffix(path, "/models") {
		path = path + "/models"
	}
	parsed.Path = path
	parsed.RawPath = ""
	return parsed.String()
}

// ResolveGeminiEndpoint handles the Gemini shape, where the model name is part
// of the path (`.../v1beta/models/<model>:streamGenerateContent`). A bare base
// URL (`https://generativelanguage.googleapis.com`) or a `.../v1beta` base is
// expanded with the model and streaming method; an endpoint that already names
// a method (its last path segment contains the `:` separator) is left untouched.
func ResolveGeminiEndpoint(endpoint string, model string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return trimmed
	}
	path := strings.TrimRight(parsed.Path, "/")
	if strings.Contains(lastPathSegment(path), ":") {
		return trimmed
	}
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	if model == "" {
		return trimmed
	}
	if !strings.HasSuffix(path, "/models") {
		if !isVersionSegment(lastPathSegment(path)) {
			path = path + "/v1beta"
		}
		path = path + "/models"
	}
	parsed.Path = path + "/" + model + ":streamGenerateContent"
	parsed.RawPath = ""
	return parsed.String()
}
