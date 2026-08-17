// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import "context"

// SourcePi is the chat-layer source identifier for the pi agent (matches
// aisessions.SessionSummary.Source values so the two layers key on the same
// session ids).
const SourcePi = "pi"

// Provider is the "对话层" abstraction shared by all agents. It only knows how
// to *start* a machine-readable session for one source; the returned Session
// carries prompt/abort/stream/close. No session files are written here (the
// agent subprocess writes them) and no JSONL is parsed (the browsing layer
// pkg/aisessions.Provider does that).
type Provider interface {
	// Source matches the browsing layer's SessionSummary.Source (e.g. "pi").
	Source() string
	// Capabilities advertises what the frontend may show for this agent.
	Capabilities() Capabilities
	// Start spawns (or attaches to) a session. A given (sessionID, projectPath)
	// pair may be started once per GUI chat; the Manager keys sessions by it.
	Start(ctx context.Context, opts StartOptions) (*Session, error)
}

// StartOptions is the per-session launch configuration shared by all adapters.
type StartOptions struct {
	SessionID   string // agent's own session id (pi: session uuid)
	ProjectPath string // cwd the agent runs in
	FilePath    string // session file path (diagnostics only; never written)
	Provider    string // model provider (e.g. "openai"); optional
	Model       string // model id (e.g. "deepseek-v4-pro"); optional
	SessionDir  string // override the agent session storage dir; optional
	NoExtensions bool  // suppress extension loading (skips noisy extension UI events)
	Extra       map[string]any
}
