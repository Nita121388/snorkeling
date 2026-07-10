// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/genconn"
)

type fakeShellClient struct {
	spec   genconn.CommandSpec
	stdout string
	stderr string
}

func (c *fakeShellClient) MakeProcessController(spec genconn.CommandSpec) (genconn.ShellProcessController, error) {
	c.spec = spec
	return &fakeShellProcess{stdout: c.stdout, stderr: c.stderr}, nil
}

type fakeShellProcess struct {
	stdout string
	stderr string
}

func (p *fakeShellProcess) Start() error {
	return nil
}

func (p *fakeShellProcess) Wait() error {
	return nil
}

func (p *fakeShellProcess) Kill() {
}

func (p *fakeShellProcess) StdinPipe() (io.WriteCloser, error) {
	return nopWriteCloser{}, nil
}

func (p *fakeShellProcess) StdoutPipe() (io.Reader, error) {
	return strings.NewReader(p.stdout), nil
}

func (p *fakeShellProcess) StderrPipe() (io.Reader, error) {
	return strings.NewReader(p.stderr), nil
}

type nopWriteCloser struct {
}

func (nopWriteCloser) Write(p []byte) (int, error) {
	return len(p), nil
}

func (nopWriteCloser) Close() error {
	return nil
}

func TestFindCommandOnShellClientUsesRemoteFallbackScript(t *testing.T) {
	client := &fakeShellClient{stdout: "/Users/nita/.local/bin/claude\n"}

	got, err := findCommandOnShellClient(context.Background(), client, "claude", "~/project")
	if err != nil {
		t.Fatalf("findCommandOnShellClient returned error: %v", err)
	}
	if got != "/Users/nita/.local/bin/claude" {
		t.Fatalf("expected resolved command path, got %q", got)
	}
	if client.spec.Cwd != "~/project" {
		t.Fatalf("expected cwd to be passed through, got %q", client.spec.Cwd)
	}
	for _, want := range []string{
		`command -v "$cmd"`,
		`"$HOME/.local/bin"`,
		`"/opt/homebrew/bin"`,
		`"/usr/local/bin"`,
	} {
		if !strings.Contains(client.spec.Cmd, want) {
			t.Fatalf("expected lookup script to contain %q, got:\n%s", want, client.spec.Cmd)
		}
	}
}

func TestFirstOutputLineTrimsBlankAndExtraOutput(t *testing.T) {
	got := firstOutputLine("\n  /Users/nita/.local/bin/claude  \nignored\n")
	if got != "/Users/nita/.local/bin/claude" {
		t.Fatalf("expected first output line, got %q", got)
	}
}
