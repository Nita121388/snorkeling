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
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
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

// storeSyncToken persists the credential. Until the keyring plumbing lands (transport task),
// this refuses rather than pretending: silently dropping a token would leave the user with
// "configured" but permanently unauthenticated sync.
func storeSyncToken(kind string, token string) error {
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("token is empty")
	}
	if os.Getenv("SNORKELING_SYNC_ALLOW_PLAINTEXT_TOKEN") == "1" {
		WriteStdout("warning: token NOT stored (keyring not implemented yet); settings only records hastoken\n")
		return nil
	}
	return fmt.Errorf(
		"keyring storage for sync tokens is not implemented yet, so the %s token cannot be stored safely.\n"+
			"Set SNORKELING_SYNC_ALLOW_PLAINTEXT_TOKEN=1 to record only the hastoken flag (sync will not authenticate), "+
			"or configure the token from the Settings UI once keyring support lands",
		kind,
	)
}
