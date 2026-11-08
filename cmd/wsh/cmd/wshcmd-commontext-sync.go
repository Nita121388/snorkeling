// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

// `wsh commontext-sync` — configure Common Text sync without opening the Settings UI.
//
// Why this exists: an agent (or a provisioning script) cannot click a radio button in the
// waveconfig panel. Without a CLI the only way to set a sync transport is the UI, so
// "agent configures the sync server for me" is impossible. This command writes the exact same
// `commontext:sync:*` keys the panel writes, so both paths stay equivalent by construction.
//
// The keys are flat (colon-separated, no slashes), so `wsh setconfig` could technically set
// them too — but it cannot validate prerequisites, so a typo'd URL or a missing token would be
// saved silently and sync would never start. This command checks the same invariants the UI
// checks and prints what is still missing.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/sync"
	"github.com/wavetermdev/waveterm/pkg/syncclient"
	"github.com/wavetermdev/waveterm/pkg/syncconflict"
	"github.com/wavetermdev/waveterm/pkg/syncjournal"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var commonTextSyncCmd = &cobra.Command{
	Use:   "commontext-sync",
	Short: "configure Common Text cloud sync",
	Long: `Configure Common Text cloud sync from the command line.

Subcommands:
  show                          print the current sync configuration
  set-folder <path>             use a cloud-drive folder as the transport
  set-server <url> [--token]    use a self-hosted sync server
  set-git <remote> [--token]    use a private git repository
  off                           disable syncing (local only)
  set <key=value> ...           write raw commontext:sync:* keys

Examples:
  wsh commontext-sync set-server https://sync.example.com
  wsh commontext-sync set-folder "C:/Users/me/OneDrive/Snorkeling/commontext.json"
  wsh commontext-sync show --json`,
}

var commonTextSyncShowJson bool
var commonTextSyncToken string
var commonTextSyncInterval string
var commonTextSyncInsecure bool
var commonTextSyncDeviceName string
var commonTextSyncLogLines int
var commonTextSyncConflictsCopy bool
var commonTextSyncResolveTextFile string
var commonTextSyncResolveLocal bool
var commonTextSyncResolveRemote bool

func init() {
	rootCmd.AddCommand(commonTextSyncCmd)

	showCmd := &cobra.Command{
		Use:   "show",
		Short: "print the current sync configuration",
		RunE:  commonTextSyncShowRun,
	}
	showCmd.Flags().BoolVar(&commonTextSyncShowJson, "json", false, "print JSON")
	commonTextSyncCmd.AddCommand(showCmd)

	folderCmd := &cobra.Command{
		Use:   "set-folder <path>",
		Short: "sync through a file in a cloud-drive folder",
		Args:  cobra.ExactArgs(1),
		RunE:  commonTextSyncFolderRun,
	}
	commonTextSyncCmd.AddCommand(folderCmd)

	serverCmd := &cobra.Command{
		Use:   "set-server <url>",
		Short: "sync through a self-hosted server",
		Args:  cobra.ExactArgs(1),
		RunE:  commonTextSyncServerRun,
	}
	serverCmd.Flags().StringVar(&commonTextSyncToken, "token", "", "server token (stored in the OS keyring)")
	serverCmd.Flags().BoolVar(&commonTextSyncInsecure, "allow-insecure", false, "allow plain http:// (LAN / self-signed)")
	commonTextSyncCmd.AddCommand(serverCmd)

	gitCmd := &cobra.Command{
		Use:   "set-git <remote>",
		Short: "sync through a private git repository",
		Args:  cobra.ExactArgs(1),
		RunE:  commonTextSyncGitRun,
	}
	gitCmd.Flags().StringVar(&commonTextSyncToken, "token", "", "access token (stored in the OS keyring)")
	gitCmd.Flags().StringVar(&commonTextSyncInterval, "interval", "15m", "commit/pull interval")
	commonTextSyncCmd.AddCommand(gitCmd)

	commonTextSyncCmd.AddCommand(&cobra.Command{
		Use:   "off",
		Short: "disable syncing (local only)",
		RunE:  commonTextSyncOffRun,
	})

	deviceCmd := &cobra.Command{
		Use:   "set-device-name <name>",
		Short: "set the display name of this computer",
		Args:  cobra.ExactArgs(1),
		RunE:  commonTextSyncDeviceRun,
	}
	commonTextSyncCmd.AddCommand(deviceCmd)

	commonTextSyncCmd.AddCommand(&cobra.Command{
		Use:   "set <key=value> ...",
		Short: "write raw commontext:sync:* keys",
		Args:  cobra.MinimumNArgs(1),
		RunE:  commonTextSyncRawRun,
	})

	doctorCmd := &cobra.Command{
		Use:   "doctor",
		Short: "diagnose the sync setup and print the exact fix for each problem",
		RunE:  commonTextSyncDoctorRun,
	}
	doctorCmd.Flags().BoolVar(&commonTextSyncShowJson, "json", false, "print JSON")
	commonTextSyncCmd.AddCommand(doctorCmd)

	logCmd := &cobra.Command{
		Use:   "log",
		Short: "print recent sync activity",
		RunE:  commonTextSyncLogRun,
	}
	logCmd.Flags().IntVar(&commonTextSyncLogLines, "n", 20, "how many events")
	logCmd.Flags().BoolVar(&commonTextSyncShowJson, "json", false, "print JSON lines")
	commonTextSyncCmd.AddCommand(logCmd)

	syncNowCmd := &cobra.Command{
		Use:   "sync",
		Short: "run one sync through the configured transport",
		RunE:  commonTextSyncRunRun,
	}
	commonTextSyncCmd.AddCommand(syncNowCmd)

	conflictsCmd := &cobra.Command{
		Use:   "conflicts",
		Short: "list unresolved sync conflicts",
		RunE:  commonTextSyncConflictsRun,
	}
	conflictsCmd.Flags().BoolVar(&commonTextSyncConflictsCopy, "copy", false, "print a self-contained AI-ready block")
	conflictsCmd.Flags().BoolVar(&commonTextSyncShowJson, "json", false, "print JSON")
	commonTextSyncCmd.AddCommand(conflictsCmd)

	resolveCmd := &cobra.Command{
		Use:   "resolve <id>",
		Short: "resolve a conflict with merged or chosen content",
		Args:  cobra.ExactArgs(1),
		RunE:  commonTextSyncResolveRun,
	}
	resolveCmd.Flags().StringVar(&commonTextSyncResolveTextFile, "text-file", "", "file containing the merged text (use - for stdin)")
	resolveCmd.Flags().BoolVar(&commonTextSyncResolveLocal, "take-local", false, "keep this machine's version")
	resolveCmd.Flags().BoolVar(&commonTextSyncResolveRemote, "take-remote", false, "keep the remote version")
	commonTextSyncCmd.AddCommand(resolveCmd)
}

