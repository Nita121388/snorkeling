// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// BlockRefreshDefaultKey 与前端 folder-index-meta.ts 的 IDX_REFRESH_META_KEY 保持一致。
// 改一边必须改另一边（前端 hook 按 meta 值变化判定需要重算装饰）。
const BlockRefreshDefaultKey = "preview:idxrefresh"

var (
	blockRefreshKey   string
	blockRefreshValue string
)

var blockRefreshCmd = &cobra.Command{
	Use:   "refresh [<block|this>]",
	Short: "Bump a block's refresh marker so it re-reads its source (Files tree: index.md + .index/badges.js)",
	Long: `Bump a block-level refresh marker by writing block meta.

For Files/preview blocks with folder index badges enabled, this makes the tree
re-read <root>/index.md and <root>/.index/badges.js and recompute badges.
Use it after you rewrite the index document or the badges script, so the user
sees the new result without touching the tree.

The default key is preview:idxrefresh and the default value is the current
epoch in milliseconds; pass --key/--value to bump a different marker.
Writing meta is the whole mechanism: no new RPC, no new event type.`,
	Args:    cobra.MaximumNArgs(1),
	RunE:    blockRefreshRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	blockRefreshCmd.Flags().StringVar(&blockRefreshKey, "key", BlockRefreshDefaultKey, "meta key to bump")
	blockRefreshCmd.Flags().StringVar(&blockRefreshValue, "value", "", "explicit meta value (default: current epoch ms)")
}

type blockRefreshResult struct {
	BlockId string `json:"blockid"`
	Key     string `json:"key"`
	Value   string `json:"value"`
}

func blockRefreshRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("block refresh", rtnErr == nil) }()
	target := "this"
	if len(args) > 0 && strings.TrimSpace(args[0]) != "" {
		target = strings.TrimSpace(args[0])
	}
	var oref *waveobj.ORef
	if target == "this" {
		blockId := strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID"))
		if blockId == "" {
			return fmt.Errorf("no WAVETERM_BLOCKID and argument is 'this'")
		}
		orefVal := waveobj.MakeORef("block", blockId)
		oref = &orefVal
	} else {
		resolved, err := resolveSimpleId(target)
		if err != nil {
			return fmt.Errorf("resolving block: %w", err)
		}
		if resolved.OType != waveobj.OType_Block {
			return fmt.Errorf("block refresh target must be a block (got %q)", resolved.OType)
		}
		oref = resolved
	}
	key := strings.TrimSpace(blockRefreshKey)
	if key == "" {
		key = BlockRefreshDefaultKey
	}
	value := strings.TrimSpace(blockRefreshValue)
	if value == "" {
		value = strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	err := wshclient.SetMetaCommand(
		RpcClient,
		wshrpc.CommandSetMetaData{ORef: *oref, Meta: waveobj.MetaMapType{key: value}},
		&wshrpc.RpcOpts{Timeout: blockTimeout},
	)
	if err != nil {
		return fmt.Errorf("writing refresh marker: %w", err)
	}
	result := blockRefreshResult{BlockId: oref.OID, Key: key, Value: value}
	if blockJSON {
		out, err := json.Marshal(result)
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf("block %s refreshed (%s=%s)\n", result.BlockId, result.Key, result.Value)
	return nil
}
