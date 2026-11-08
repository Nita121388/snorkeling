// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	uiJSON     bool
	uiWindowId string
	uiWsId     string
	uiTimeout  int64
)

var uiCmd = &cobra.Command{
	Use:   "ui",
	Short: "Observe the Snorkeling UI (read-only)",
}

var uiActiveCmd = &cobra.Command{
	Use:     "active",
	Short:   "Show where the agent stands vs where the user is looking",
	Args:    cobra.NoArgs,
	RunE:    uiActiveRun,
	PreRunE: preRunSetupRpcClient,
}

var uiStateCmd = &cobra.Command{
	Use:     "state",
	Short:   "Show a backend-only snapshot of windows/tabs/blocks",
	Args:    cobra.NoArgs,
	RunE:    uiStateRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	uiCmd.PersistentFlags().BoolVar(&uiJSON, "json", false, "output as JSON")
	uiCmd.PersistentFlags().Int64Var(&uiTimeout, "timeout", 8000, "RPC timeout in milliseconds")
	uiCmd.AddCommand(uiActiveCmd, uiStateCmd)

	uiStateCmd.Flags().StringVar(&uiWindowId, "window", "", "limit to a window")
	uiStateCmd.Flags().StringVar(&uiWsId, "workspace", "", "limit to a workspace")

	rootCmd.AddCommand(uiCmd)
}

func uiRpcOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Timeout: uiTimeout}
}

func uiActiveRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("ui active", rtnErr == nil) }()
	res, err := wshclient.UIActiveCommand(RpcClient, wshrpc.UIActiveRequest{
		BlockId: strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID")),
		TabId:   strings.TrimSpace(os.Getenv("WAVETERM_TABID")),
	}, uiRpcOpts())
	if err != nil {
		return err
	}
	if uiJSON {
		return uiWriteJSON(res)
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintln(w, "SELF (agent)")
	fmt.Fprintf(w, "  tab\t%s\n", emptyDash(res.Self.TabId))
	fmt.Fprintf(w, "  block\t%s (#%d)\n", emptyDash(res.Self.BlockId), res.Self.BlockNum)
	fmt.Fprintln(w, "ACTIVE (user)")
	if res.Active == nil {
		fmt.Fprintln(w, "  (unavailable)")
	} else {
		fmt.Fprintf(w, "  window\t%s\n", emptyDash(res.Active.WindowId))
		fmt.Fprintf(w, "  workspace\t%s\n", emptyDash(res.Active.WorkspaceId))
		fmt.Fprintf(w, "  tab\t%s (%s)\n", emptyDash(res.Active.TabId), emptyDash(res.Active.TabName))
		fmt.Fprintf(w, "  block\t%s view=%s title=%s\n", emptyDash(res.Active.BlockId), emptyDash(res.Active.View), emptyDash(res.Active.Title))
	}
	for _, warn := range res.Warnings {
		fmt.Fprintf(w, "  warning: %s\n", warn)
	}
	return nil
}

func uiStateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("ui state", rtnErr == nil) }()
	res, err := wshclient.UIStateCommand(RpcClient, wshrpc.UIStateRequest{
		WindowId:    uiWindowId,
		WorkspaceId: uiWsId,
	}, uiRpcOpts())
	if err != nil {
		return err
	}
	if uiJSON {
		return uiWriteJSON(res)
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintln(w, "BLOCK\tVIEW\tTITLE\tTAB")
	for _, b := range res.Blocks {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", b.BlockId, emptyDash(b.View), emptyDash(b.Title), b.TabId)
	}
	return nil
}

func uiWriteJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func emptyDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