// syncSettingsFromEnv reads the current values through the same RPC the UI uses.
//
// There is no "get all settings" RPC; GetFullConfigCommand returns the merged settings as a
// typed struct, so it is flattened back into a key→value map here. Flattening via JSON keeps
// this in sync with the json tags automatically (no hand-maintained key list to drift).
func syncSettingsFromEnv() (map[string]any, error) {
	full, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 3000})
	if err != nil {
		return nil, fmt.Errorf("reading settings: %w", err)
	}
	raw, err := json.Marshal(full.Settings)
	if err != nil {
		return nil, fmt.Errorf("encoding settings: %w", err)
	}
	out := make(map[string]any)
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decoding settings: %w", err)
	}
	return out, nil
}

func syncKeyValue(settings map[string]any, key string) any {
	return settings[key]
}

func syncKeyString(settings map[string]any, key string) string {
	if v, ok := settings[key].(string); ok {
		return v
	}
	return ""
}

func syncKeyBool(settings map[string]any, key string) bool {
	if v, ok := settings[key].(bool); ok {
		return v
	}
	return false
}

func applySyncSettings(patch map[string]any) error {
	if err := wshclient.SetConfigCommand(RpcClient, wshrpc.MetaSettingsType{MetaMapType: patch}, &wshrpc.RpcOpts{Timeout: 3000}); err != nil {
		return fmt.Errorf("writing settings: %w", err)
	}
	return nil
}

// transportReadiness mirrors blockedReasonFor() in the Settings panel: one judgement, two
// consumers (UI + CLI), so a config that looks fine in one place is never broken in the other.
func transportReadiness(transport string, settings map[string]any) string {
	switch transport {
	case "folder":
		if strings.TrimSpace(syncKeyString(settings, "commontext:sync:folder:path")) == "" {
			return "set a file path with: wsh commontext-sync set-folder <path>"
		}
	case "git":
		if !syncKeyBool(settings, "commontext:sync:git:hastoken") {
			return "configure a token with: wsh commontext-sync set-git <remote> --token <pat>"
		}
		if strings.TrimSpace(syncKeyString(settings, "commontext:sync:git:remote")) == "" {
			return "set a remote with: wsh commontext-sync set-git <remote>"
		}
	case "server":
		if strings.TrimSpace(syncKeyString(settings, "commontext:sync:server:url")) == "" {
			return "set a server URL with: wsh commontext-sync set-server <url>"
		}
		if !syncKeyBool(settings, "commontext:sync:server:hastoken") {
			return "configure a token with: wsh commontext-sync set-server <url> --token <token>"
		}
	case "none", "":
		return ""
	default:
		return fmt.Sprintf("unknown transport %q (expected none|folder|git|server)", transport)
	}
	return ""
}

