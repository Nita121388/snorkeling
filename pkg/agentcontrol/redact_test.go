// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestRedactMetaAllowlist(t *testing.T) {
	meta := waveobj.MetaMapType{
		"view":    "term",
		"cmd:cwd": "/repo",
		"cmd:env": "API_KEY=secret",
		"url":     "https://example.com/cb?token=abc123&x=1",
		"unknown": "drop-me",
	}
	got := RedactMeta(meta)
	if _, ok := got["cmd:env"]; ok {
		t.Fatalf("cmd:env must not be exposed: %+v", got)
	}
	if _, ok := got["unknown"]; ok {
		t.Fatalf("non-allowlisted key must be dropped: %+v", got)
	}
	if got["view"] != "term" || got["cmd:cwd"] != "/repo" {
		t.Fatalf("allowlisted keys must pass through: %+v", got)
	}
	if got["url"] != "https://example.com/cb?token=***&x=1" {
		t.Fatalf("url token must be redacted: %q", got["url"])
	}
}

func TestRedactString(t *testing.T) {
	if RedactString("") != "" {
		t.Fatal("empty string must stay empty")
	}
	if got := RedactString("plain text"); got != "plain text" {
		t.Fatalf("unexpected redaction: %q", got)
	}
	if got := RedactString("x?apikey=abc"); got != "x?apikey=***" {
		t.Fatalf("apikey not redacted: %q", got)
	}
	if got := RedactString("password=hunter2 next"); got != "password=*** next" {
		t.Fatalf("password not redacted: %q", got)
	}
}
