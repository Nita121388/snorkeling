// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Red-proof prerequisites for F-1121-agent-resume: these call the resume command
// that does not exist yet, so the package is red until it is implemented.

func TestAgentResumeRejectsRemoteConnection(t *testing.T) {
	ws := &WshServer{}
	_, err := ws.AgentResumeCommand(context.Background(), wshrpc.AgentResumeRequest{
		Identifier: "codex:abc:/tmp/s.jsonl",
		Connection: "some-remote",
	})
	if err == nil {
		t.Fatalf("remote resume accepted, want E_NOT_SUPPORTED")
	}
}

func TestAgentResumeMissingSession(t *testing.T) {
	ws := &WshServer{}
	_, err := ws.AgentResumeCommand(context.Background(), wshrpc.AgentResumeRequest{
		Identifier: "codex:definitely-not-there:/tmp/nope.jsonl",
	})
	if err == nil {
		t.Fatalf("missing session accepted, want E_NOT_FOUND")
	}
}

func TestAgentResumeNewTabRequiresWorkspace(t *testing.T) {
	ws := &WshServer{}
	_, err := ws.AgentResumeCommand(context.Background(), wshrpc.AgentResumeRequest{
		Identifier: "codex:abc:/tmp/s.jsonl",
		Tab:        "new",
	})
	if err == nil {
		t.Fatalf("--tab new without workspace accepted, want E_USAGE")
	}
}

func TestSessionMarkRequiresIdentifier(t *testing.T) {
	ws := &WshServer{}
	if _, err := ws.SessionMarkCommand(context.Background(), wshrpc.SessionMarkRequest{}); err == nil {
		t.Fatalf("empty identifier accepted, want E_USAGE")
	}
}