func commonTextSyncShowRun(cmd *cobra.Command, args []string) error {
	settings, err := syncSettingsFromEnv()
	if err != nil {
		return err
	}
	transport := syncKeyString(settings, "commontext:sync:transport")
	if transport == "" {
		transport = "none"
	}
	view := map[string]any{
		"transport":      transport,
		"conflictPolicy": syncKeyString(settings, "commontext:sync:conflictpolicy"),
		"deviceName":     syncKeyString(settings, "commontext:sync:devicename"),
		"deviceId":       syncKeyString(settings, "commontext:sync:deviceid"),
		"folderPath":     syncKeyString(settings, "commontext:sync:folder:path"),
		"folderWatch":    syncKeyBool(settings, "commontext:sync:folder:watch"),
		"gitRemote":      syncKeyString(settings, "commontext:sync:git:remote"),
		"gitInterval":    syncKeyString(settings, "commontext:sync:git:interval"),
		"gitHasToken":    syncKeyBool(settings, "commontext:sync:git:hastoken"),
		"serverUrl":      syncKeyString(settings, "commontext:sync:server:url"),
		"serverPushMode": syncKeyString(settings, "commontext:sync:server:pushmode"),
		"serverHasToken": syncKeyBool(settings, "commontext:sync:server:hastoken"),
		"serverInsecure": syncKeyBool(settings, "commontext:sync:server:allowinsecure"),
		"syncTombstones": syncKeyBool(settings, "commontext:sync:synctombstones"),
		"ready":          transportReadiness(transport, settings) == "",
		"missing":        transportReadiness(transport, settings),
	}
	if commonTextSyncShowJson {
		out, _ := json.MarshalIndent(view, "", "  ")
		// %s 而非直接把内容当格式串：JSON 里出现 % 会被 WriteStdout 当成格式化指令。
		WriteStdout("%s\n", string(out))
		return nil
	}
	WriteStdout("transport:   %s\n", transport)
	if missing := transportReadiness(transport, settings); missing != "" {
		WriteStdout("status:      NOT READY — %s\n", missing)
	} else if transport == "none" {
		WriteStdout("status:      local only (nothing is uploaded)\n")
	} else {
		WriteStdout("status:      ready\n")
	}
	switch transport {
	case "folder":
		WriteStdout("folder:      %s\n", syncKeyString(settings, "commontext:sync:folder:path"))
	case "git":
		WriteStdout("remote:      %s\n", syncKeyString(settings, "commontext:sync:git:remote"))
		WriteStdout("interval:    %s\n", syncKeyString(settings, "commontext:sync:git:interval"))
		WriteStdout("token:       %v\n", syncKeyBool(settings, "commontext:sync:git:hastoken"))
	case "server":
		WriteStdout("server:      %s\n", syncKeyString(settings, "commontext:sync:server:url"))
		WriteStdout("push mode:   %s\n", syncKeyString(settings, "commontext:sync:server:pushmode"))
		WriteStdout("token:       %v\n", syncKeyBool(settings, "commontext:sync:server:hastoken"))
		WriteStdout("insecure:    %v\n", syncKeyBool(settings, "commontext:sync:server:allowinsecure"))
	}
	return nil
}

func commonTextSyncFolderRun(cmd *cobra.Command, args []string) error {
	path := strings.TrimSpace(args[0])
	if path == "" {
		return fmt.Errorf("path is required")
	}
	if err := applySyncSettings(map[string]any{
		"commontext:sync:transport":    "folder",
		"commontext:sync:folder:path":  path,
		"commontext:sync:folder:watch": true,
	}); err != nil {
		return err
	}
	WriteStdout("config set\ntransport: folder\npath:      %s\n", path)
	return nil
}

func commonTextSyncServerRun(cmd *cobra.Command, args []string) error {
	url := strings.TrimSpace(args[0])
	if url == "" {
		return fmt.Errorf("server URL is required")
	}
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return fmt.Errorf("server URL must start with https:// or http:// (got %q)", url)
	}
	patch := map[string]any{
		"commontext:sync:transport":       "server",
		"commontext:sync:server:url":      url,
		"commontext:sync:server:pushmode": "realtime",
	}
	if commonTextSyncInsecure {
		patch["commontext:sync:server:allowinsecure"] = true
	}
	if strings.HasPrefix(url, "http://") && !commonTextSyncInsecure {
		WriteStdout("note: http:// requires --allow-insecure to actually connect\n")
	}
	if commonTextSyncToken != "" {
		// The token itself is a keyring secret; settings only records that one exists.
		if err := storeSyncToken("server", commonTextSyncToken); err != nil {
			return err
		}
		patch["commontext:sync:server:hastoken"] = true
	}
	if err := applySyncSettings(patch); err != nil {
		return err
	}
	WriteStdout("config set\ntransport: server\nurl:       %s\n", url)
	if commonTextSyncToken == "" {
		WriteStdout("status:    NOT READY — pass --token to configure authentication\n")
	}
	return nil
}

func commonTextSyncGitRun(cmd *cobra.Command, args []string) error {
	remote := strings.TrimSpace(args[0])
	if remote == "" {
		return fmt.Errorf("remote is required")
	}
	patch := map[string]any{
		"commontext:sync:transport":    "git",
		"commontext:sync:git:remote":   remote,
		"commontext:sync:git:interval": commonTextSyncInterval,
	}
	if commonTextSyncToken != "" {
		if err := storeSyncToken("git", commonTextSyncToken); err != nil {
			return err
		}
		patch["commontext:sync:git:hastoken"] = true
	}
	if err := applySyncSettings(patch); err != nil {
		return err
	}
	WriteStdout("config set\ntransport: git\nremote:    %s\ninterval:  %s\n", remote, commonTextSyncInterval)
	if commonTextSyncToken == "" {
		WriteStdout("status:    NOT READY — pass --token to configure authentication\n")
	}
	return nil
}

