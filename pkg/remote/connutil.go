// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"os"
	"os/user"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"text/template"
	"time"

	"github.com/pkg/sftp"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/pslog"
	"github.com/wavetermdev/waveterm/pkg/util/iterfn"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
)

const windowsWshAutoTempNamePattern = `^wsh[.]exe[.][0-9]{19}[.][0-9]{1,19}[.]temp$`
const windowsWshQuarantineNamePattern = `^wsh[.]exe[.][0-9]{19}[.][0-9]{1,19}[.]temp[.]quarantine[.][0-9]{18}$`

var ErrWindowsAutoWshInstallRequiresManual = errors.New("windows automatic wsh install is unavailable; manual install required")

var userHostRe = regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-zA-Z0-9][a-zA-Z0-9.-]*)(?::([0-9]+))?$`)

func ParseOpts(input string) (*SSHOpts, error) {
	m := userHostRe.FindStringSubmatch(input)
	if m == nil {
		return nil, fmt.Errorf("invalid format of user@host argument")
	}
	remoteUser, remoteHost, remotePort := m[1], m[2], m[3]
	remoteUser = strings.Trim(remoteUser, "@")

	return &SSHOpts{SSHHost: remoteHost, SSHUser: remoteUser, SSHPort: remotePort}, nil
}

func normalizeOs(os string) string {
	os = strings.ToLower(strings.TrimSpace(os))
	if strings.HasPrefix(os, "mingw") || strings.HasPrefix(os, "msys") || strings.HasPrefix(os, "cygwin") {
		return "windows"
	}
	return os
}

func normalizeArch(arch string) string {
	arch = strings.ToLower(strings.TrimSpace(arch))
	switch arch {
	case "x86_64", "amd64":
		arch = "x64"
	case "arm64", "aarch64":
		arch = "arm64"
	}
	return arch
}

// UploadMinTimeout is the floor for the adaptive upload timeout. Anything
// below this risks false-failing a healthy ~10MB upload over a slow link.
const UploadMinTimeout = 90 * time.Second

// UploadMaxTimeout caps the adaptive upload timeout so a stuck upload still
// surfaces as "Failed" (and triggers the Manual install fallback) in finite
// time, instead of hanging indefinitely on a multi-GB wsh binary over a
// saturated link (a real binary is ~10MB; we leave generous headroom).
const UploadMaxTimeout = 15 * time.Minute

// UploadBytesPerSecond is the assumed slow-link throughput used to compute the
// adaptive upload timeout. 256 KiB/s is conservative — it's roughly a
// struggling mobile link or a heavily contended ADSL upstream — so a healthy
// 10MB wsh binary still finishes in ~40s, well under the floor. We round up
// (size+rate-1)/rate so the timeout is never less than the actual transfer
// time at this rate.
//
// Note: UploadTimeoutFor uses this only to compute the *initial* conservative
// deadline. The actual upload timeout is now adaptive: uploadFileViaSFTP's
// watchdog reads real-time progress and extends the deadline based on the
// observed throughput, so a link slower than UploadBytesPerSecond no longer
// false-fails a healthy upload.
const UploadBytesPerSecond int64 = 256 * 1024

// UploadStalledRate is the throughput floor below which an upload is considered
// "stalled" rather than merely slow. While the upload keeps progressing above
// this rate, the adaptive watchdog will extend the deadline to match the real
// throughput. Below it, the watchdog stops extending and lets the deadline
// expire — surfacing "Failed" / Manual install fallback instead of hanging
// forever on a link that has effectively died. 8 KiB/s is well below any real
// slow-but-alive link (a saturated Tailscale relay still moves tens of KiB/s).
const UploadStalledRate int64 = 8 * 1024

// UploadStalledTicks is how many consecutive 1-second watchdog ticks with
// sub-UploadStalledRate throughput must accumulate before the upload is
// considered stalled. Three ticks (3s) absorbs single-window jitter — a
// health upload can stall for one or two SFTP read cycles without being
// declared dead.
const UploadStalledTicks = 3

// UploadProgressWarmupSec is how long the adaptive watchdog waits after the
// upload starts before it begins adjusting the deadline. The first few
// seconds are dominated by SFTP handshake / TLS / remote fs open costs that
// don't reflect steady-state throughput, so a rate sampled there would be
// misleadingly low and trigger spurious deadline extensions.
const UploadProgressWarmup = 2 * time.Second

// computeAdaptiveTimeout returns the duration from now until the
// upload should time out, based on observed progress. It returns 0
// when the deadline should not be adjusted (e.g. during warmup or
// when the upload is stalled). The returned value is always bounded
// to [UploadMinTimeout, UploadMaxTimeout] relative to startAt.
//
// The formula uses total-throughput (bytesSoFar / elapsed) rather
// than an instantaneous sample, so a single slow tick doesn't
// overreact. A 1.5x safety factor plus a 10s buffer gives headroom
// for SFTP protocol overhead. UploadMaxTimeout is an absolute cap.
func computeAdaptiveTimeout(bytesSoFar int64, totalBytes int64, elapsed time.Duration, now time.Time) time.Duration {
	if bytesSoFar <= 0 || totalBytes <= 0 || elapsed <= 0 {
		return 0
	}
	rate := bytesSoFar * int64(time.Second) / int64(elapsed)
	remaining := (totalBytes - bytesSoFar) * int64(time.Second) / rate
	need := elapsed + time.Duration(remaining*3/2) + 10*time.Second

	// Hard cap: never extend past UploadMaxTimeout from start.
	startAt := now.Add(-elapsed)
	capDeadline := startAt.Add(UploadMaxTimeout)
	if now.Add(need).After(capDeadline) {
		need = capDeadline.Sub(now)
	}
	// Floor: never shorten below UploadMinTimeout.
	if need < UploadMinTimeout {
		need = UploadMinTimeout
	}
	return need
}

// UploadTimeoutFor returns a conservative initial upload timeout estimate
// for a binary of the given byte size, bounded to
// [UploadMinTimeout, UploadMaxTimeout]. The mathematical shape is:
//
//	timeout = clamp(UploadMinTimeout + extraSecondsFor(size), UploadMinTimeout, UploadMaxTimeout)
//	extraSecondsFor(size) = max(0, (size - UploadMinTimeout*rate) / rate)
//
// Callers should always pass the actual local binary size; if size <= 0 the
// function returns UploadMinTimeout as a safe default.
//
// NOTE: this is no longer the *enforced* upload deadline. The SFTP upload
// path (uploadFileViaSFTP) now runs a real-time throughput watchdog that
// extends the deadline above UploadTimeoutFor when the observed throughput
// is slower than UploadBytesPerSecond, and shortens it when faster, still
// bounded by UploadMaxTimeout. This function is kept for callers/tests
// that want a static conservative estimate of how long a transfer *should*
// take at the assumed slow-link rate.
func UploadTimeoutFor(size int64) time.Duration {
	if size <= 0 {
		return UploadMinTimeout
	}
	floorBytes := int64(UploadMinTimeout/time.Second) * UploadBytesPerSecond
	var timeout time.Duration
	if size <= floorBytes {
		timeout = UploadMinTimeout
	} else {
		extra := (size - floorBytes + UploadBytesPerSecond - 1) / UploadBytesPerSecond
		timeout = UploadMinTimeout + time.Duration(extra)*time.Second
	}
	if timeout > UploadMaxTimeout {
		timeout = UploadMaxTimeout
	}
	return timeout
}

// GetLocalWshBinarySize returns the byte size of the local wsh binary that
// would be uploaded for (version, goos, goarch). Returns 0 on any error so
// callers fall back to UploadMinTimeout, matching the size<=0 branch of
// UploadTimeoutFor.
func GetLocalWshBinarySize(version string, goos string, goarch string) int64 {
	path, err := shellutil.GetLocalWshBinaryPath(version, goos, goarch)
	if err != nil {
		return 0
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func IsWindowsCmdUnknownCommandOutput(output string, command string) bool {
	outputLower := strings.ToLower(output)
	command = strings.ToLower(command)
	if !strings.Contains(outputLower, command) {
		return false
	}
	return strings.Contains(outputLower, "not recognized") ||
		strings.Contains(outputLower, "\u4e0d\u662f\u5185\u90e8") ||
		strings.Contains(output, "\xb2\xbb\xca\xc7")
}

func makeWindowsPlatformDetectCommand() string {
	script := strings.Join([]string{
		`$Arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64|AARCH64") { "arm64" } else { "x64" }`,
		`Write-Output ("windows " + $Arch)`,
	}, "; ")
	return shellutil.MakePowerShellEncodedCommand(script)
}

