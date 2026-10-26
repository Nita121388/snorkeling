// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
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

// loginShellPathTimeout bounds the best-effort login-shell PATH probe. It only runs
// once per process (see getLoginShellPath) and never blocks the main lookup fast path.
const loginShellPathTimeout = 3 * time.Second

// candidateDir describes a bin directory worth probing when a command is not on the
// process PATH. Home-relative entries are resolved against the target user's home: the
// local scan uses os.UserHomeDir, while the remote shell script uses "$HOME" so it
// resolves against the remote user instead of the client's home.
type candidateDir struct {
	homeRel  string
	absolute string
}

// candidateDirSpecs is the single source of truth for command fallback directories.
// Local detection and the remote SSH/WSL script both consume it, so they cannot drift.
//
// Why this exists: GUI apps launched by macOS launchd inherit a bare PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) and never source the user's ~/.zshrc, so agents
// installed by homebrew or self-installers (notably ~/.opencode/bin) are invisible to
// a plain exec.LookPath.
var candidateDirSpecs = []candidateDir{
	{homeRel: ".opencode/bin"},
	{homeRel: ".local/bin"},
	{homeRel: "bin"},
	{homeRel: ".npm-global/bin"},
	{homeRel: ".bun/bin"},
	{homeRel: ".cargo/bin"},
	{absolute: "/opt/homebrew/bin"},
	{absolute: "/usr/local/bin"},
}

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
	if path, err := exec.LookPath(command); err == nil && path != "" {
		return path, nil
	}
	// exec.LookPath only trusts this process's PATH, which for a GUI-launched app is
	// the bare launchd PATH. Fall back to well-known bin dirs and the login-shell PATH.
	if path := resolveCommandWithFallback(command); path != "" {
		return path, nil
	}
	return "", nil
}

// resolveCommandWithFallback finds an executable by scanning candidate directories.
// Cheap deterministic dirs are probed first; the login-shell PATH (which spawns a shell)
// is only consulted afterwards, and is needed for users who add custom PATH entries in
// ~/.zshrc that are not covered by the well-known list.
func resolveCommandWithFallback(command string) string {
	// Commands containing a path separator are already qualified; exec.LookPath has
	// handled them and there is nothing left to scan for.
	if strings.ContainsAny(command, `/\`) {
		return ""
	}
	seen := make(map[string]bool)
	check := func(dir string) string {
		if dir == "" || seen[dir] {
			return ""
		}
		seen[dir] = true
		candidate := filepath.Join(dir, command)
		if isExecutableFile(candidate) {
			return candidate
		}
		return ""
	}
	for _, dir := range localCandidateCommandDirs() {
		if found := check(dir); found != "" {
			return found
		}
	}
	for _, dir := range getLoginShellPath() {
		if found := check(dir); found != "" {
			return found
		}
	}
	return ""
}

func localCandidateCommandDirs() []string {
	home, _ := os.UserHomeDir()
	return candidateCommandDirs(home)
}

func candidateCommandDirs(home string) []string {
	dirs := make([]string, 0, len(candidateDirSpecs))
	for _, spec := range candidateDirSpecs {
		if spec.homeRel != "" {
			if home == "" {
				continue
			}
			dirs = append(dirs, filepath.Join(home, filepath.FromSlash(spec.homeRel)))
			continue
		}
		dirs = append(dirs, spec.absolute)
	}
	return dirs
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		// Windows executability is decided by extension/PATHEXT; Stat existing is enough.
		return true
	}
	return info.Mode()&0111 != 0
}

var loginShellPathOnce sync.Once
var cachedLoginShellPath []string

func getLoginShellPath() []string {
	loginShellPathOnce.Do(func() {
		cachedLoginShellPath = resolveLoginShellPath()
	})
	return cachedLoginShellPath
}

// resolveLoginShellPath is best-effort: any failure (timeout, unsupported platform,
// shell errors) degrades to "no extra dirs" rather than breaking command detection.
func resolveLoginShellPath() []string {
	if runtime.GOOS == "windows" {
		return nil
	}
	shellPath := strings.TrimSpace(shellutil.DetectLocalShellPath())
	if shellPath == "" {
		return nil
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), loginShellPathTimeout)
	defer cancelFn()
	// `env` is used instead of `echo $PATH`: fish stores PATH as a list, so printing it
	// is shell-specific, while every POSIX shell exports PATH as a colon-joined string to
	// child processes. `-l -i` is needed so ~/.zshrc (interactive-only) is sourced too.
	out, err := exec.CommandContext(ctx, shellPath, "-l", "-i", "-c", "env").Output()
	if err != nil {
		return nil
	}
	return parsePathFromEnvOutput(string(out))
}

func parsePathFromEnvOutput(out string) []string {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if !strings.HasPrefix(line, "PATH=") {
			continue
		}
		var dirs []string
		for _, dir := range strings.Split(strings.TrimPrefix(line, "PATH="), ":") {
			dir = strings.TrimSpace(dir)
			if dir != "" {
				dirs = append(dirs, dir)
			}
		}
		return dirs
	}
	return nil
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
		return "", fmt.Errorf("failed to find command %q on remote: %w", command, err)
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
		`for dir in ` + strings.Join(candidateCommandDirsForScript(), " ") + `; do`,
		`  candidate="$dir/$cmd"`,
		`  if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; exit 0; fi`,
		`done`,
		`exit 0`,
	}, "\n")
}

// candidateCommandDirsForScript renders candidateDirSpecs for the remote shell script.
// Home entries use "$HOME" so the remote user's home is used, not the client's.
func candidateCommandDirsForScript() []string {
	dirs := make([]string, 0, len(candidateDirSpecs))
	for _, spec := range candidateDirSpecs {
		if spec.homeRel != "" {
			dirs = append(dirs, `"$HOME/`+spec.homeRel+`"`)
			continue
		}
		dirs = append(dirs, `"`+spec.absolute+`"`)
	}
	return dirs
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