func commonTextSyncOffRun(cmd *cobra.Command, args []string) error {
	if err := applySyncSettings(map[string]any{"commontext:sync:transport": "none"}); err != nil {
		return err
	}
	WriteStdout("config set\ntransport: none (local only)\n")
	return nil
}

func commonTextSyncDeviceRun(cmd *cobra.Command, args []string) error {
	name := strings.TrimSpace(args[0])
	if name == "" {
		return fmt.Errorf("device name is required")
	}
	if err := applySyncSettings(map[string]any{"commontext:sync:devicename": name}); err != nil {
		return err
	}
	WriteStdout("config set\ndevice name: %s\n", name)
	return nil
}

func commonTextSyncRawRun(cmd *cobra.Command, args []string) error {
	patch := make(map[string]any)
	for _, arg := range args {
		fields := strings.SplitN(arg, "=", 2)
		if len(fields) != 2 {
			return fmt.Errorf("invalid key=value: %q", arg)
		}
		key := strings.TrimSpace(fields[0])
		if !strings.HasPrefix(key, "commontext:sync:") {
			return fmt.Errorf("key must start with commontext:sync: (got %q)", key)
		}
		value, err := parseMetaValue(fields[1])
		if err != nil {
			return err
		}
		patch[key] = value
	}
	if err := applySyncSettings(patch); err != nil {
		return err
	}
	WriteStdout("config set\n")
	return nil
}

// syncTokenSecretName maps a transport to its secretstore entry. The secretstore name pattern
// forbids colons, so these are underscored even though the settings keys are not.
func syncTokenSecretName(kind string) string {
	if kind == "git" {
		return syncclient.SecretGitToken
	}
	return syncclient.SecretServerToken
}

// storeSyncToken writes the credential into the existing secrets store (secrets.enc, encrypted
// via Electron safeStorage) — the same mechanism the Secrets panel uses, so there is no second
// place a credential can hide and no plaintext copy in settings.json.
func storeSyncToken(kind string, token string) error {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return fmt.Errorf("token is empty")
	}
	name := syncTokenSecretName(kind)
	// SetSecretsCommand takes map[string]*string so a nil value can mean "delete".
	value := trimmed
	if err := wshclient.SetSecretsCommand(RpcClient, map[string]*string{name: &value},
		&wshrpc.RpcOpts{Timeout: 4000}); err != nil {
		return fmt.Errorf("storing token in secrets: %w", err)
	}
	return nil
}

// loadSyncToken reads the credential back. A missing secret is not an error: it just means the
// user has not configured one yet.
func loadSyncToken(kind string) string {
	name := syncTokenSecretName(kind)
	resp, err := wshclient.GetSecretsCommand(RpcClient, []string{name}, &wshrpc.RpcOpts{Timeout: 3000})
	if err != nil || resp == nil {
		return ""
	}
	return resp[name]
}

// ---------------------------------------------------------------------------
// doctor / log
// ---------------------------------------------------------------------------

