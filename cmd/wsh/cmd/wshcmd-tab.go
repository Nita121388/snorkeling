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
	tabJSON       bool
	tabWsId       string
	tabCreateWsId string
	tabName       string
	tabAct        bool
	tabWait       bool
	tabWaitMs     int
	tabTimeout    int64
)

var tabCmd = &cobra.Command{
	Use:   "tab",
	Short: "List, create and activate tabs",
}

var tabListCmd = &cobra.Command{
	Use:     "list",
	Short:   "List tabs in a workspace (marks the active one)",
	Args:    cobra.NoArgs,
	RunE:    tabListRun,
	PreRunE: preRunSetupRpcClient,
}

var tabCreateCmd = &cobra.Command{
	Use:     "create",
	Short:   "Create a tab",
	Args:    cobra.NoArgs,
	RunE:    tabCreateRun,
	PreRunE: preRunSetupRpcClient,
}

var tabActivateCmd = &cobra.Command{
	Use:     "activate <tabid>",
	Short:   "Activate a tab and verify against backend truth",
	Args:    cobra.ExactArgs(1),
	RunE:    tabActivateRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	tabCmd.PersistentFlags().BoolVar(&tabJSON, "json", false, "output as JSON")
	tabCmd.PersistentFlags().Int64Var(&tabTimeout, "timeout", 8000, "RPC timeout in milliseconds")
	tabCmd.AddCommand(tabListCmd, tabCreateCmd, tabActivateCmd)

	tabListCmd.Flags().StringVar(&tabWsId, "workspace", "", "workspace id (default: current)")

	tabCreateCmd.Flags().StringVar(&tabCreateWsId, "workspace", "", "workspace id (default: current)")
	tabCreateCmd.Flags().StringVar(&tabName, "name", "", "tab name")
	tabCreateCmd.Flags().BoolVar(&tabAct, "activate", false, "activate the new tab")
	tabCreateCmd.Flags().BoolVar(&tabWait, "wait", false, "wait for backend activation")
	tabCreateCmd.Flags().IntVar(&tabWaitMs, "wait-ms", 0, "wait budget (default 1500)")

	tabActivateCmd.Flags().BoolVar(&tabWait, "wait", false, "wait for backend activation")
	tabActivateCmd.Flags().IntVar(&tabWaitMs, "wait-ms", 0, "wait budget (default 1500)")

	rootCmd.AddCommand(tabCmd)
}

func tabRpcOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Timeout: tabTimeout}
}

func tabListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("tab list", rtnErr == nil) }()
	res, err := wshclient.TabListCommand(RpcClient, wshrpc.TabListRequest{
		WorkspaceId: tabWsId,
	}, tabRpcOpts())
	if err != nil {
		return err
	}
	if tabJSON {
		return tabWriteJSON(res)
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	for _, t := range res.Tabs {
		mark := ""
		if t.Active {
			mark = "*"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\n", t.TabId, emptyDash(t.Name), mark)
	}
	return nil
}

func tabCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("tab create", rtnErr == nil) }()
	res, err := wshclient.TabCreateCommand(RpcClient, wshrpc.TabCreateRequest{
		WorkspaceId: tabCreateWsId,
		Name:        tabName,
		Activate:    tabAct,
		Wait:        tabWait,
		WaitMs:      tabWaitMs,
	}, tabRpcOpts())
	if err != nil {
		return err
	}
	if tabJSON {
		return tabWriteJSON(res)
	}
	fmt.Fprintf(os.Stdout, "tab\t%s name=%s waited=%dms\n", res.TabId, emptyDash(res.TabName), res.WaitedMs)
	for _, warn := range res.Warnings {
		fmt.Fprintf(os.Stdout, "warning\t%s\n", warn)
	}
	return nil
}

func tabActivateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("tab activate", rtnErr == nil) }()
	tabId := strings.TrimSpace(args[0])
	res, err := wshclient.TabActivateCommand(RpcClient, wshrpc.TabActivateRequest{
		TabId:  tabId,
		Wait:   tabWait,
		WaitMs: tabWaitMs,
	}, tabRpcOpts())
	if err != nil {
		return err
	}
	if tabJSON {
		return tabWriteJSON(res)
	}
	fmt.Fprintf(os.Stdout, "activated\t%s waited=%dms\n", res.TabId, res.WaitedMs)
	for _, warn := range res.Warnings {
		fmt.Fprintf(os.Stdout, "warning\t%s\n", warn)
	}
	return nil
}

func tabWriteJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}