func getClientPlatformFromOutput(ctx context.Context, output string) (string, string, error) {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		clientOs, clientArch, err := GetClientPlatformFromOsArchStr(ctx, line)
		if err == nil {
			return clientOs, clientArch, nil
		}
	}
	return "", "", fmt.Errorf("unexpected platform output: %s", output)
}

func detectWindowsClientPlatform(ctx context.Context, shell genconn.ShellClient) (string, string, error) {
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, shell, genconn.CommandSpec{
		Cmd: makeWindowsPlatformDetectCommand(),
	})
	if err != nil {
		return "", "", fmt.Errorf("error running windows platform detection: %w, stdout: %s, stderr: %s", err, strings.TrimSpace(stdout), strings.TrimSpace(stderr))
	}
	return getClientPlatformFromOutput(ctx, stdout)
}

// ErrUnknownRemotePlatform is returned by DetectRemotePlatform when no probe
// produced a definitive (os, arch) answer. The error wraps all per-probe
// diagnostics so the caller can surface them verbatim in logs.
var ErrUnknownRemotePlatform = errors.New("could not determine remote platform")

// platformProbeDiag records one probe's outcome. Each probe is independent; we
// keep stdout/stderr only for diagnostics, never for the platform decision
// itself (decisions come from stdout parsing + exit code, not stderr text).
type platformProbeDiag struct {
	Probe   string
	Cmd     string
	Stdout  string
	Stderr  string
	RunErr  error
	Outcome string // "ok", "skip", "fail", "timeout", "cancelled"
}

// DetectRemotePlatform detects the (os, arch) of the remote reachable via the
// given ssh.Client. It is robust to the remote being Windows (cmd-only),
// Windows with sh.exe on PATH (Git Bash / MSYS / WSL bash), WSL, macOS, Linux,
// and any environment where at least one of cmd, POSIX sh, or PowerShell is
// available. It does NOT rely on stderr text or assume a specific default shell.
//
// Detection runs as three independent probes over their own bounded ssh
// sessions; the first probe to produce a definitive (os, arch) wins. If all
// probes fail to classify the remote, DetectRemotePlatform returns
// ErrUnknownRemotePlatform wrapping a *platformProbeDiag slice so the caller
// can surface every probe's stdout/stderr in the diagnostic state.
//
// Probes (ordered cheapest-to-most-expensive to keep the common case fast):
//  1. "ver" — runs on cmd.exe (prints "Microsoft Windows [...]") and on
//     POSIX shells where `ver` is usually absent; we parse stdout for the
//     substring "windows" (case-insensitive). Definitive for Windows.
//  2. "uname -sm" — runs on POSIX sh and on Windows-with-bash; on POSIX it
//     returns "Linux x86_64" / "Darwin arm64" verbatim, on MSYS/Cygwin it
//     returns "MINGW64_NT-... x86_64" / "CYGWIN_NT-... x86_64" which we
//     normalize to windows. On bare-Windows-cmd `uname` is rejected; that
//     exit-with-no-stdout is recorded and we fall through.
//  3. PowerShell-encoded probe — `powershell -NoProfile -NonInteractive
//     -EncodedCommand <payload>` where the payload prints
//     `[System.Environment]::OSVersion.Platform` and
//     `$env:PROCESSOR_ARCHITECTURE` separated by a space. PowerShell is
//     available on every supported Windows (7+) and on Linux/macOS via
//     PowerShell Core; on Windows Platform=Win32NT is definitive, on
//     non-Windows Platform=Unix is reported back as-is and the caller can
//     match against ValidateWshSupportedArch.
//
// Each probe is wrapped in its own context-bounded 5s timeout and runs in a
// dedicated ssh session, so a single stuck probe cannot block detection.
// Cancellation from ctx is propagated to the running probe's session.
//
// Returns (os, arch, error). os is one of "windows", "linux", "darwin", or
// any other value ValidateWshSupportedArch accepts; error is non-nil ONLY
// when no probe produced a definitive answer OR ctx was cancelled mid-flight.
func DetectRemotePlatform(ctx context.Context, client *ssh.Client) (string, string, error) {
	if client == nil {
		return "", "", fmt.Errorf("%w: nil ssh client", ErrUnknownRemotePlatform)
	}
	// Each probe closes over the outer `client` so we can call it with just
	// the probe's own bounded context.
	probes := []func(ctx context.Context, client *ssh.Client) (string, string, *platformProbeDiag){
		probeRemotePlatformVer,
		probeRemotePlatformUname,
		probeRemotePlatformPowerShell,
	}
	diags := make([]*platformProbeDiag, 0, len(probes))
	for _, probe := range probes {
		pCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		os, arch, diag := probe(pCtx, client)
		cancel()
		diags = append(diags, diag)
		if os == "" || arch == "" {
			continue
		}
		// Probe gave us a definitive answer; validate against the supported-arch
		// table so a stray "linux riscv64" doesn't slip through unnoticed.
		if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
			blocklogger.Infof(ctx, "[conndebug] probe %q returned unsupported %s/%s, falling through\n", diag.Probe, os, arch)
			continue
		}
		blocklogger.Infof(ctx, "[conndebug] remote platform detected by probe %q: os=%s arch=%s\n", diag.Probe, os, arch)
		return os, arch, nil
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return "", "", ctxErr
	}
	// All probes failed to classify the remote; wrap every probe's diagnostics
	// so the user can see what each probe saw and fix the remote accordingly.
	var b strings.Builder
	b.WriteString(ErrUnknownRemotePlatform.Error())
	b.WriteString(" (probes:")
	for _, d := range diags {
		fmt.Fprintf(&b, " %s=%s", d.Probe, d.Outcome)
	}
	b.WriteString(")")
	return "", "", fmt.Errorf("%w; diagnostics: %s",
		ErrUnknownRemotePlatform,
		formatProbeDiags(diags))
}