// commonTextSyncDoctorRun prints per-check results with an actionable fix for every failure.
//
// This is the agent-facing entry point: an agent runs `doctor --json`, reads `checks[].fix`,
// executes it, and runs doctor again. No step requires interpreting a prose error.
func commonTextSyncDoctorRun(cmd *cobra.Command, args []string) error {
	settings, err := syncSettingsFromEnv()
	if err != nil {
		return err
	}
	transport := syncKeyString(settings, "commontext:sync:transport")
	if transport == "" {
		transport = "none"
	}

	report := map[string]any{"transport": transport}

	switch transport {
	case "server":
		url := syncKeyString(settings, "commontext:sync:server:url")
		insecure := syncKeyBool(settings, "commontext:sync:server:allowinsecure")
		token := loadSyncToken("server")
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		probe := syncclient.Diagnose(ctx, url, token, insecure)
		report["url"] = probe.URL
		report["ready"] = probe.Ready
		report["health"] = probe.Health
		report["checks"] = probe.Checks
		if commonTextSyncShowJson {
			out, _ := json.MarshalIndent(report, "", "  ")
			WriteStdout("%s\n", string(out))
			return nil
		}
		printProbe(probe)
	case "folder":
		path := syncKeyString(settings, "commontext:sync:folder:path")
		checks := checkFolderPath(path)
		ready := true
		for _, c := range checks {
			if c.State == syncclient.CheckFailed {
				ready = false
			}
		}
		report["ready"] = ready
		report["checks"] = checks
		if commonTextSyncShowJson {
			out, _ := json.MarshalIndent(report, "", "  ")
			WriteStdout("%s\n", string(out))
			return nil
		}
		printChecks(checks)
	case "git":
		remote := syncKeyString(settings, "commontext:sync:git:remote")
		checks := []syncclient.Check{{Id: "remote", State: syncclient.CheckOK, Detail: remote}}
		if strings.TrimSpace(remote) == "" {
			checks = []syncclient.Check{{
				Id: "remote", State: syncclient.CheckFailed, Detail: "no remote configured",
				Fix: "wsh commontext-sync set-git <remote> --token <pat>",
			}}
		}
		hasToken := loadSyncToken("git") != ""
		state := syncclient.CheckOK
		fix := ""
		if !hasToken {
			state = syncclient.CheckFailed
			fix = "wsh commontext-sync set-git " + remote + " --token <pat>"
		}
		checks = append(checks, syncclient.Check{Id: "auth", State: state, Detail: "git access token", Fix: fix})
		report["checks"] = checks
		report["ready"] = state == syncclient.CheckOK && strings.TrimSpace(remote) != ""
		if commonTextSyncShowJson {
			out, _ := json.MarshalIndent(report, "", "  ")
			WriteStdout("%s\n", string(out))
			return nil
		}
		printChecks(checks)
	default:
		report["ready"] = true
		report["checks"] = []syncclient.Check{{
			Id: "transport", State: syncclient.CheckOK, Detail: "local only — nothing is uploaded",
		}}
		if commonTextSyncShowJson {
			out, _ := json.MarshalIndent(report, "", "  ")
			WriteStdout("%s\n", string(out))
			return nil
		}
		WriteStdout("transport: none (local only — nothing is uploaded)\n")
	}
	return nil
}

func printProbe(probe *syncclient.Probe) {
	printChecks(probe.Checks)
	if probe.Health != nil {
		WriteStdout("\nserver:  %s %s (protocol v%d)\n", probe.Health.Service,
			probe.Health.AppVersion, probe.Health.ProtocolVersion)
		WriteStdout("items:   %.0f at rev %.0f\n", probe.Health.Items, probe.Health.Rev)
	}
	if probe.Ready {
		WriteStdout("\nstatus:  READY\n")
	} else {
		WriteStdout("\nstatus:  NOT READY\n")
	}
}

func printChecks(checks []syncclient.Check) {
	for _, c := range checks {
		mark := "✓"
		switch c.State {
		case syncclient.CheckFailed:
			mark = "✗"
		case syncclient.CheckSkipped:
			mark = "-"
		}
		WriteStdout("%s %-9s %s\n", mark, c.Id, c.Detail)
		if c.State == syncclient.CheckFailed && c.Fix != "" {
			WriteStdout("           fix: %s\n", c.Fix)
		}
	}
}

// checkFolderPath validates the folder transport without touching the filesystem beyond a stat.
func checkFolderPath(path string) []syncclient.Check {
	if strings.TrimSpace(path) == "" {
		return []syncclient.Check{{
			Id: "path", State: syncclient.CheckFailed, Detail: "no file path configured",
			Fix: "wsh commontext-sync set-folder <path/to/commontext.json>",
		}}
	}
	checks := []syncclient.Check{{Id: "path", State: syncclient.CheckOK, Detail: path}}
	dir := filepath.Dir(path)
	if info, err := os.Stat(dir); err != nil {
		checks = append(checks, syncclient.Check{
			Id: "dir", State: syncclient.CheckFailed,
			Detail: fmt.Sprintf("directory does not exist: %s", dir),
			Fix:    fmt.Sprintf("mkdir -p %s", dir),
		})
	} else if !info.IsDir() {
		checks = append(checks, syncclient.Check{
			Id: "dir", State: syncclient.CheckFailed, Detail: "parent path is not a directory",
		})
	} else {
		checks = append(checks, syncclient.Check{Id: "dir", State: syncclient.CheckOK, Detail: "directory exists"})
	}
	return checks
}

// commonTextSyncLogRun prints recent journal events. This is the "did it actually sync?" answer.
func commonTextSyncLogRun(cmd *cobra.Command, args []string) error {
	events, err := syncjournal.ReadRecent(commonTextSyncLogLines)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		WriteStdout("no sync activity recorded yet\n")
		return nil
	}
	if commonTextSyncShowJson {
		for _, ev := range events {
			line, _ := json.Marshal(ev)
			WriteStdout("%s\n", string(line))
		}
		return nil
	}
	for _, ev := range events {
		writeEventLine(ev)
	}
	return nil
}

