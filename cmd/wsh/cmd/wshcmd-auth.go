// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	authTTL      int
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
	authGrantCmd.Flags().IntVar(&authTTL, "ttl", 1800, "token lifetime in seconds (max 86400)")
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

func authGrantRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("auth grant", rtnErr == nil) }()
	if strings.TrimSpace(authName) == "" {
		return fmt.Errorf("--name is required")
	}
	res, err := wshclient.AgentAuthGrantCommand(RpcClient, wshrpc.AgentAuthGrantRequest{
		Name:       authName,
		Scope:      authScopes,
		TTLSeconds: authTTL,
	}, &wshrpc.RpcOpts{Timeout: authTimeout})
	if err != nil {
		return err
	}

	outPath := authOut
	if outPath == "" {
		outPath = defaultAgentTokenPath()
	}
	if outPath == "" {
		return fmt.Errorf("cannot determine a default token path; pass --out")
	}
	payload := AgentTokenFile{
		Version:   1,
		Name:      res.Name,
		Token:     res.Token,
		Socket:    res.Socket,
		Scopes:    res.Scopes,
		ExpiresAt: res.ExpiresAt,
		CreatedAt: res.CreatedAt,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	if err := writeSecretFile(outPath, data); err != nil {
		return err
	}

	if authJSON {
		// Never echo the token itself.
		echo := payload
		echo.Token = "***"
		out, _ := json.Marshal(echo)
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf("granted\t%s\n", res.Name)
	fmt.Printf("scopes\t%s\n", strings.Join(res.Scopes, ","))
	fmt.Printf("expires\t%s\n", formatMilli(res.ExpiresAt))
	fmt.Printf("file\t%s\n", outPath)
	return nil
}

// writeSecretFile creates the file 0600 from the start (design §10.5.9: never
// create-then-chmod, which leaves a window where the secret is world-readable).
func writeSecretFile(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write(data); err != nil {
		return err
	}
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