func formatProbeDiags(diags []*platformProbeDiag) string {
	var b strings.Builder
	for i, d := range diags {
		fmt.Fprintf(&b, "\n  [%d] probe=%s cmd=%q outcome=%s", i, d.Probe, d.Cmd, d.Outcome)
		if d.RunErr != nil {
			fmt.Fprintf(&b, " err=%v", d.RunErr)
		}
		if strings.TrimSpace(d.Stdout) != "" {
			fmt.Fprintf(&b, " stdout=%q", strings.TrimSpace(d.Stdout))
		}
		if strings.TrimSpace(d.Stderr) != "" {
			fmt.Fprintf(&b, " stderr=%q", strings.TrimSpace(d.Stderr))
		}
	}
	return b.String()
}

// classifyProbeCtxErr trims a probe's ctx.Err into an "outcome" string. The
// inner ctx is the probe's 5s-timeout child of the caller's ctx; we use the
// error type to distinguish natural timeout from outer cancellation.
func classifyProbeCtxErr(ctx context.Context) string {
	err := ctx.Err()
	if err == nil {
		return "fail"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	return "fail"
}

// probeRemotePlatformVer runs `ver` and parses stdout for "windows". Works on
// Windows cmd.exe (prints "Microsoft Windows [Version ...]") and silently
// exits non-zero on most POSIX shells (which have no `ver`), in which case we
// fall through to the next probe. We deliberately ignore stderr text — if
// `ver` ran at all we trust stdout; if it didn't run we move on.
func probeRemotePlatformVer(ctx context.Context, client *ssh.Client) (string, string, *platformProbeDiag) {
	const cmd = "ver"
	stdout, stderr, err := runRemoteCommandOutput(ctx, client, cmd)
	diag := &platformProbeDiag{Probe: "ver", Cmd: cmd, Stdout: stdout, Stderr: stderr, Outcome: "fail"}
	if err != nil {
		diag.RunErr = err
		diag.Outcome = classifyProbeCtxErr(ctx)
		return "", "", diag
	}
	outLower := strings.ToLower(stdout)
	if strings.Contains(outLower, "windows") {
		arch := detectWindowsArchFromEnv(client)
		diag.Outcome = "ok"
		return "windows", arch, diag
	}
	diag.Outcome = "skip"
	return "", "", diag
}

// probeRemotePlatformUname runs `uname -sm` and parses output. On POSIX it
// returns "Linux x86_64" / "Darwin arm64" / etc; on Windows-with-bash it
// returns "MINGW64_NT-... x86_64" / "CYGWIN_NT-... x86_64", which normalizeOs
// maps back to "windows". On bare-Windows-cmd `uname` is rejected; that
// exit-with-no-classifiable-stdout is recorded and we fall through.
func probeRemotePlatformUname(ctx context.Context, client *ssh.Client) (string, string, *platformProbeDiag) {
	const cmd = "uname -sm"
	stdout, stderr, err := runRemoteCommandOutput(ctx, client, cmd)
	diag := &platformProbeDiag{Probe: "uname", Cmd: cmd, Stdout: stdout, Stderr: stderr, Outcome: "fail"}
	if err != nil {
		diag.RunErr = err
		diag.Outcome = classifyProbeCtxErr(ctx)
		return "", "", diag
	}
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(stdout)))
	if len(parts) != 2 {
		diag.Outcome = "skip"
		return "", "", diag
	}
	os := normalizeOs(parts[0])
	arch := normalizeArch(parts[1])
	diag.Outcome = "ok"
	return os, arch, diag
}

// probeRemotePlatformPowerShell runs a PowerShell-encoded probe via
// `powershell -NoProfile -NonInteractive -EncodedCommand <payload>`. The
// payload prints
//
//	<OSVersion.Platform> <normalized PROCESSOR_ARCHITECTURE>
//
// e.g. "Win32NT x64" on Windows, "Unix x64" on Linux/macOS PowerShell Core.
// We normalize Platform=Win32NT to "windows" and otherwise pass the os token
// through normalizeOs. This probe is the only one that does NOT depend on
// `sh` existing on the remote — ssh sends powershell.exe directly to the
// remote's shell, and we expect powershell to be on PATH.
func probeRemotePlatformPowerShell(ctx context.Context, client *ssh.Client) (string, string, *platformProbeDiag) {
	// PowerShell payload: print "<Platform> <Arch>" — uses [System.Environment]
	// (always available) and $env:PROCESSOR_ARCHITECTURE (Windows / PowerShell
	// Core on Linux exposes it as well). On Linux/macOS PowerShell Core
	// Platform is "Unix", so we cannot distinguish linux vs darwin here; we
	// emit "unix" and let ValidateWshSupportedArch reject it; the caller's
	// fallback (uname) handles the posix case.
	script := strings.Join([]string{
		`$Platform = [string]([System.Environment]::OSVersion.Platform)`,
		`$Arch = $env:PROCESSOR_ARCHITECTURE`,
		`if ($Arch -match "ARM64|AARCH64") { $Arch = "arm64" }`,
		`elseif ($Arch -match "AMD64|x86_64|x64") { $Arch = "x64" }`,
		`else { $Arch = $Arch.ToLower() }`,
		`Write-Output ($Platform + " " + $Arch)`,
	}, "\n")
	cmd := shellutil.MakePowerShellEncodedCommand(script)
	diag := &platformProbeDiag{Probe: "powershell", Cmd: "powershell -EncodedCommand ...", Outcome: "fail"}
	stdout, stderr, err := runRemoteCommandOutput(ctx, client, cmd)
	diag.Stdout = stdout
	diag.Stderr = stderr
	if err != nil {
		diag.RunErr = err
		diag.Outcome = classifyProbeCtxErr(ctx)
		return "", "", diag
	}
	parts := strings.Fields(strings.TrimSpace(stdout))
	if len(parts) != 2 {
		diag.Outcome = "skip"
		return "", "", diag
	}
	plat := strings.ToLower(parts[0])
	arch := normalizeArch(parts[1])
	var os string
	switch {
	case plat == "win32nt":
		os = "windows"
	case strings.HasPrefix(plat, "unix"):
		// PowerShell Core on Linux/macOS reports Platform=Unix; we can't tell
		// them apart from here. Mark as skip so the unix uname probe wins.
		diag.Outcome = "skip"
		return "", "", diag
	default:
		os = normalizeOs(plat)
	}
	diag.Outcome = "ok"
	return os, arch, diag
}

