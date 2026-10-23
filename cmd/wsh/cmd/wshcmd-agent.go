// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var agentListJSON bool

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Inspect the agent catalog (profiles and their configured models)",
}

var agentListCmd = &cobra.Command{
	Use:   "list",
	Short: "List agent profiles and their configured models",
	Long: `List agent profiles and their configured models.

The catalog merges built-in agent profiles with the user's agent:profiles
settings. It is the same source used by the scheduled-task editor, so an agent
can discover which profiles and models a new agent block should use.`,
	RunE:    agentListRun,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	agentListCmd.Flags().BoolVar(&agentListJSON, "json", false, "output the catalog as JSON")
	agentCmd.AddCommand(agentListCmd)
	rootCmd.AddCommand(agentCmd)
}

func agentListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("agent list", rtnErr == nil)
	}()

	profiles, err := wshclient.AgentProfileListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("listing agent profiles: %w", err)
	}
	if agentListJSON {
		barr, err := json.Marshal(profiles)
		if err != nil {
			return fmt.Errorf("encoding agent catalog json: %w", err)
		}
		WriteStdout("%s\n", string(barr))
		return nil
	}
	if len(profiles) == 0 {
		WriteStdout("no agent profiles configured\n")
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tLABEL\tCMD\tDEFAULT-MODEL\tMODELS")
	for _, p := range profiles {
		models := "-"
		if len(p.Models) > 0 {
			models = ""
			for i, m := range p.Models {
				if i > 0 {
					models += ","
				}
				models += m.Id
			}
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", p.Name, p.Label, p.Cmd, orDash(p.DefaultModel), models)
	}
	w.Flush()
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
