// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package genconn

import (
	"strings"
	"testing"
)

func TestBuildShellCommandPreservesHomeCwdExpansion(t *testing.T) {
	tests := []struct {
		name    string
		cwd     string
		wantCwd string
	}{
		{name: "home", cwd: "~", wantCwd: "cd ~ &&"},
		{name: "home subdirectory", cwd: "~/Project Files", wantCwd: `cd ~/\"Project Files\" &&`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command, err := BuildShellCommand(CommandSpec{Cmd: "run-agent", Cwd: test.cwd})
			if err != nil {
				t.Fatalf("BuildShellCommand returned error: %v", err)
			}
			if !strings.Contains(command, test.wantCwd) {
				t.Fatalf("expected expandable home cwd %q in command:\n%s", test.wantCwd, command)
			}
		})
	}
}

func TestBuildShellCommandGatesEntireMultilineScriptOnCwd(t *testing.T) {
	command, err := BuildShellCommand(CommandSpec{Cmd: "first\nsecond", Cwd: "/srv/project"})
	if err != nil {
		t.Fatalf("BuildShellCommand returned error: %v", err)
	}
	if !strings.Contains(command, "cd /srv/project && {\nfirst\nsecond\n}") {
		t.Fatalf("expected cwd to gate the entire multiline script:\n%s", command)
	}
}