// detectWindowsArchFromEnv is a best-effort secondary probe: once we've
// decided the remote is Windows via `ver`, we still need the architecture. We
// run a tiny PowerShell one-liner to read $env:PROCESSOR_ARCHITECTURE and
// normalize to "x64" or "arm64". If this fails for any reason we default to
// "x64" (still a value ValidateWshSupportedArch accepts); the caller's
// install validation will reject the wrong arch if we guessed wrong.
func detectWindowsArchFromEnv(client *ssh.Client) string {
	if client == nil {
		return "x64"
	}
	archScript := `if ($env:PROCESSOR_ARCHITECTURE -match "ARM64|AARCH64") { "arm64" } else { "x64" }`
	archCmd := shellutil.MakePowerShellEncodedCommand(archScript)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stdout, _, err := runRemoteCommandOutput(ctx, client, archCmd)
	if err != nil {
		return "x64"
	}
	out := strings.TrimSpace(stdout)
	switch out {
	case "arm64":
		return "arm64"
	default:
		return "x64"
	}
}

// returns (os, arch, error)
// guaranteed to return a supported platform
func GetClientPlatform(ctx context.Context, shell genconn.ShellClient) (string, string, error) {
	// Fast path: if shell wraps an ssh.Client, use DetectRemotePlatform which
	// is robust to remote shell being cmd.exe (no sh.exe) by probing
	// `ver` / `uname -sm` / PowerShell directly over ssh, bypassing the
	// `sh -c` wrapper that BuildShellCommand would otherwise inject.
	if sshShell, ok := shell.(*genconn.SSHShellClient); ok {
		if client := sshShell.GetSSHClient(); client != nil {
			return DetectRemotePlatform(ctx, client)
		}
	}
	// Slow path / non-SSH shell (e.g. wslconn): keep the legacy uname -sm +
	// IsWindowsCmdUnknownCommandOutput fallback. This path is still
	// vulnerable to the sh-c wrapper failing on Windows-cmd remotes, but
	// WslConn remotes are always WSL (POSIX), so the legacy path is fine there.
	blocklogger.Infof(ctx, "[conndebug] running `uname -sm` to detect client platform\n")
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, shell, genconn.CommandSpec{
		Cmd: "uname -sm",
	})
	if err != nil {
		if IsWindowsCmdUnknownCommandOutput(stdout+"\n"+stderr, "uname") {
			return detectWindowsClientPlatform(ctx, shell)
		}
		return "", "", fmt.Errorf("error running uname -sm: %w, stderr: %s", err, stderr)
	}
	// Parse and normalize output
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(stdout)))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", stdout)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