func writeEventLine(ev syncjournal.Event) {
	switch ev.Type {
	case syncjournal.EventRunStart:
		WriteStdout("%s  run start (%s)\n", shortTime(ev.TS), ev.Trigger)
	case syncjournal.EventPull:
		WriteStdout("%s  pull   %d item(s) since rev %.0f\n", shortTime(ev.TS), ev.Items, ev.Since)
	case syncjournal.EventPush:
		WriteStdout("%s  push   %d item(s) → rev %.0f\n", shortTime(ev.TS), ev.Items, ev.Rev)
	case syncjournal.EventConflict:
		WriteStdout("%s  conflict  %s (%s) → %s\n", shortTime(ev.TS), ev.Id,
			strings.Join(ev.Fields, ","), ev.Resolved)
	case syncjournal.EventError:
		WriteStdout("%s  ERROR  %s: %s\n", shortTime(ev.TS), ev.Phase, ev.Msg)
	case syncjournal.EventRunEnd:
		status := "ok"
		if !ev.OK {
			status = "failed"
		}
		WriteStdout("%s  run end  %s (%dms)\n", shortTime(ev.TS), status, ev.Ms)
	default:
		WriteStdout("%s  %s\n", shortTime(ev.TS), ev.Type)
	}
}

func shortTime(rfc3339 string) string {
	t, err := time.Parse(time.RFC3339Nano, rfc3339)
	if err != nil {
		return rfc3339
	}
	return t.Local().Format("01-02 15:04:05")
}

// ---------------------------------------------------------------------------
// conflicts / resolve
// ---------------------------------------------------------------------------

// commonTextSyncConflictsRun lists unresolved conflicts. With --copy it prints a self-contained
// block whose last section states the task, so it can be pasted into an AI with no extra words.
func commonTextSyncConflictsRun(cmd *cobra.Command, args []string) error {
	entries, err := syncconflict.List()
	if err != nil {
		return err
	}
	if commonTextSyncShowJson {
		out, _ := json.MarshalIndent(entries, "", "  ")
		WriteStdout("%s\n", string(out))
		return nil
	}
	if len(entries) == 0 {
		WriteStdout("no unresolved conflicts\n")
		return nil
	}
	if commonTextSyncConflictsCopy {
		WriteStdout("%s", syncconflict.RenderAll(entries))
		return nil
	}
	for _, e := range entries {
		title := e.Title
		if title == "" {
			title = "(untitled)"
		}
		WriteStdout("%s  %s\n", e.Id, title)
		WriteStdout("            fields: %s · from %s · detected %s\n",
			strings.Join(e.Fields, ", "), firstNonEmpty(e.DeviceName, "remote"), shortTime(e.DetectedAt))
	}
	WriteStdout("\nresolve with:\n")
	WriteStdout("  wsh commontext-sync conflicts --copy          # paste into an AI to merge\n")
	WriteStdout("  wsh commontext-sync resolve <id> --text-file merged.md\n")
	return nil
}

