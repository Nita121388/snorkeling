// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"time"
	"text/tabwriter"
	"github.com/wavetermdev/waveterm/pkg/agentaccess"
)

// AgentTokenFile is the on-disk shape of an external-agent token. The token
// itself is a secret: the file must be 0600 and is never printed.
type AgentTokenFile struct {
	Version   int      `json:"version"`
	Name      string   `json:"name"`
	Token     string   `json:"token"`
	Socket    string   `json:"socket,omitempty"`
	Scopes    []string `json:"scopes,omitempty"`
	ExpiresAt int64    `json:"expiresat,omitempty"`
	CreatedAt int64    `json:"createdat,omitempty"`
}

var (
	authShowRevoked bool
	authRevokeName  string
	authRevokeJti   string
	authRevokeAll   bool
	authName     string
	authScopes   []string
	authTTL      string
	authOut      string
	authTimeout  int64
	authJSON     bool
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Manage external agent tokens",
}

var authGrantCmd = &cobra.Command{
	Use:   "grant --name <n> [--scope observe,navigate] [--ttl 30m] --out <file>",
	Short: "Mint a scoped token for a process outside the app",
	Long: `Mints a short-lived token that lets an agent outside Snorkeling use the
control surface (wsh --token-file, or wsh mcp serve --stdio).

Run it from inside a Snorkeling block: the app signs the token and embeds the
socket name from your own session, so it can only point back at this app.

The token is written 0600. Default scope is observe; data writes need --scope data.`,
	Args: cobra.NoArgs,
	RunE: authGrantRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	authCmd.PersistentFlags().Int64Var(&authTimeout, "timeout", 8000, "RPC timeout in milliseconds")
	authCmd.PersistentFlags().BoolVar(&authJSON, "json", false, "output as JSON")
	authCmd.AddCommand(authGrantCmd, authListCmd, authRevokeCmd)

	authGrantCmd.Flags().StringVar(&authName, "name", "", "agent name (used in the route id and audit)")
	authGrantCmd.Flags().StringSliceVar(&authScopes, "scope", []string{"observe"}, "scopes: observe,navigate,data")
	authGrantCmd.Flags().StringVar(&authTTL, "ttl", "30m", "token lifetime, e.g. 30m, 8h, or plain seconds (max 24h)")
	authGrantCmd.Flags().StringVar(&authOut, "out", "", "output file (default ~/.config/snorkeling/agent-token.json)")

	authListCmd.Flags().BoolVar(&authShowRevoked, "all", false, "include revoked tokens")
	authRevokeCmd.Flags().StringVar(&authRevokeName, "name", "", "revoke every token for this agent name")
	authRevokeCmd.Flags().StringVar(&authRevokeJti, "jti", "", "revoke one token by jti")
	authRevokeCmd.Flags().BoolVar(&authRevokeAll, "all", false, "revoke every live token")

	rootCmd.AddCommand(authCmd)
}

func defaultAgentTokenPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "snorkeling", "agent-token.json")
}

// parseTTL accepts both a Go duration ("30m", "8h") and plain seconds ("1800").
//
// Both forms are supported because the docs and the panel say "30m" while the
// flag started life as an integer; accepting only one silently broke the other.
func parseTTL(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 1800, nil
	}
	if n, err := strconv.Atoi(raw); err == nil {
		if n <= 0 {
			return 0, fmt.Errorf("E_USAGE: --ttl must be positive (got %s)", raw)
		}
		return n, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("E_USAGE: --ttl %q is not a duration (try 30m or 1800)", raw)
	}
	if d <= 0 {
		return 0, fmt.Errorf("E_USAGE: --ttl must be positive (got %s)", raw)
	}
	return int(d.Seconds()), nil
}

// tabChar avoids backslashes in format strings (see the table printing below).
const tabChar = "\u0009"

func authGrantRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("auth grant", rtnErr == nil) }()
	if strings.TrimSpace(authName) == "" {
		return fmt.Errorf("--name is required")
	}
	ttlSeconds, ttlErr := parseTTL(authTTL)
	if ttlErr != nil {
		return ttlErr
	}
	outPath := authOut
	if outPath == "" {
		outPath = defaultAgentTokenPath()
	}
	if outPath == "" {
		return fmt.Errorf("cannot determine a default token path; pass --out")
	}
	// The app writes the file (0600) so the CLI and the Agent Access panel share
	// one implementation of the permission rule instead of two.
	res, err := wshclient.AgentAuthGrantCommand(RpcClient, wshrpc.AgentAuthGrantRequest{
		Name:       authName,
		Scope:      authScopes,
		TTLSeconds: ttlSeconds,
		Out:        outPath,
	}, &wshrpc.RpcOpts{Timeout: authTimeout})
	if err != nil {
		return err
	}
	written := res.OutPath
	if written == "" {
		written = outPath
	}

	if authJSON {
		// Never echo the token itself.
		out, _ := json.Marshal(map[string]any{
			"version":   res.Version,
			"name":      res.Name,
			"token":     "***",
			"socket":    res.Socket,
			"scopes":    res.Scopes,
			"expiresat": res.ExpiresAt,
			"createdat": res.CreatedAt,
			"file":      written,
		})
		fmt.Println(string(out))
		return nil
	}
	fmt.Println("granted" + tabChar + res.Name)
	fmt.Println("scopes" + tabChar + strings.Join(res.Scopes, ","))
	fmt.Println("expires" + tabChar + formatMilli(res.ExpiresAt))
	fmt.Println("file" + tabChar + written)
	return nil
}

func formatMilli(ms int64) string {
	if ms == 0 {
		return "-"
	}
	return fmt.Sprintf("%d", ms)
}

var authListCmd = &cobra.Command{
	Use:     "list",
	Short:   "List granted agent tokens (never the token itself)",
	Args:    cobra.NoArgs,
	RunE:    authListRun,
	PreRunE: preRunSetupRpcClient,
}

var authRevokeCmd = &cobra.Command{
	Use:   "revoke [--name <n> | --jti <id> | --all]",
	Short: "Revoke an agent token so its next call fails",
	Args:  cobra.NoArgs,
	RunE:  authRevokeRun,
}

func authListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	entries, err := agentaccess.List()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	if authJSON {
		out, _ := json.Marshal(entries)
		fmt.Println(string(out))
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintln(w, "NAME\tJTI\tSCOPES\tEXPIRES\tSTATE")
	for _, e := range entries {
		state := "live"
		switch {
		case e.Revoked():
			state = "revoked"
			if !authShowRevoked {
				continue
			}
		case e.Expired(now):
			state = "expired"
			if !authShowRevoked {
				continue
			}
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
			e.Name, agentaccess.Describe(e.Jti), strings.Join(e.Scopes, ","),
			time.UnixMilli(e.ExpiresAt).Format("15:04:05"), state)
	}
	return nil
}

func authRevokeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	var count int
	var err error
	switch {
	case authRevokeAll:
		count, err = agentaccess.RevokeAll()
	case authRevokeName != "":
		count, err = agentaccess.RevokeByName(authRevokeName)
	case authRevokeJti != "":
		count, err = agentaccess.RevokeByJti(authRevokeJti)
	default:
		return fmt.Errorf("nothing to revoke: pass --name, --jti or --all")
	}
	if err != nil {
		return err
	}
	fmt.Printf("revoked\t%d\n", count)
	return nil
}
