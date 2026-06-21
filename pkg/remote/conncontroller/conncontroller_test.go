// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func TestIsStreamlocalForwardDenied(t *testing.T) {
	err := errors.New("unable to request connection domain socket: ssh: streamlocal-forward@openssh.com request denied by peer")
	if !isStreamlocalForwardDenied(err) {
		t.Fatalf("expected streamlocal-forward denied error to be detected")
	}
}

func TestIsStreamlocalForwardDeniedRejectsOtherErrors(t *testing.T) {
	err := errors.New("unable to request connection domain socket: random failure")
	if isStreamlocalForwardDenied(err) {
		t.Fatalf("expected unrelated domain socket error to be rejected")
	}
}

func TestConnServerCmdTemplatePrefersExeOnWindowsShells(t *testing.T) {
	cmd := fmt.Sprintf(
		ConnServerCmdTemplate,
		shellutil.SoftQuote("~/.snorkeling/bin/wsh"),
		shellutil.SoftQuote("~/.snorkeling/bin/wsh.exe"),
		shellutil.SoftQuote("~/.snorkeling/bin/wsh.exe"),
		shellutil.SoftQuote("~/.snorkeling/bin/wsh.exe"),
		shellutil.SoftQuote("~/.snorkeling/bin/wsh.exe"),
		shellutil.HardQuote("break@100.65.122.71"),
		"",
		"--router",
	)
	if !strings.Contains(cmd, `MINGW*|MSYS*|CYGWIN*`) {
		t.Fatalf("expected windows shell case in connserver command")
	}
	if !strings.Contains(cmd, `wshbin=~/.snorkeling/bin/wsh.exe`) {
		t.Fatalf("expected connserver command to assign wsh.exe")
	}
}

func TestMakeWindowsWshPathExprUsesHomeJoin(t *testing.T) {
	got := makeWindowsWshPathExpr(wavebase.RemoteFullWshBinPath)
	if got != `Join-Path $HOME ".snorkeling\bin\wsh.exe"` {
		t.Fatalf("unexpected windows wsh path expression: %q", got)
	}
}

func TestIsWindowsCmdUnknownCommandDetectsChineseCmdOutput(t *testing.T) {
	output := "'uname' " + string([]byte{0xb2, 0xbb, 0xca, 0xc7})
	if !isWindowsCmdUnknownCommand(output, "uname") {
		t.Fatalf("expected windows cmd unknown-command output to be detected")
	}
}

func TestMakeWindowsConnServerCmdUsesEncodedPowerShell(t *testing.T) {
	cmd := makeWindowsConnServerCmd(wavebase.RemoteFullWshBinPath, "break@100.65.122.71", "", "--router")
	if !strings.Contains(cmd, "powershell -NoProfile -NonInteractive") {
		t.Fatalf("expected remote command to use powershell")
	}
	if !strings.Contains(cmd, "-EncodedCommand") {
		t.Fatalf("expected remote powershell command to be encoded")
	}
	if strings.Contains(cmd, "Join-Path") || strings.Contains(cmd, "connserver") {
		t.Fatalf("expected raw powershell script to be encoded")
	}
}

func TestMakeWindowsConnServerProbeCmdUsesEncodedPowerShell(t *testing.T) {
	cmd := makeWindowsConnServerProbeCmd(wavebase.RemoteFullWshBinPath)
	if !strings.Contains(cmd, "powershell -NoProfile -NonInteractive") {
		t.Fatalf("expected probe command to use powershell")
	}
	if !strings.Contains(cmd, "-EncodedCommand") {
		t.Fatalf("expected probe command to be encoded")
	}
	if strings.Contains(cmd, "probe-ok") || strings.Contains(cmd, "WshPath") {
		t.Fatalf("expected raw probe script to be encoded")
	}
}

func TestProbeOutputMissingIsAllowed(t *testing.T) {
	stdout := "probe-missing"
	stderr := "[snorkeling-wsh-probe] WshExists=False"
	if !isWindowsProbeSuccess(stdout, stderr) {
		t.Fatalf("expected missing wsh probe to allow not-installed flow")
	}
}

func TestReadWshVersionLineSkipsPowerShellNoise(t *testing.T) {
	ch := make(chan utilfn.LineOutput, 2)
	ch <- utilfn.LineOutput{Line: "#< CLIXML"}
	ch <- utilfn.LineOutput{Line: "wsh v0.14.5-beta.4.snorkeling.0.0.42"}
	ctx, cancelFn := context.WithTimeout(context.Background(), time.Second)
	defer cancelFn()
	line, err := readWshVersionLine(ctx, ch, makeRecentLinesBuffer(5), makeRecentLinesBuffer(5))
	if err != nil {
		t.Fatalf("readWshVersionLine returned error: %v", err)
	}
	if line != "wsh v0.14.5-beta.4.snorkeling.0.0.42" {
		t.Fatalf("unexpected version line: %q", line)
	}
}

func TestReadWshVersionLineTimeoutIncludesRecentOutput(t *testing.T) {
	ch := make(chan utilfn.LineOutput, 1)
	ch <- utilfn.LineOutput{Line: "noise"}
	stdout := makeRecentLinesBuffer(5)
	stderr := makeRecentLinesBuffer(5)
	stderr.Add("[snorkeling-wsh-start] script started")
	ctx, cancelFn := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancelFn()
	_, err := readWshVersionLine(ctx, ch, stdout, stderr)
	if err == nil {
		t.Fatalf("expected timeout error")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "recent stdout") || !strings.Contains(errStr, "noise") || !strings.Contains(errStr, "script started") {
		t.Fatalf("expected timeout error to include recent output, got %q", errStr)
	}
}

func TestWrapConnServerStartErrorIncludesDiag(t *testing.T) {
	diag := makeConnServerStartDiag(ConnServerMode_DomainSocketRouter, ConnServerMode_StdioRouter, false, `cmdver err=timeout`, "~/.snorkeling/bin/wsh", "--router", "posix-sh")
	err := wrapConnServerStartError(errors.New("boom"), diag)
	errStr := err.Error()
	for _, want := range []string{"boom", "requestedMode=router-domainsocket", "startMode=router-stdio", "windows=false", "commandKind=posix-sh"} {
		if !strings.Contains(errStr, want) {
			t.Fatalf("expected wrapped error to contain %q, got %q", want, errStr)
		}
	}
}
