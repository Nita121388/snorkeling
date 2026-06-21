// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/genconn"
)

type fakePlatformShell struct {
	commands []string
}

func (s *fakePlatformShell) MakeProcessController(cmd genconn.CommandSpec) (genconn.ShellProcessController, error) {
	s.commands = append(s.commands, cmd.Cmd)
	switch len(s.commands) {
	case 1:
		return &fakePlatformProcess{
			stdout: "'uname' " + string([]byte{0xb2, 0xbb, 0xca, 0xc7}),
			err:    errors.New("exit status 1"),
		}, nil
	case 2:
		return &fakePlatformProcess{stdout: "windows x64\n"}, nil
	default:
		return nil, errors.New("unexpected command")
	}
}

type fakePlatformProcess struct {
	stdout string
	stderr string
	err    error
}

func (p *fakePlatformProcess) Start() error {
	return nil
}

func (p *fakePlatformProcess) Wait() error {
	return p.err
}

func (p *fakePlatformProcess) Kill() {
}

func (p *fakePlatformProcess) StdinPipe() (io.WriteCloser, error) {
	return nopWriteCloser{bytes.NewBuffer(nil)}, nil
}

func (p *fakePlatformProcess) StdoutPipe() (io.Reader, error) {
	return strings.NewReader(p.stdout), nil
}

func (p *fakePlatformProcess) StderrPipe() (io.Reader, error) {
	return strings.NewReader(p.stderr), nil
}

type nopWriteCloser struct {
	*bytes.Buffer
}

func (w nopWriteCloser) Close() error {
	return nil
}

func TestGetClientPlatformFromOsArchStrNormalizesWindowsUname(t *testing.T) {
	clientOs, clientArch, err := GetClientPlatformFromOsArchStr(context.Background(), "MINGW64_NT-10.0-26200 x86_64")
	if err != nil {
		t.Fatalf("GetClientPlatformFromOsArchStr returned error: %v", err)
	}
	if clientOs != "windows" || clientArch != "x64" {
		t.Fatalf("expected windows/x64, got %s/%s", clientOs, clientArch)
	}
}

func TestGetClientPlatformFallsBackForWindowsCmdShell(t *testing.T) {
	shell := &fakePlatformShell{}
	clientOs, clientArch, err := GetClientPlatform(context.Background(), shell)
	if err != nil {
		t.Fatalf("GetClientPlatform returned error: %v", err)
	}
	if clientOs != "windows" || clientArch != "x64" {
		t.Fatalf("expected windows/x64, got %s/%s", clientOs, clientArch)
	}
	if len(shell.commands) != 2 || !strings.Contains(shell.commands[1], "-EncodedCommand") {
		t.Fatalf("expected encoded powershell fallback command, got %#v", shell.commands)
	}
}

func TestGetRemoteWshPathUsesExeForWindows(t *testing.T) {
	if path := GetRemoteWshPath("windows"); path != "~/.snorkeling/bin/wsh.exe" {
		t.Fatalf("expected windows remote wsh path to use .exe, got %q", path)
	}
}

func TestGetRemoteWshTempPathUsesTmpDirForWindows(t *testing.T) {
	path := getRemoteWshTempPath("windows", "~/.snorkeling/bin/wsh.exe")
	if !strings.HasPrefix(path, "~/.snorkeling/tmp/wsh.exe.") {
		t.Fatalf("expected windows remote temp path under ~/.snorkeling/tmp, got %q", path)
	}
}

func TestMakeWindowsAutoInstallWshCommandUsesEncodedPowerShell(t *testing.T) {
	cmd := makeWindowsAutoInstallWshCommand("~/.snorkeling/tmp/wsh.exe.tmp", "~/.snorkeling/bin/wsh.exe", 123)
	if !strings.Contains(cmd, "powershell -NoProfile -NonInteractive") {
		t.Fatalf("expected windows auto install to use powershell")
	}
	if !strings.Contains(cmd, "-EncodedCommand") {
		t.Fatalf("expected windows auto install powershell command to be encoded")
	}
	if strings.Contains(cmd, "Move-Item") || strings.Contains(cmd, "chmod") || strings.Contains(cmd, "cat >") {
		t.Fatalf("expected raw install script to be encoded")
	}
}

func TestExtractWshVersionLineSkipsPowerShellNoise(t *testing.T) {
	output := "#< CLIXML\nwsh v0.14.5-beta.4.snorkeling.0.0.42\n"
	if got := extractWshVersionLine(output); got != "wsh v0.14.5-beta.4.snorkeling.0.0.42" {
		t.Fatalf("unexpected version line: %q", got)
	}
}
