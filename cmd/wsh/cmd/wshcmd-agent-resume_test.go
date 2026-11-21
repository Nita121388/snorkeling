// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"testing"
)

// TestAgentResumeCmdRegistered guards the wiring bug where `agent resume` is
// defined but never attached to agentCmd (the command then exists in `strings`
// but not in the CLI).
func TestAgentResumeCmdRegistered(t *testing.T) {
	for _, sub := range agentCmd.Commands() {
		if sub.Name() == "resume" {
			return
		}
	}
	t.Fatal("agentCmd is missing subcommand \"resume\": `wsh agent resume` would be unknown")
}

// TestAgentResumeFlagMapping pins the flag -> DTO mapping (implement.md 1.4).
// The identifiers default, the --tab/--workspace passthrough and the send group
// are the parts a caller depends on, so each is asserted explicitly.
func TestAgentResumeFlagMapping(t *testing.T) {
	restore := func() {
		agentResumeBlock = ""
		agentResumeTab = "active"
		agentResumeWsId = ""
		agentResumeCwd = ""
		agentResumeNoFocus = false
		agentResumeWait = false
		agentResumeWaitMs = 0
		agentResumeSend = ""
		agentResumeSendStdin = false
		agentResumeNoSubmit = false
		agentResumeNoSendWait = false
		agentResumeSendWaitMs = 0
		agentResumeQuietMs = 0
		agentResumeSubmitDelayMs = 0
	}
	restore()
	defer restore()

	req, err := buildAgentResumeRequest("pi:abc:/tmp/x.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if req.Identifier != "pi:abc:/tmp/x.jsonl" || req.Tab != "active" {
		t.Fatalf("unexpected base request: %+v", req)
	}
	if req.SendText64 != "" || req.Submit != nil || req.SendWait != nil {
		t.Fatalf("send group must stay unset without --send: %+v", req)
	}

	agentResumeTab = "new"
	agentResumeWsId = "ws-1"
	agentResumeCwd = "/work"
	agentResumeNoFocus = true
	agentResumeWait = true
	agentResumeWaitMs = 2500
	agentResumeSend = "continue"
	agentResumeNoSubmit = true
	agentResumeNoSendWait = true
	agentResumeSendWaitMs = 45000
	agentResumeQuietMs = 800
	agentResumeSubmitDelayMs = 200

	req, err = buildAgentResumeRequest("sess-1")
	if err != nil {
		t.Fatal(err)
	}
	if req.Tab != "new" || req.WorkspaceId != "ws-1" || req.Cwd != "/work" {
		t.Fatalf("tab/workspace/cwd not mapped: %+v", req)
	}
	if !req.NoFocus || !req.Wait || req.WaitMs != 2500 {
		t.Fatalf("focus/wait flags not mapped: %+v", req)
	}
	if decoded, derr := base64.StdEncoding.DecodeString(req.SendText64); derr != nil || string(decoded) != "continue" {
		t.Fatalf("send text64 = %q err=%v", req.SendText64, derr)
	}
	if req.Submit == nil || *req.Submit {
		t.Fatalf("--no-submit must set Submit=false, got %v", req.Submit)
	}
	if req.SendWait == nil || *req.SendWait {
		t.Fatalf("--no-send-wait must set SendWait=false, got %v", req.SendWait)
	}
	if req.SendWaitMs != 45000 || req.QuietMs != 800 || req.SubmitDelayMs != 200 {
		t.Fatalf("send timing flags not mapped: %+v", req)
	}
}

// TestAgentResumeEmptyIdentifierDefaultsToThis: the positional arg maps to the
// `this` shorthand, which the backend resolves from the calling block.
func TestAgentResumeEmptyIdentifierDefaultsToThis(t *testing.T) {
	agentResumeBlock = ""
	defer func() { agentResumeBlock = "" }()
	req, err := buildAgentResumeRequest("")
	if err != nil {
		t.Fatal(err)
	}
	if req.Identifier != "this" {
		t.Fatalf("identifier = %q, want this", req.Identifier)
	}
}