func GetClientPlatformFromOsArchStr(ctx context.Context, osArchStr string) (string, string, error) {
	parts := strings.Fields(strings.TrimSpace(osArchStr))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", osArchStr)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

func GetRemoteWshPath(clientOs string) string {
	if clientOs == "windows" {
		return wavebase.RemoteFullWshBinPath + ".exe"
	}
	return wavebase.RemoteFullWshBinPath
}

func getRemoteWshTempPath(clientOs string, remoteWshPath string) string {
	if clientOs == "windows" {
		return fmt.Sprintf("~/.snorkeling/tmp/wsh-auto/wsh.exe.%d.%d.temp", time.Now().UnixNano(), rand.Int63())
	}
	return fmt.Sprintf("%s.%d.%d.temp", remoteWshPath, time.Now().UnixNano(), rand.Int63())
}

func getRemoteWshInstallDiagnosticCmd() string {
	return `printf 'wsh install diagnostics:\n' >&2; ls -la ~/.snorkeling/bin ~/.snorkeling/tmp 2>&1 >&2 || true`
}

func getRemoteWshInstallDiagnosticCmdForOs(clientOs string) string {
	if clientOs == "windows" {
		script := strings.Join([]string{
			`Write-Output "wsh install diagnostics:"`,
			`Get-ChildItem -Force "$HOME\.snorkeling\bin", "$HOME\.snorkeling\tmp" | Format-List | Out-String | Write-Output`,
		}, "; ")
		return shellutil.MakePowerShellEncodedCommand(script)
	}
	return getRemoteWshInstallDiagnosticCmd()
}

var installTemplateRawDefault = strings.TrimSpace(`
mkdir -p {{.installDir}} || exit 1;
cat > {{.tempPath}} || { status=$?; rm -f {{.tempPath}}; exit $status; };
actual_size=$(wc -c < {{.tempPath}} | tr -d '[:space:]') || { rm -f {{.tempPath}}; exit 1; };
if [ "$actual_size" != "{{.expectedSize}}" ]; then
    echo "wsh install size mismatch: expected {{.expectedSize}}, got ${actual_size}" >&2;
    rm -f {{.tempPath}};
    exit 1;
fi;
mv {{.tempPath}} {{.installPath}} || exit 1;
chmod a+x {{.installPath}} || exit 1;
if [ ! -f {{.installPath}} ]; then
    echo "final wsh binary missing after install: {{.installPath}}" >&2;
    {{.diagnostics}};
    exit 1;
fi;
`)
var installTemplate = template.Must(template.New("wsh-install-template").Parse(installTemplateRawDefault))

func makeWindowsSFTPPath(remoteHomePath string, remoteTempPath string) string {
	remoteHomePath = strings.TrimRight(strings.ReplaceAll(remoteHomePath, `\`, "/"), "/")
	remoteTempPath = strings.ReplaceAll(remoteTempPath, `\`, "/")
	remoteTempPath = strings.TrimPrefix(remoteTempPath, "~/")
	return path.Join(remoteHomePath, remoteTempPath)
}

func appendWshUploadDiag(stage string, kv ...any) {
	fields := make([]any, 0, len(kv)+2)
	fields = append(fields, "stage", stage)
	fields = append(fields, kv...)
	pslog.Append("ssh-wsh-upload", fields...)
}

// cpWshToWindowsRemote installs the bundled wsh.exe on a Windows remote using the
// hardened install path shared with the manual install flow.
//
// Steps (each over its own ssh session or SFTP channel):
//  1. Compute the local wsh.exe size + SHA-256 by seeking through `input`.
//  2. Run the prepare script through PowerShell stdin (creates
//     ~/.snorkeling/{tmp,bin}, asserts they are safe dirs).
//  3. Upload `input` over the Windows remote's SFTP subsystem into $TempPath.
//  4. Run the install script through PowerShell stdin: verifies uploaded size+SHA-256, takes the install lock, atomically
//     replaces the existing wsh.exe (with a backup), runs `wsh version` to confirm the
//     exact expected version line, rolls back to the backup on any failure, and cleans
//     up the temp file in a finally block.
//  5. On any failure in steps 2-4, run the cleanup script (best-effort) to remove the half-written
//     temp file so a later install is not blocked by it.
//
// Because the install script already runs `wsh version` and refuses to commit the swap unless
// the exact expected version line is produced, no separate post-install verify step is
// needed here (the legacy single-shot path did one; the hardened path does it under the
// lock, which is strictly safer).
func cpWshToWindowsRemote(ctx context.Context, client *ssh.Client, input *os.File, inputSize int64, remoteWshPath string, remoteTempPath string, diagnosticsCmd string, onProgress func(written, total int64)) error {
	uploadStarted := time.Now()
	deadlineRemainingMs := int64(-1)
	if deadline, ok := ctx.Deadline(); ok {
		deadlineRemainingMs = time.Until(deadline).Milliseconds()
	}
	appendWshUploadDiag("start", "remote_os", "windows", "bytes", inputSize, "temp_path", remoteTempPath, "context_deadline_ms", deadlineRemainingMs)
	blocklogger.Debugf(ctx, "[conndebug] wsh upload stage=start os=windows bytes=%d temp=%s\n", inputSize, remoteTempPath)
	// 1. SHA-256 the local binary by streaming `input` once, then rewind so the upload
	//    copy below sees the file from the start.
	if _, err := input.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("cannot seek local wsh binary for hashing: %w", err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, input); err != nil {
		return fmt.Errorf("cannot hash local wsh binary: %w", err)
	}
	expectedSHA256 := fmt.Sprintf("%x", hash.Sum(nil))
	if _, err := input.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("cannot rewind local wsh binary after hashing: %w", err)
	}
	expectedVersion := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	prepareScript, installScript, cleanupScript := shellutil.BuildWindowsWshInstallScripts(remoteTempPath, remoteWshPath, inputSize, expectedSHA256, expectedVersion)
	runPowerShellScript := func(script string) (string, string, error) {
		session, err := client.NewSession()
		if err != nil {
			return "", "", err
		}
		defer session.Close()
		stdoutBuf := &strings.Builder{}
		stderrBuf := &strings.Builder{}
		session.Stdin = strings.NewReader(script + "\n")
		session.Stdout = stdoutBuf
		session.Stderr = stderrBuf
		started := time.Now()
		pslog.AppendRaw("ssh-raw-session-start", fmt.Sprintf("cmd=%q stdin_bytes=%d", shellutil.PowerShellStdinCommand, len(script)))
		err = runSessionWithContext(ctx, session, shellutil.PowerShellStdinCommand)
		pslog.AppendRaw("ssh-raw-session-result", fmt.Sprintf("duration_ms=%d err=%v", time.Since(started).Milliseconds(), err))
		return stdoutBuf.String(), stderrBuf.String(), err
	}

	// 2. prepare: make sure remote tmp/bin dirs exist and are plain directories.
	appendWshUploadDiag("prepare-start")
	prepareStdout, prepareStderr, err := runPowerShellScript(prepareScript)
	if err != nil {
		appendWshUploadDiag("prepare-failed", "error", err.Error())
		blocklogger.Debugf(ctx, "[conndebug] wsh upload stage=prepare-failed error=%v\n", err)
		return fmt.Errorf("remote wsh prepare failed: %w (stdout: %s; stderr: %s)", err, strings.TrimSpace(prepareStdout), strings.TrimSpace(prepareStderr))
	}
	appendWshUploadDiag("prepare-complete")
	blocklogger.Debugf(ctx, "[conndebug] wsh upload stage=prepare-complete\n")

	// 3. Upload the binary through the remote SFTP subsystem. SFTP gives the binary
	// an explicit remote file lifecycle and avoids PowerShell stdin EOF handling.
	appendWshUploadDiag("sftp-client-create-start")
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		appendWshUploadDiag("sftp-client-create-failed", "error", err.Error())
		return fmt.Errorf("%w: failed to open SFTP subsystem: %v", ErrWindowsAutoWshInstallRequiresManual, err)
	}
	sftpClosed := false
	closeSFTP := func() error {
		if sftpClosed {
			return nil
		}
		sftpClosed = true
		return sftpClient.Close()
	}
	defer func() {
		_ = closeSFTP()
	}()
	remoteHomePath, err := sftpClient.Getwd()
	if err != nil {
		appendWshUploadDiag("sftp-home-failed", "error", err.Error())
		return fmt.Errorf("%w: failed to resolve remote SFTP home: %v", ErrWindowsAutoWshInstallRequiresManual, err)
	}
	sftpTempPath := makeWindowsSFTPPath(remoteHomePath, remoteTempPath)
	appendWshUploadDiag("sftp-client-created", "remote_home", remoteHomePath, "remote_path", sftpTempPath)
	blocklogger.Debugf(ctx, "[conndebug] wsh upload stage=sftp-client-created remote_home=%s remote_path=%s\n", remoteHomePath, sftpTempPath)
	uploadErr := uploadFileViaSFTP(ctx, func(path string) (io.WriteCloser, error) {
		return sftpClient.Create(path)
	}, func() {
		_ = closeSFTP()
	}, sftpTempPath, input, inputSize, onProgress)
	closeErr := closeSFTP()
	if uploadErr != nil {
		appendWshUploadDiag("sftp-upload-failed", "error", uploadErr.Error(), "duration_ms", time.Since(uploadStarted).Milliseconds())
		_, _, _ = runPowerShellScript(cleanupScript)
		return uploadErr
	}
	if closeErr != nil {
		appendWshUploadDiag("sftp-client-close-failed", "error", closeErr.Error())
		_, _, _ = runPowerShellScript(cleanupScript)
		return fmt.Errorf("failed to close SFTP upload: %w", closeErr)
	}
	appendWshUploadDiag("sftp-upload-complete", "duration_ms", time.Since(uploadStarted).Milliseconds())
	blocklogger.Debugf(ctx, "[conndebug] wsh upload stage=sftp-upload-complete duration_ms=%d\n", time.Since(uploadStarted).Milliseconds())

	// 4. install: size + SHA-256 + atomic replace + version verify + rollback, under lock.
	appendWshUploadDiag("install-start")
	installStdout, installStderr, err := runPowerShellScript(installScript)
	if err != nil {
		appendWshUploadDiag("install-failed", "error", err.Error(), "stdout_bytes", len(strings.TrimSpace(installStdout)), "stderr_bytes", len(strings.TrimSpace(installStderr)))
		_, _, _ = runPowerShellScript(cleanupScript)
		return fmt.Errorf("remote wsh install failed: %w (stdout: %s; stderr: %s)",
			err, strings.TrimSpace(installStdout), strings.TrimSpace(installStderr))
	}
	appendWshUploadDiag("install-complete", "stdout_bytes", len(strings.TrimSpace(installStdout)), "stderr_bytes", len(strings.TrimSpace(installStderr)), "duration_ms", time.Since(uploadStarted).Milliseconds())
	return nil
}

type sftpCopyResult struct {
	written int64
	err     error
}

func uploadFileViaSFTP(ctx context.Context, openFile func(string) (io.WriteCloser, error), abortTransport func(), remotePath string, input io.Reader, inputSize int64, onProgress func(written, total int64)) error {
	select {
	case <-ctx.Done():
		return fmt.Errorf("remote wsh upload canceled: %w", ctx.Err())
	default:
	}
	remoteFile, err := openFile(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote SFTP file %s: %w", remotePath, err)
	}

	// timer owns the deadline; the watchdog goroutine resets it as the
	// observed throughput changes. The main select reads timer.C only
	// (never resets the timer itself), so there is no concurrent Reset
	// race with a goroutine receiving from timer.C.
	timer := time.NewTimer(UploadMaxTimeout + 60*time.Second)
	defer timer.Stop()

	pwd := newProgressWriter(remoteFile, inputSize, onProgress)

	stopCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		start := time.Now()
		var lastWritten int64
		var stallTicks int
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				current := pwd.written.Load()
				delta := current - lastWritten
				lastWritten = current

				// Not enough bytes moved in this tick to be meaningful.
				// Count consecutive ticks below UploadStalledRate; only
				// after UploadStalledTicks do we declare it stalled and
				// stop extending the deadline (let the timer fire).
				if delta < UploadStalledRate {
					stallTicks++
					if stallTicks >= UploadStalledTicks {
						stallTicks = UploadStalledTicks // cap, avoid overflow
					}
					continue
				}
				stallTicks = 0

				// Skip rate adjustment during the warmup period — SFTP
				// handshake / TLS setup / remote fs open can make the
				// first few seconds look artificially slow.
				elapsed := time.Since(start)
				if elapsed < UploadProgressWarmup {
					continue
				}

				need := computeAdaptiveTimeout(current, inputSize, elapsed, time.Now())
				if need <= 0 {
					continue
				}

				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(need)
			}
		}
	}()
	// stopCh is closed in every exit branch below before returning; no
	// defer close here to avoid a double-close with the success branch.

	copyDone := make(chan sftpCopyResult, 1)
	go func() {
		var writer io.Writer = remoteFile
		if onProgress != nil {
			writer = pwd
		}
		written, copyErr := io.Copy(writer, input)
		copyDone <- sftpCopyResult{written: written, err: copyErr}
	}()
	select {
	case <-ctx.Done():
		ctxErr := ctx.Err()
		appendWshUploadDiag("sftp-upload-canceled", "written", pwd.written.Load(), "context_error", ctxErr.Error())
		close(stopCh)
		wg.Wait()
		if abortTransport != nil {
			abortTransport()
		}
		_ = remoteFile.Close()
		<-copyDone
		return fmt.Errorf("remote wsh upload canceled: %w", ctxErr)
	case <-timer.C:
		appendWshUploadDiag("sftp-upload-timeout", "written", pwd.written.Load(), "context_error", context.DeadlineExceeded.Error())
		close(stopCh)
		wg.Wait()
		if abortTransport != nil {
			abortTransport()
		}
		_ = remoteFile.Close()
		<-copyDone
		return fmt.Errorf("remote wsh upload canceled: %w", context.DeadlineExceeded)
	case result := <-copyDone:
		close(stopCh)
		wg.Wait()
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		closeErr := remoteFile.Close()
		if result.err != nil && result.err != io.EOF {
			return fmt.Errorf("failed to copy data to remote SFTP file: %w", result.err)
		}
		if closeErr != nil {
			return fmt.Errorf("failed to close remote SFTP file: %w", closeErr)
		}
		if onProgress != nil {
			onProgress(result.written, inputSize)
		}
		return nil
	}
}

// runRemoteCommandQuiet runs cmd on client, discarding stdout/stderr. Used for
// prepare/cleanup where we don't care about the output, only the exit status.
func runRemoteCommandQuiet(ctx context.Context, client *ssh.Client, cmd string) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	started := time.Now()
	pslog.AppendRaw("ssh-raw-session-start", fmt.Sprintf("cmd=%q", cmd))
	err = runSessionWithContext(ctx, session, cmd)
	pslog.AppendRaw("ssh-raw-session-result", fmt.Sprintf("duration_ms=%d err=%v", time.Since(started).Milliseconds(), err))
	return err
}

func runSessionWaitWithContext(ctx context.Context, session *ssh.Session) error {
	done := make(chan error, 1)
	go func() {
		done <- session.Wait()
	}()
	select {
	case <-ctx.Done():
		session.Close()
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func runRemoteCommandOutput(ctx context.Context, client *ssh.Client, cmd string) (string, string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", "", err
	}
	defer session.Close()
	stdoutBuf := &strings.Builder{}
	stderrBuf := &strings.Builder{}
	session.Stdout = stdoutBuf
	session.Stderr = stderrBuf
	err = runSessionWithContext(ctx, session, cmd)
	return stdoutBuf.String(), stderrBuf.String(), err
}

func runSessionWithContext(ctx context.Context, session *ssh.Session, cmd string) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- session.Run(cmd)
	}()
	select {
	case <-ctx.Done():
		session.Close()
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

func makeWindowsWshTempCleanupScript(now time.Time) string {
	now = now.UTC()
	uploadCutoff := now.Add(-24 * time.Hour).Format(time.RFC3339Nano)
	quarantineCutoff := now.Add(-7 * 24 * time.Hour).Format(time.RFC3339Nano)
	nowText := now.Format(time.RFC3339Nano)
	return strings.Join([]string{
		`$ErrorActionPreference = "Stop"`,
		`$NowUtc = [DateTime]::Parse(` + shellutil.HardQuotePowerShell(nowText) + `, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()`,
		`$UploadCutoffUtc = [DateTime]::Parse(` + shellutil.HardQuotePowerShell(uploadCutoff) + `, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()`,
		`$QuarantineCutoffUtc = [DateTime]::Parse(` + shellutil.HardQuotePowerShell(quarantineCutoff) + `, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()`,
		`$UploadPattern = ` + shellutil.HardQuotePowerShell(windowsWshAutoTempNamePattern),
		`$QuarantinePattern = ` + shellutil.HardQuotePowerShell(windowsWshQuarantineNamePattern),
		`$MaxProcessed = 20`,
		`$Processed = 0`,
		`$SnorkelingRoot = Join-Path $HOME ".snorkeling"`,
		`$TempRoot = Join-Path $SnorkelingRoot "tmp"`,
		`$AutoRoot = Join-Path $TempRoot "wsh-auto"`,
		`$QuarantineRoot = Join-Path $TempRoot "wsh-quarantine"`,
		`function Assert-SafeCleanupRoot {`,
		`    param([string]$Path)`,
		`    if (!(Test-Path -LiteralPath $Path)) { return }`,
		`    $Root = Get-Item -LiteralPath $Path -ErrorAction Stop`,
		`    if (!$Root.PSIsContainer -or (($Root.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {`,
		`        throw "unsafe wsh cleanup root: $Path"`,
		`    }`,
		`}`,
		`function Test-ExclusiveRegularFile {`,
		`    param([System.IO.FileInfo]$Item)`,
		`    if ($null -eq $Item -or $Item.PSIsContainer -or (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { return $false }`,
		`    $Stream = $null`,
		`    try {`,
		`        $Stream = [System.IO.File]::Open($Item.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)`,
		`        return $true`,
		`    } catch {`,
		`        return $false`,
		`    } finally {`,
		`        if ($null -ne $Stream) { $Stream.Dispose() }`,
		`    }`,
		`}`,
		`Assert-SafeCleanupRoot $SnorkelingRoot`,
		`Assert-SafeCleanupRoot $TempRoot`,
		`Assert-SafeCleanupRoot $AutoRoot`,
		`Assert-SafeCleanupRoot $QuarantineRoot`,
		`if (!(Test-Path -LiteralPath $TempRoot)) { return }`,
		`if (!(Test-Path -LiteralPath $QuarantineRoot)) { [System.IO.Directory]::CreateDirectory($QuarantineRoot) | Out-Null }`,
		`Assert-SafeCleanupRoot $QuarantineRoot`,
		`$QuarantineItems = @(Get-ChildItem -LiteralPath $QuarantineRoot -ErrorAction Stop | Sort-Object -Property Name)`,
		`foreach ($Item in $QuarantineItems) {`,
		`    if ($Processed -ge $MaxProcessed) { break }`,
		`    if (!($Item -is [System.IO.FileInfo]) -or $Item.Name -notmatch $QuarantinePattern) { continue }`,
		`    [Int64]$QuarantinedAtTicks = 0`,
		`    $TicksText = $Item.Name.Substring($Item.Name.LastIndexOf(".") + 1)`,
		`    if (![Int64]::TryParse($TicksText, [ref]$QuarantinedAtTicks)) { continue }`,
		`    if ($QuarantinedAtTicks -ge $QuarantineCutoffUtc.Ticks) { continue }`,
		`    if (!(Test-ExclusiveRegularFile $Item)) { continue }`,
		`    try {`,
		`        Remove-Item -LiteralPath $Item.FullName -ErrorAction Stop`,
		`        $Processed++`,
		`    } catch { continue }`,
		`}`,
		`$Candidates = @()`,
		`foreach ($RootPath in @($TempRoot, $AutoRoot)) {`,
		`    if (!(Test-Path -LiteralPath $RootPath)) { continue }`,
		`    try { $Items = @(Get-ChildItem -LiteralPath $RootPath -ErrorAction Stop) } catch { continue }`,
		`    foreach ($Item in $Items) {`,
		`        if (!($Item -is [System.IO.FileInfo])) { continue }`,
		`        if ($Item.Name -notmatch $UploadPattern -or $Item.LastWriteTimeUtc -ge $UploadCutoffUtc) { continue }`,
		`        if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }`,
		`        $Candidates += $Item`,
		`    }`,
		`}`,
		`$Candidates = @($Candidates | Sort-Object -Property LastWriteTimeUtc, FullName)`,
		`foreach ($Item in $Candidates) {`,
		`    if ($Processed -ge $MaxProcessed) { break }`,
		`    if (!(Test-ExclusiveRegularFile $Item)) { continue }`,
		`    $DestinationName = $Item.Name + ".quarantine." + $NowUtc.Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)`,
		`    $Destination = Join-Path $QuarantineRoot $DestinationName`,
		`    if (Test-Path -LiteralPath $Destination) { continue }`,
		`    try {`,
		`        Move-Item -LiteralPath $Item.FullName -Destination $Destination -ErrorAction Stop`,
		`        $Processed++`,
		`    } catch { continue }`,
		`}`,
	}, "\n")
}

// CleanupRemoteWshTemp 仅隔离过期且可识别为自动生成的上传文件；Windows 远端可能没有 sh.exe，因而使用原始 SSH 会话。
func CleanupRemoteWshTemp(ctx context.Context, client *ssh.Client, clientOs string) error {
	var cmdStr string
	if clientOs == "windows" {
		cmdStr = shellutil.MakePowerShellEncodedCommand(makeWindowsWshTempCleanupScript(time.Now()))
	} else {
		// Posix: temp files are wsh.<nano>.<rand>.temp in ~/.snorkeling/bin/ (same dir as the wsh binary).
		// rm -f globs are best-effort; `2>/dev/null` masks "no such file"; trailing `true` makes the
		// session exit 0 even if rm had nothing to do.
		cmdStr = `rm -f "$HOME/.snorkeling/bin/wsh."*".temp" 2>/dev/null; true`
	}
	// Short, generous deadline: this is a quick best-effort cleanup. If the remote is unreachable
	// enough that even `rm -f` hangs for 15s, the upload itself would also hang and the install is
	// already broken — failing here is fine; we still proceed to the upload attempt.
	cleanupCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	started := time.Now()
	blocklogger.Debugf(cleanupCtx, "[conndebug] cleanupRemoteWshTemp start os=%s command=%s\n", clientOs, cmdStr)
	err := runRemoteCommandQuiet(cleanupCtx, client, cmdStr)
	if err != nil {
		blocklogger.Debugf(ctx, "[conndebug] cleanupRemoteWshTemp failed after %dms: %v\n", time.Since(started).Milliseconds(), err)
		return err
	}
	blocklogger.Debugf(ctx, "[conndebug] cleanupRemoteWshTemp complete after %dms\n", time.Since(started).Milliseconds())
	return nil
}

// progressWriter wraps an io.Writer and reports byte progress at most every 500ms.
// Throttle keeps updateWshInstallState churn low; the frontend overlay doesn't need 60fps.
// onUpdate is called from Write — it must be safe to call from the writer goroutine
// (in our case the upload io.Copy goroutine) and should not block on slow ops.
//
// written is atomic.Int64 (the first field, for guaranteed 8-byte alignment) so a
// concurrent upload-progress watchdog goroutine in uploadFileViaSFTP can read it
// without racing the io.Copy goroutine's writes. atomic.Int64 is required for
// race-detector cleanliness — a plain int64 would be a data race.
type progressWriter struct {
	written  atomic.Int64
	dest     io.Writer
	total    int64
	last     time.Time
	onUpdate func(written, total int64)
}

func newProgressWriter(dest io.Writer, total int64, onUpdate func(written, total int64)) *progressWriter {
	return &progressWriter{
		dest:     dest,
		total:    total,
		last:     time.Now(),
		onUpdate: onUpdate,
	}
}

func (p *progressWriter) Write(buf []byte) (int, error) {
	n, err := p.dest.Write(buf)
	p.written.Add(int64(n))
	if time.Since(p.last) >= 500*time.Millisecond {
		p.onUpdate(p.written.Load(), p.total)
		p.last = time.Now()
	}
	return n, err
}

func extractWshVersionLine(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "wsh ") {
			return line
		}
	}
	return strings.TrimSpace(output)
}

func CpWshToRemote(ctx context.Context, client *ssh.Client, clientOs string, clientArch string) error {
	return CpWshToRemoteWithProgress(ctx, client, clientOs, clientArch, nil)
}

// CpWshToRemoteWithProgress copies the bundled wsh binary to the remote, reporting byte
// progress via onProgress (best-effort: called at most ~2Hz). onProgress may be nil.
// It also pre-cleans any stale .temp residue from a prior interrupted upload before
// starting, so a half-written temp file beside the wsh binary does not interfere.
// See CleanupRemoteWshTemp for why this matters.
func CpWshToRemoteWithProgress(ctx context.Context, client *ssh.Client, clientOs string, clientArch string, onProgress func(written, total int64)) error {
	deadline, ok := ctx.Deadline()
	if ok {
		blocklogger.Debugf(ctx, "[conndebug] CpWshToRemote, timeout: %v\n", time.Until(deadline))
	}
	wshLocalPath, err := shellutil.GetLocalWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	if err != nil {
		return err
	}
	// Best-effort sweep of stale .temp residue from any prior interrupted install, BEFORE we
	// create the upload session. See CleanupRemoteWshTemp for why. Done first (before os.Open)
	// so a half-written temp file cannot sit beside the wsh binary while we install.
	if cleanupErr := CleanupRemoteWshTemp(ctx, client, clientOs); cleanupErr != nil {
		blocklogger.Debugf(ctx, "[conndebug] cleanupRemoteWshTemp ignored before upload: %v\n", cleanupErr)
	}
	input, err := os.Open(wshLocalPath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s: %w", wshLocalPath, err)
	}
	defer input.Close()
	inputInfo, err := input.Stat()
	if err != nil {
		return fmt.Errorf("cannot stat local file %s: %w", wshLocalPath, err)
	}
	if inputInfo.Size() <= 0 {
		return fmt.Errorf("local wsh binary %s is empty", wshLocalPath)
	}
	remoteWshPath := GetRemoteWshPath(clientOs)
	remoteTempPath := getRemoteWshTempPath(clientOs, remoteWshPath)
	diagnosticsCmd := getRemoteWshInstallDiagnosticCmdForOs(clientOs)
	if clientOs == "windows" {
		return cpWshToWindowsRemote(ctx, client, input, inputInfo.Size(), remoteWshPath, remoteTempPath, diagnosticsCmd, onProgress)
	}
	installWords := map[string]string{
		"installDir":   filepath.ToSlash(filepath.Dir(remoteWshPath)),
		"tempPath":     remoteTempPath,
		"installPath":  remoteWshPath,
		"expectedSize": fmt.Sprintf("%d", inputInfo.Size()),
		"diagnostics":  diagnosticsCmd,
	}
	var installCmd bytes.Buffer
	if err := installTemplate.Execute(&installCmd, installWords); err != nil {
		return fmt.Errorf("failed to prepare install command: %w", err)
	}
	blocklogger.Infof(ctx, "[conndebug] copying %q to remote server %q\n", wshLocalPath, remoteWshPath)
	genCmd, err := genconn.MakeSSHCmdClient(client, genconn.CommandSpec{
		Cmd: installCmd.String(),
	})
	if err != nil {
		return fmt.Errorf("failed to create remote command: %w", err)
	}
	stdin, err := genCmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	defer stdin.Close()
	stderrBuf, err := genconn.MakeStderrSyncBuffer(genCmd)
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	if err := genCmd.Start(); err != nil {
		return fmt.Errorf("failed to start remote command: %w", err)
	}
	copyDone := make(chan error, 1)
	go func() {
		defer close(copyDone)
		defer stdin.Close()
		var writer io.Writer = stdin
		if onProgress != nil {
			writer = newProgressWriter(stdin, inputInfo.Size(), onProgress)
		}
		if _, err := io.Copy(writer, input); err != nil && err != io.EOF {
			copyDone <- fmt.Errorf("failed to copy data: %w", err)
		} else {
			copyDone <- nil
		}
	}()
	procErr := genconn.ProcessContextWait(ctx, genCmd)
	var copyErr error
	select {
	case copyErr = <-copyDone:
	case <-ctx.Done():
		_ = stdin.Close()
		return fmt.Errorf("remote wsh upload canceled: %w", ctx.Err())
	}
	if procErr != nil {
		return fmt.Errorf("remote command failed: %w (stderr: %s)", procErr, stderrBuf.String())
	}
	if copyErr != nil {
		return fmt.Errorf("failed to copy data: %w (stderr: %s)", copyErr, stderrBuf.String())
	}
	verifyStdout, verifyStderr, err := genconn.RunSimpleCommand(ctx, genconn.MakeSSHShellClient(client), genconn.CommandSpec{
		Cmd: remoteWshPath + " version",
	})
	if err != nil {
		diagStdout, diagStderr, _ := genconn.RunSimpleCommand(ctx, genconn.MakeSSHShellClient(client), genconn.CommandSpec{
			Cmd: diagnosticsCmd,
		})
		return fmt.Errorf("installed wsh version check failed for %s: %w (stderr: %s; diagnostics stdout: %s; diagnostics stderr: %s)",
			remoteWshPath, err, strings.TrimSpace(verifyStderr), strings.TrimSpace(diagStdout), strings.TrimSpace(diagStderr))
	}
	expectedVersionLine := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	if extractWshVersionLine(verifyStdout) != expectedVersionLine {
		return fmt.Errorf("installed wsh version mismatch: expected %q, got stdout %q stderr %q", expectedVersionLine, strings.TrimSpace(verifyStdout), strings.TrimSpace(verifyStderr))
	}
	return nil
}

func IsPowershell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "powershell") || strings.Contains(shellBase, "pwsh")
}

func NormalizeConfigPattern(pattern string) string {
	userName, err := WaveSshConfigUserSettings().GetStrict(pattern, "User")
	if err != nil || userName == "" {
		log.Printf("warning: error parsing username of %s for conn dropdown: %v", pattern, err)
		localUser, err := user.Current()
		if err == nil {
			userName = localUser.Username
		}
	}
	port, err := WaveSshConfigUserSettings().GetStrict(pattern, "Port")
	if err != nil {
		port = "22"
	}
	if userName != "" {
		userName += "@"
	}
	if port == "22" {
		port = ""
	} else {
		port = ":" + port
	}
	return fmt.Sprintf("%s%s%s", userName, pattern, port)
}

func ParseProfiles() []string {
	connfile, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ProfilesFile)
	if len(cerrs) > 0 {
		log.Printf("error reading config file: %v", cerrs[0])
		return nil
	}

	return iterfn.MapKeysToSorted(connfile)
}
