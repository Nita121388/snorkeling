// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"strconv"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// 派发队列的 CLI 面：agent send --async 提交后拿到 dispatchid，用 dispatch 子命令读回执。
// 三段回执见 pkg/agentdispatch（accepted → submitted → confirmed）。

var (
	agentDispatchListBlock string
	agentDispatchListLimit int
	agentDispatchListJSON  bool
	agentDispatchGetID     string
	agentDispatchGetJSON   bool
	agentDispatchRetryID   string
	agentDispatchRetryJSON bool
)

var agentDispatchCmd = &cobra.Command{
	Use:   "dispatch",
	Short: "Inspect and retry queued agent dispatches",
}

var agentDispatchListCmd = &cobra.Command{
	Use:     "list",
	Short:   "List dispatch records (newest first)",
	RunE:    agentDispatchListRun,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
}

var agentDispatchGetCmd = &cobra.Command{
	Use:     "get",
	Short:   "Show one dispatch record",
	RunE:    agentDispatchGetRun,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
}

var agentDispatchRetryCmd = &cobra.Command{
	Use:     "retry",
	Short:   "Re-queue a failed dispatch (same id)",
	RunE:    agentDispatchRetryRun,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	agentDispatchListCmd.Flags().StringVar(&agentDispatchListBlock, "block", "", "filter by block id")
	agentDispatchListCmd.Flags().IntVar(&agentDispatchListLimit, "limit", 20, "maximum records to show")
	agentDispatchListCmd.Flags().BoolVar(&agentDispatchListJSON, "json", false, "output as JSON")
	agentDispatchGetCmd.Flags().StringVar(&agentDispatchGetID, "id", "", "dispatch id (required)")
	agentDispatchGetCmd.Flags().BoolVar(&agentDispatchGetJSON, "json", false, "output as JSON")
	agentDispatchRetryCmd.Flags().StringVar(&agentDispatchRetryID, "id", "", "dispatch id (required)")
	agentDispatchRetryCmd.Flags().BoolVar(&agentDispatchRetryJSON, "json", false, "output as JSON")
	agentDispatchGetCmd.MarkFlagRequired("id")
	agentDispatchRetryCmd.MarkFlagRequired("id")
	agentDispatchCmd.AddCommand(agentDispatchListCmd, agentDispatchGetCmd, agentDispatchRetryCmd)
	agentCmd.AddCommand(agentDispatchCmd)
}

func agentDispatchListRun(cmd *cobra.Command, args []string) error {
	records, err := wshclient.AgentDispatchListCommand(RpcClient, wshrpc.AgentDispatchListRequest{
		BlockId: agentDispatchListBlock,
		Limit:   agentDispatchListLimit,
	}, &wshrpc.RpcOpts{Timeout: 8000})
	if err != nil {
		return err
	}
	if agentDispatchListJSON {
		return writeJSONResult(records)
	}
	if len(records) == 0 {
		WriteStdout("no dispatches\n")
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "DISPATCHID\tBLOCK\tSTATE\tREQ\tRETRIES\tCONFIRMED\tERROR")
	for _, r := range records {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			r.DispatchId, dispatchShortId(r.BlockId), r.State, orDash(r.Requester),
			strconv.Itoa(r.SubmitRetries), boolWord(r.ConfirmedAt > 0), orDash(r.Error))
	}
	w.Flush()
	return nil
}

func agentDispatchGetRun(cmd *cobra.Command, args []string) error {
	rec, err := wshclient.AgentDispatchGetCommand(RpcClient, wshrpc.AgentDispatchGetRequest{DispatchId: agentDispatchGetID}, &wshrpc.RpcOpts{Timeout: 8000})
	if err != nil {
		return err
	}
	if agentDispatchGetJSON {
		return writeJSONResult(rec)
	}
	WriteStdout("dispatchid\t%s\n", rec.DispatchId)
	WriteStdout("block\t%s\n", rec.BlockId)
	WriteStdout("state\t%s\n", rec.State)
	WriteStdout("requester\t%s\n", orDash(rec.Requester))
	WriteStdout("submitretries\t%d\n", rec.SubmitRetries)
	WriteStdout("accepted\t%v\n", rec.AcceptedAt > 0)
	WriteStdout("submitted\t%v\n", rec.SubmittedAt > 0)
	WriteStdout("confirmed\t%v\n", rec.ConfirmedAt > 0)
	if rec.Error != "" {
		WriteStdout("error\t%s\n", rec.Error)
	}
	return nil
}

func agentDispatchRetryRun(cmd *cobra.Command, args []string) error {
	rec, err := wshclient.AgentDispatchRetryCommand(RpcClient, wshrpc.AgentDispatchRetryRequest{DispatchId: agentDispatchRetryID}, &wshrpc.RpcOpts{Timeout: 8000})
	if err != nil {
		return err
	}
	if agentDispatchRetryJSON {
		return writeJSONResult(rec)
	}
	WriteStdout("dispatchid\t%s\n", rec.DispatchId)
	WriteStdout("state\t%s\n", rec.State)
	return nil
}

func dispatchShortId(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

func boolWord(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}
