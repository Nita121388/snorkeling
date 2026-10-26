// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"io"
	"os"
	"path/filepath"
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

func TestCommonCandidateDirsIncludesOpencode(t *testing.T) {
	dirs := candidateCommandDirs("/home/nita")
	var hasOpencode, hasLocalBin, hasHomebrew bool
	for _, d := range dirs {
		switch d {
		case "/home/nita/.opencode/bin":
			hasOpencode = true
		case "/home/nita/.local/bin":
			hasLocalBin = true
		case "/opt/homebrew/bin":
			hasHomebrew = true
		}
	}
	if !hasOpencode {
		t.Fatalf("expected ~/.opencode/bin in candidate dirs, got %v", dirs)
	}
	if !hasLocalBin {
		t.Fatalf("expected ~/.local/bin in candidate dirs, got %v", dirs)
	}
	if !hasHomebrew {
		t.Fatalf("expected /opt/homebrew/bin in candidate dirs, got %v", dirs)
	}
}

func TestParsePathFromEnvOutput(t *testing.T) {
	out := "SHELL=/bin/zsh\nPATH=/usr/bin:/bin:/Users/nita/.opencode/bin:/opt/homebrew/bin\nHOME=/Users/nita\n"
	dirs := parsePathFromEnvOutput(out)
	expected := []string{"/usr/bin", "/bin", "/Users/nita/.opencode/bin", "/opt/homebrew/bin"}
	if len(dirs) != len(expected) {
		t.Fatalf("expected %v, got %v", expected, dirs)
	}
	for i := range expected {
		if dirs[i] != expected[i] {
			t.Fatalf("dir %d: expected %q, got %q", i, expected[i], dirs[i])
		}
	}
}

func TestParsePathFromEnvOutputNoPathLine(t *testing.T) {
	if got := parsePathFromEnvOutput("FOO=bar\nBAZ=qux\n"); got != nil {
		t.Fatalf("expected nil when no PATH line, got %v", got)
	}
}

func TestFindCommandFallbackToCandidateDir(t *testing.T) {
	// Simulate a GUI process with a bare launchd PATH so exec.LookPath cannot find the
	// command, but a fake executable lives in ~/.opencode/bin (opencode's default dir).
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	home := t.TempDir()
	t.Setenv("HOME", home)
	binDir := filepath.Join(home, ".opencode", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	fake := filepath.Join(binDir, "opencode")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write fake binary: %v", err)
	}

	// The candidate-dir scan must resolve without consulting the login-shell probe;
	// this asserts the deterministic fallback path itself works.
	got := resolveCommandWithFallback("opencode")
	if got != fake {
		t.Fatalf("expected fallback to resolve %q, got %q", fake, got)
	}
	if !strings.HasSuffix(got, filepath.Join(".opencode", "bin", "opencode")) {
		t.Fatalf("expected path under ~/.opencode/bin, got %q", got)
	}
}

func TestResolveCommandWithFallbackNoFalsePositive(t *testing.T) {
	t.Setenv("PATH", "/usr/bin:/bin")
	// No candidate dirs contain a binary named "definitely-not-a-real-agent-xyz".
	got := resolveCommandWithFallback("definitely-not-a-real-agent-xyz")
	if got != "" {
		t.Fatalf("expected empty result for nonexistent command, got %q", got)
	}
}

func TestMakeFindCommandScriptUsesSharedDirs(t *testing.T) {
	script := makeFindCommandScript("opencode")
	for _, want := range []string{
		`"$HOME/.opencode/bin"`,
		`"$HOME/.local/bin"`,
		`"/opt/homebrew/bin"`,
		`"/usr/local/bin"`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("expected remote script to contain %q, got:\n%s", want, script)
		}
	}
}
