// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/pslog"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type ClientService struct{}

const DefaultTimeout = 2 * time.Second

func (cs *ClientService) GetClientData() (*waveobj.Client, error) {
	log.Println("GetClientData")
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	return wcore.GetClientData(ctx)
}

func (cs *ClientService) GetTab(tabId string) (*waveobj.Tab, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	return tab, nil
}

func (cs *ClientService) GetAllConnStatus(ctx context.Context) ([]wshrpc.ConnStatus, error) {
	sshStatuses := conncontroller.GetAllConnStatus()
	wslStatuses := wslconn.GetAllConnStatus()
	return append(sshStatuses, wslStatuses...), nil
}

func (cs *ClientService) FindCommand(ctx context.Context, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", nil
	}
	path, err := exec.LookPath(command)
	if err != nil {
		return "", nil
	}
	return path, nil
}

func (cs *ClientService) FindCommandForConnection(ctx context.Context, command string, connName string, cwd string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", nil
	}
	connName = strings.TrimSpace(connName)
	if conncontroller.IsLocalConnName(connName) {
		return cs.FindCommand(ctx, command)
	}
	ctx, cancelFn := context.WithTimeout(ctx, DefaultTimeout)
	defer cancelFn()
	if strings.HasPrefix(connName, "wsl://") {
		wslName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(wslName)
		if conn == nil {
			return "", fmt.Errorf("wsl connection not found: %s", connName)
		}
		if conn.DeriveConnStatus().Status != conncontroller.Status_Connected {
			return "", fmt.Errorf("wsl connection %s not connected", connName)
		}
		return findCommandOnShellClient(ctx, genconn.MakeWSLShellClient(conn.GetClient()), command, cwd)
	}
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", fmt.Errorf("invalid ssh remote name (%s): %w", connName, err)
	}
	conn := conncontroller.MaybeGetConn(opts)
	if conn == nil {
		return "", fmt.Errorf("ssh connection not found: %s", connName)
	}
	if conn.DeriveConnStatus().Status != conncontroller.Status_Connected {
		return "", fmt.Errorf("ssh connection %s not connected", connName)
	}
	return findCommandOnShellClient(ctx, genconn.MakeSSHShellClient(conn.GetClient()), command, cwd)
}

func findCommandOnShellClient(ctx context.Context, client genconn.ShellClient, command string, cwd string) (string, error) {
	script := makeFindCommandScript(command)
	log.Printf("FINDCMD-FORSHIP cmd=[%q] cwd=[%q] script=[%q]", command, cwd, script)
	pslog.AppendRaw("findcmd-forship", fmt.Sprintf("cmd=%q cwd=%q script=%q", command, cwd, script))
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, client, genconn.CommandSpec{
		Cmd: script,
		Cwd: strings.TrimSpace(cwd),
	})
	log.Printf("FINDCMD-RESULT stdout=[%q] stderr=[%q] err=[%v]", stdout, stderr, err)
	pslog.AppendRaw("findcmd-result", fmt.Sprintf("stdout=%q stderr=%q err=%v", stdout, stderr, err))
	if err != nil {
		return "", err
	}
	return firstOutputLine(stdout), nil
}

func firstOutputLine(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	line, _, _ := strings.Cut(output, "\n")
	return strings.TrimSpace(line)
}

func makeFindCommandScript(command string) string {
	quotedCommand := shellutil.HardQuote(strings.TrimSpace(command))
	return strings.Join([]string{
		"cmd=" + quotedCommand,
		`if [ -z "$cmd" ]; then exit 0; fi`,
		`case "$cmd" in`,
		`  */*)`,
		`    if [ -x "$cmd" ]; then printf '%s\n' "$cmd"; fi`,
		`    exit 0`,
		`    ;;`,
		`esac`,
		`found="$(command -v "$cmd" 2>/dev/null || true)"`,
		`if [ -n "$found" ]; then printf '%s\n' "$found"; exit 0; fi`,
		`for dir in "$HOME/.local/bin" "$HOME/bin" "$HOME/.npm-global/bin" "$HOME/.bun/bin" "$HOME/.cargo/bin" "/opt/homebrew/bin" "/usr/local/bin"; do`,
		`  candidate="$dir/$cmd"`,
		`  if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; exit 0; fi`,
		`done`,
		`exit 0`,
	}, "\n")
}

// moves the window to the front of the windowId stack
func (cs *ClientService) FocusWindow(ctx context.Context, windowId string) error {
	return wcore.FocusWindow(ctx, windowId)
}

func (cs *ClientService) AgreeTos(ctx context.Context) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	clientData, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	timestamp := time.Now().UnixMilli()
	clientData.TosAgreed = timestamp
	err = wstore.DBUpdate(ctx, clientData)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %w", err)
	}
	wcore.BootstrapStarterLayout(ctx)
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (cs *ClientService) TelemetryUpdate(ctx context.Context, telemetryEnabled bool) error {
	meta := waveobj.MetaMapType{
		wconfig.ConfigKey_TelemetryEnabled: telemetryEnabled,
	}
	err := wconfig.SetBaseConfigValue(meta)
	if err != nil {
		return fmt.Errorf("error setting telemetry value: %w", err)
	}
	return nil
}
