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
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	blockJSON     bool
	blockTail     int
	blockMaxBytes int
	blockLastCmd  bool
	blockTimeout  int64
	blockView     string
	blockTab      string
	blockWsId     string
	blockSplit    string
	blockReplace  string
	blockMagnify  bool
	blockNoFocus  bool
	blockWait     bool
	blockWaitMs   int
	blockDedupe   bool
	blockUrl      string
	blockFile     string
	blockCwd      string
	blockConn     string
	blockMetaSets []string
	blockMetaFlag string
)

var blockCmd = &cobra.Command{
	Use:   "block",
	Short: "Read or open blocks (observe + navigate)",
}

var blockReadCmd = &cobra.Command{
	Use:     "read <block|this>",
	Short:   "Read bounded content of a block, dispatched by view",
	Args:    cobra.ExactArgs(1),
	RunE:    blockReadRun,
	PreRunE: preRunSetupRpcClient,
}

var blockOpenCmd = &cobra.Command{
	Use:     "open",
	Short:   "Open a new block (term/web/preview/edit/agent)",
	Args:    cobra.NoArgs,
	RunE:    blockOpenRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	blockCmd.PersistentFlags().BoolVar(&blockJSON, "json", false, "output as JSON")
	blockCmd.PersistentFlags().Int64Var(&blockTimeout, "timeout", 8000, "RPC timeout in milliseconds")
	blockCmd.AddCommand(blockReadCmd, blockOpenCmd)

	blockReadCmd.Flags().IntVar(&blockTail, "tail", 80, "lines to return for terminal blocks")
	blockReadCmd.Flags().IntVar(&blockMaxBytes, "max-bytes", 65536, "content byte cap")
	blockReadCmd.Flags().BoolVar(&blockLastCmd, "lastcommand", false, "only the last command (terminal blocks)")

	blockOpenCmd.Flags().StringVar(&blockView, "view", "", "view to create (term/web/preview/edit/agent) [required]")
	blockOpenCmd.Flags().StringVar(&blockTab, "tab", "", "target tab: active | new | <tabid> (default active)")
	blockOpenCmd.Flags().StringVar(&blockWsId, "workspace", "", "workspace when --tab new")
	blockOpenCmd.Flags().StringVar(&blockSplit, "split", "", "split direction (right|down|left|up)")
	blockOpenCmd.Flags().StringVar(&blockReplace, "replace", "", "replace an existing block")
	blockOpenCmd.Flags().BoolVar(&blockMagnify, "magnified", false, "open magnified")
	blockOpenCmd.Flags().BoolVar(&blockNoFocus, "no-focus", false, "do not focus the new block")
	blockOpenCmd.Flags().BoolVar(&blockWait, "wait", false, "wait until the block is reflected in the tab")
	blockOpenCmd.Flags().IntVar(&blockWaitMs, "wait-ms", 0, "wait budget (default 5000)")
	blockOpenCmd.Flags().BoolVar(&blockDedupe, "dedupe", false, "return an identical existing block if present")
	blockOpenCmd.Flags().StringVar(&blockUrl, "url", "", "meta.url for web blocks")
	blockOpenCmd.Flags().StringVar(&blockFile, "file", "", "meta.file for preview/edit blocks")
	blockOpenCmd.Flags().StringVar(&blockCwd, "cwd", "", "meta.cmd:cwd for term blocks")
	blockOpenCmd.Flags().StringVar(&blockConn, "conn", "", "meta.connection")
	blockOpenCmd.Flags().StringArrayVar(&blockMetaSets, "meta", nil, "extra meta key=value (repeatable)")

	rootCmd.AddCommand(blockCmd)
}

func blockRpcOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Timeout: blockTimeout}
}

func blockReadRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("block read", rtnErr == nil) }()
	blockId := args[0]
	if blockId == "this" {
		blockId = strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID"))
		if blockId == "" {
			return fmt.Errorf("no WAVETERM_BLOCKID and argument is 'this'")
		}
	}
	res, err := wshclient.BlockReadCommand(RpcClient, wshrpc.BlockReadRequest{
		BlockId:     blockId,
		Tail:        blockTail,
		MaxBytes:    blockMaxBytes,
		LastCommand: blockLastCmd,
	}, blockRpcOpts())
	if err != nil {
		return err
	}
	if blockJSON {
		return blockWriteJSON(res)
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "block\t%s view=%s\n", res.BlockId, res.View)
	if res.Payload["error"] != nil {
		fmt.Fprintf(w, "error\t%s\n", res.Payload["error"])
	}
	if lines, ok := res.Payload["lines"].(string); ok {
		fmt.Fprintln(w, "--- content (tail) ---")
		fmt.Fprintln(w, lines)
		if tot, ok := res.Payload["totallines"].(int); ok {
			fmt.Fprintf(w, "--- %d total lines ---\n", tot)
		}
	} else if content, ok := res.Payload["content"].(string); ok {
		fmt.Fprintln(w, "--- content ---")
		fmt.Fprintln(w, content)
	} else if url, ok := res.Payload["url"].(string); ok {
		fmt.Fprintf(w, "url\t%s\n", url)
	}
	if res.Truncated {
		fmt.Fprintln(w, "(truncated)")
	}
	for _, warn := range res.Warnings {
		fmt.Fprintf(w, "warning: %s\n", warn)
	}
	return nil
}

func blockOpenRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("block open", rtnErr == nil) }()
	if strings.TrimSpace(blockView) == "" {
		return fmt.Errorf("--view is required")
	}
	meta := waveobj.MetaMapType{}
	if blockUrl != "" {
		meta[waveobj.MetaKey_Url] = blockUrl
	}
	if blockFile != "" {
		meta[waveobj.MetaKey_File] = blockFile
	}
	if blockCwd != "" {
		meta[waveobj.MetaKey_CmdCwd] = blockCwd
	}
	if blockConn != "" {
		meta[waveobj.MetaKey_Connection] = blockConn
	}
	parsed, err := parseMetaSets(blockMetaSets)
	if err != nil {
		return err
	}
	for k, v := range parsed {
		meta[k] = v
	}

	res, err := wshclient.BlockOpenCommand(RpcClient, wshrpc.BlockOpenRequest{
		View:        blockView,
		Tab:         blockTab,
		WorkspaceId: blockWsId,
		Split:       blockSplit,
		Replace:     blockReplace,
		Magnified:   blockMagnify,
		NoFocus:     blockNoFocus,
		Wait:        blockWait,
		WaitMs:      blockWaitMs,
		Dedupe:      blockDedupe,
		Meta:        meta,
	}, blockRpcOpts())
	if err != nil {
		return err
	}
	if blockJSON {
		return blockWriteJSON(res)
	}
	fmt.Fprintf(os.Stdout, "block\t%s\n", res.BlockId)
	if res.Deduped {
		fmt.Fprintln(os.Stdout, "deduped\ttrue")
	}
	if res.TabId != "" {
		fmt.Fprintf(os.Stdout, "tab\t%s\n", res.TabId)
	}
	if res.SyncState != "" {
		fmt.Fprintf(os.Stdout, "syncstate\t%s\n", res.SyncState)
	}
	for _, warn := range res.Warnings {
		fmt.Fprintf(os.Stdout, "warning\t%s\n", warn)
	}
	return nil
}

func blockWriteJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}