// commonTextSyncResolveRun applies a resolution. Three ways: take local, take remote, or supply
// merged text. Both-sides flags are rejected rather than silently picking one.
func commonTextSyncResolveRun(cmd *cobra.Command, args []string) error {
	id := strings.TrimSpace(args[0])
	if id == "" {
		return fmt.Errorf("conflict id is required")
	}
	chosen := 0
	if commonTextSyncResolveLocal {
		chosen++
	}
	if commonTextSyncResolveRemote {
		chosen++
	}
	if commonTextSyncResolveTextFile != "" {
		chosen++
	}
	if chosen == 0 {
		return fmt.Errorf("choose one of --take-local / --take-remote / --text-file")
	}
	if chosen > 1 {
		return fmt.Errorf("choose only one of --take-local / --take-remote / --text-file")
	}

	entries, err := syncconflict.List()
	if err != nil {
		return err
	}
	var target *syncconflict.Entry
	for i := range entries {
		if entries[i].Id == id {
			target = &entries[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("no unresolved conflict with id %q (run: wsh commontext-sync conflicts)", id)
	}

	var text string
	switch {
	case commonTextSyncResolveLocal:
		if target.Local == nil {
			return fmt.Errorf("conflict %q has no local version", id)
		}
		text = target.Local.Text
	case commonTextSyncResolveRemote:
		if target.Remote == nil {
			return fmt.Errorf("conflict %q has no remote version", id)
		}
		text = target.Remote.Text
	default:
		data, err := readTextArg(commonTextSyncResolveTextFile)
		if err != nil {
			return err
		}
		text = data
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("refusing to resolve %q with empty text — deletes go through the UI", id)
	}

	// Write the resolved content locally first, then mark the conflict resolved. If the write
	// fails the conflict stays visible, which is the safe order.
	//
	// There is no per-item RPC reachable from wsh (Common Text uses the service layer, which has no
	// generated Go client), so this goes through SetConfigCommand -> SaveFromConfigMap: read the
	// current items, replace one, write them back. The read-modify-write window is the tradeoff;
	// it is acceptable for an explicit user/agent resolution and the alternative is a new RPC just
	// for this command.
	items, err := commonTextSyncReadItems()
	if err != nil {
		return err
	}
	updated := false
	for idx := range items {
		if items[idx].Id != id {
			continue
		}
		items[idx].Text = text
		items[idx].UpdatedAt = float64(time.Now().UnixMilli())
		items[idx].Rev = items[idx].Rev + 1 // bump so the server sees a newer version
		updated = true
		break
	}
	if !updated {
		return fmt.Errorf("item %q not found in local Common Text — was it deleted?", id)
	}
	if err := wshclient.SetConfigCommand(RpcClient, wshrpc.MetaSettingsType{
		MetaMapType: map[string]any{wconfig.ConfigKey_CommonTextItems: items},
	}, &wshrpc.RpcOpts{Timeout: 8000}); err != nil {
		return fmt.Errorf("writing resolved text: %w", err)
	}
	if err := syncconflict.MarkResolved(id); err != nil {
		return err
	}
	WriteStdout("resolved %s\n", id)
	WriteStdout("next sync will push the merged version\n")
	return nil
}

// commonTextSyncReadItems loads the current Common Text items through the config path.
func commonTextSyncReadItems() ([]wconfig.CommonTextItemType, error) {
	full, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil, fmt.Errorf("reading common text: %w", err)
	}
	return full.Settings.CommonTextItems, nil
}

// readTextArg reads a file, or stdin when the arg is "-".
func readTextArg(path string) (string, error) {
	if path == "-" {
		data, err := io.ReadAll(os.Stdin)
		return string(data), err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", path, err)
	}
	return string(data), nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// sync (run one sync through the configured transport)
// ---------------------------------------------------------------------------

// commonTextSyncRunRun performs one sync now. The desktop app owns the timer-driven loop; this
// command covers "sync now" for a script or an agent, and is the only path that works without the
// GUI running.
func commonTextSyncRunRun(cmd *cobra.Command, args []string) error {
	settings, err := syncSettingsFromEnv()
	if err != nil {
		return err
	}
	transportId := sync.ParseTransport(syncKeyString(settings, "commontext:sync:transport"))
	if transportId == sync.TransportNone {
		return fmt.Errorf("no transport configured (run: wsh commontext-sync set-folder <path>)")
	}

	store := &cliSyncStore{}
	transport, err := buildTransport(settings, transportId)
	if err != nil {
		return err
	}

	engine := sync.NewEngine(
		store,
		transport,
		sync.ParseConflictPolicy(syncKeyString(settings, "commontext:sync:conflictpolicy")),
		syncKeyString(settings, "commontext:sync:deviceid"),
		syncKeyString(settings, "commontext:sync:devicename"),
		func(ev syncjournal.Event) error { return syncjournal.Append(ev) },
	)

	res, err := engine.Run(context.Background(), sync.TriggerManual)
	if err != nil {
		// Journal and conflict state are already written; report and stop.
		return fmt.Errorf("sync: %w", err)
	}
	if res.Skipped != "" {
		WriteStdout("nothing to do: %s\n", res.Skipped)
		return nil
	}
	WriteStdout("pulled %d, applied %d, pushed %d, unchanged %d (%dms)\n",
		res.Pulled, res.Applied, res.Pushed, res.Unchanged, res.Ms)
	if len(res.Conflicts) > 0 {
		// Persist them so `conflicts --copy` can hand them to an AI.
		if err := syncconflict.Record(res.Conflicts, string(transportId), syncKeyString(settings, "commontext:sync:devicename")); err != nil {
			WriteStdout("warning: could not record conflicts: %v\n", err)
		}
		WriteStdout("\n%d conflict(s) need a decision:\n", len(res.Conflicts))
		for _, c := range res.Conflicts {
			WriteStdout("  %s (%s)\n", c.Id, strings.Join(c.Fields, ", "))
		}
		WriteStdout("\n  wsh commontext-sync conflicts --copy     # paste into an AI to merge\n")
	}
	if res.StaleBase {
		WriteStdout("note: remote moved during the push; run sync again to reconcile\n")
	}
	return nil
}

// buildTransport constructs the configured transport.
func buildTransport(settings map[string]any, id sync.TransportId) (sync.Transport, error) {
	switch id {
	case sync.TransportFolder:
		path := syncKeyString(settings, "commontext:sync:folder:path")
		if strings.TrimSpace(path) == "" {
			return nil, fmt.Errorf("folder transport needs a path (run: wsh commontext-sync set-folder <path>)")
		}
		return sync.NewFolderTransport(expandHome(path))
	case sync.TransportServer:
		url := syncKeyString(settings, "commontext:sync:server:url")
		token := loadSyncToken("server")
		insecure := syncKeyBool(settings, "commontext:sync:server:allowinsecure")
		return sync.NewServerTransport(url, token, insecure)
	case sync.TransportGit:
		remote := syncKeyString(settings, "commontext:sync:git:remote")
		if strings.TrimSpace(remote) == "" {
			return nil, fmt.Errorf("git transport needs a remote (run: wsh commontext-sync set-git <remote>)")
		}
		token := loadSyncToken("git")
		repoDir, err := cliGitRepoDir()
		if err != nil {
			return nil, err
		}
		return sync.NewGitTransport(remote, repoDir, token)
	default:
		return nil, fmt.Errorf("transport %q is not implemented yet", id)
	}
}

// expandHome resolves a leading ~, which users type and shells do not always expand in config.
func expandHome(path string) string {
	if !strings.HasPrefix(path, "~") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		return filepath.Join(home, path[2:])
	}
	return path
}

// cliSyncStore bridges the engine to the local Common Text store.
//
// It uses the config path (GetFullConfig / SetConfigCommand) because Common Text lives behind the
// service layer, which has no generated Go client.
type cliSyncStore struct{}

func (s *cliSyncStore) Items(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	items, err := commonTextSyncReadItems()
	if err != nil {
		return nil, err
	}
	out := make([]syncproto.SnapshotItem, 0, len(items))
	for _, it := range items {
		out = append(out, snapshotItemFromCommonText(it))
	}
	return out, nil
}

func (s *cliSyncStore) ApplyRemote(ctx context.Context, incoming []syncproto.SnapshotItem) (int, error) {
	items, err := commonTextSyncReadItems()
	if err != nil {
		return 0, err
	}
	byId := make(map[string]int, len(items))
	for idx := range items {
		byId[items[idx].Id] = idx
	}
	applied := 0
	for _, remote := range incoming {
		if idx, ok := byId[remote.Id]; ok {
			// Only take the remote copy when it is actually newer; otherwise a pull would clobber a
			// local edit that has not been pushed yet.
			if remote.Rev <= items[idx].Rev {
				continue
			}
			items[idx] = commonTextFromSnapshotItem(remote)
		} else {
			items = append(items, commonTextFromSnapshotItem(remote))
		}
		applied++
	}
	if applied == 0 {
		return 0, nil
	}
	if err := writeCommonTextItems(items); err != nil {
		return 0, err
	}
	return applied, nil
}

func (s *cliSyncStore) LocalRevision(ctx context.Context) (float64, error) {
	items, err := commonTextSyncReadItems()
	if err != nil {
		return 0, err
	}
	var max float64
	for _, it := range items {
		if it.Rev > max {
			max = it.Rev
		}
	}
	return max, nil
}

// snapshotItemFromCommonText converts a stored item to the wire shape.
func snapshotItemFromCommonText(it wconfig.CommonTextItemType) syncproto.SnapshotItem {
	out := syncproto.SnapshotItem{
		Id:         it.Id,
		Title:      it.Title,
		Text:       it.Text,
		Shortcut:   it.Shortcut,
		Tags:       it.Tags,
		Pinned:     it.Pinned,
		CreatedAt:  it.CreatedAt,
		UpdatedAt:  it.UpdatedAt,
		LastUsedAt: it.LastUsedAt,
		UsageCount: it.UsageCount,
		Emoji:      it.Emoji,
		Rev:        it.Rev,
		DeletedAt:  it.DeletedAt,
	}
	if it.CreatedBy != nil {
		out.CreatedBy = &syncproto.Author{Kind: it.CreatedBy.Kind, Name: it.CreatedBy.Name}
	}
	if it.Origin != nil {
		out.Origin = &syncproto.Origin{
			DeviceId: it.Origin.DeviceId, DeviceName: it.Origin.DeviceName, Platform: it.Origin.Platform,
		}
	}
	return out
}

// commonTextFromSnapshotItem converts a wire item back to the stored shape.
func commonTextFromSnapshotItem(it syncproto.SnapshotItem) wconfig.CommonTextItemType {
	out := wconfig.CommonTextItemType{
		Id:         it.Id,
		Title:      it.Title,
		Text:       it.Text,
		Shortcut:   it.Shortcut,
		Tags:       it.Tags,
		Pinned:     it.Pinned,
		CreatedAt:  it.CreatedAt,
		UpdatedAt:  it.UpdatedAt,
		LastUsedAt: it.LastUsedAt,
		UsageCount: it.UsageCount,
		Emoji:      it.Emoji,
		Rev:        it.Rev,
		DeletedAt:  it.DeletedAt,
	}
	if it.CreatedBy != nil {
		out.CreatedBy = &wconfig.CommonTextCreatedByType{Kind: it.CreatedBy.Kind, Name: it.CreatedBy.Name}
	}
	if it.Origin != nil {
		out.Origin = &wconfig.CommonTextOriginType{
			DeviceId: it.Origin.DeviceId, DeviceName: it.Origin.DeviceName, Platform: it.Origin.Platform,
		}
	}
	return out
}

// writeCommonTextItems persists the full item list through the config path.
func writeCommonTextItems(items []wconfig.CommonTextItemType) error {
	return wshclient.SetConfigCommand(RpcClient, wshrpc.MetaSettingsType{
		MetaMapType: map[string]any{wconfig.ConfigKey_CommonTextItems: items},
	}, &wshrpc.RpcOpts{Timeout: 10000})
}

// cliGitRepoDir mirrors the app managed clone location so the CLI and the GUI share one clone.
// Two clones would mean two working trees racing on the same remote.
func cliGitRepoDir() (string, error) {
	dataDir := wavebase.GetWaveDataDir()
	if dataDir == "" {
		return "", fmt.Errorf("cannot locate the app data directory for the git sync clone")
	}
	return filepath.Join(dataDir, "sync", "git-repo"), nil
}
