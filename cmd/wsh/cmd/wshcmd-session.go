// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	sessionJSON        bool
	sessionIncludeIdle bool
	sessionMaxRows     int
	sessionBlockId     string
	sessionSource      string
	sessionQuery       string
	sessionTag         string
	sessionProject     string
	sessionMarked      string
	sessionLimit       int
	sessionTimeoutMs   int64
)

var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Inspect AI agent sessions (live and indexed)",
}

var sessionLiveCmd = &cobra.Command{
	Use:     "live",
	Short:   "List live agent sessions across blocks and GUI chats",
	Args:    cobra.NoArgs,
	RunE:    sessionLiveRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionGetCmd = &cobra.Command{
	Use:     "get <sessionKey|sessionId|this>",
	Short:   "Show one session record (live state + card summary)",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionGetRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionListCmd = &cobra.Command{
	Use:     "list",
	Short:   "List indexed AI sessions with filters",
	Args:    cobra.NoArgs,
	RunE:    sessionListRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionForBlockCmd = &cobra.Command{
	Use:     "for-block [blockid|this]",
	Short:   "Resolve the agent session bound to a block",
	Args:    cobra.MaximumNArgs(1),
	RunE:    sessionForBlockRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	sessionCmd.PersistentFlags().BoolVar(&sessionJSON, "json", false, "output as JSON")
	sessionCmd.PersistentFlags().Int64Var(&sessionTimeoutMs, "timeout", 8000, "RPC timeout in milliseconds")
	sessionCmd.AddCommand(sessionLiveCmd, sessionGetCmd, sessionListCmd, sessionForBlockCmd)

	sessionLiveCmd.Flags().BoolVar(&sessionIncludeIdle, "include-idle", false, "include idle sessions")
	sessionLiveCmd.Flags().IntVar(&sessionMaxRows, "max-rows", 200, "maximum rows to return")

	sessionGetCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")

	sessionListCmd.Flags().StringVar(&sessionSource, "source", "", "filter by agent source (pi/codex/claude/opencode/gemini)")
	sessionListCmd.Flags().StringVar(&sessionQuery, "query", "", "free-text query")
	sessionListCmd.Flags().StringVar(&sessionTag, "tag", "", "filter by tag")
	sessionListCmd.Flags().StringVar(&sessionProject, "project", "", "filter by project path prefix")
	sessionListCmd.Flags().StringVar(&sessionMarked, "marked", "", "filter by marked state (true/false)")
	sessionListCmd.Flags().IntVar(&sessionLimit, "limit", 20, "maximum rows")

	sessionForBlockCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id (defaults to WAVETERM_BLOCKID)")

	rootCmd.AddCommand(sessionCmd)
}

func sessionRpcOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Timeout: sessionTimeoutMs}
}

func sessionBlockArg(flagValue string) string {
	if strings.TrimSpace(flagValue) != "" {
		return strings.TrimSpace(flagValue)
	}
	return strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID"))
}

func sessionLiveRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session live", rtnErr == nil) }()
	res, err := wshclient.SessionLiveCommand(RpcClient, wshrpc.SessionLiveRequest{
		IncludeIdle: sessionIncludeIdle,
		MaxRows:     sessionMaxRows,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	if len(res.Records) == 0 {
		WriteStdout("no live sessions\n")
		return nil
	}
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "BLOCK\tPROVIDER\tSTATE\tPHASE\tTITLE\tAGE\n")
	for _, rec := range res.Records {
		state, phase := "-", "-"
		if rec.Issue != nil {
			state = rec.Issue.State
			if rec.Issue.Phase != "" {
				phase = rec.Issue.Phase
			}
			if rec.Issue.Freshness == "stale" {
				state += "(stale)"
			}
		}
		if rec.Chat != nil {
			state = rec.Chat.State
		}
		blockId := rec.BlockId
		if blockId == "" {
			blockId = "<chat>"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
			shortId(blockId), orDash(rec.Provider), state, phase, orDash(rec.Title), sessionAge(rec))
	}
	if res.Partial {
		fmt.Fprintf(w, "\n(partial: row limit reached)\n")
	}
	return nil
}

func sessionGetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session get", rtnErr == nil) }()
	rec, err := wshclient.SessionGetCommand(RpcClient, wshrpc.SessionGetRequest{
		Identifier: args[0],
		BlockId:    sessionBlockArg(sessionBlockId),
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(rec)
	}
	fmt.Fprintf(WrappedStdout, "id:      %s\n", orDash(rec.SessionId))
	fmt.Fprintf(WrappedStdout, "key:     %s\n", orDash(rec.SessionKey))
	fmt.Fprintf(WrappedStdout, "provider:%s\n", orDash(rec.Provider))
	fmt.Fprintf(WrappedStdout, "title:   %s\n", orDash(rec.Title))
	if rec.Issue != nil {
		fmt.Fprintf(WrappedStdout, "state:   %s (%s, %s)\n", rec.Issue.State, rec.Issue.Freshness, orDash(rec.Issue.Phase))
		if rec.Issue.Message != "" {
			fmt.Fprintf(WrappedStdout, "message: %s\n", rec.Issue.Message)
		}
	}
	if rec.Chat != nil {
		fmt.Fprintf(WrappedStdout, "chat:    %s\n", rec.Chat.State)
	}
	if rec.Card != nil {
		fmt.Fprintf(WrappedStdout, "note:    %s\n", orDash(rec.Card.Note))
		fmt.Fprintf(WrappedStdout, "tags:    %s\n", orDash(strings.Join(rec.Card.Tags, ",")))
	}
	for _, warning := range rec.Warnings {
		fmt.Fprintf(WrappedStdout, "warning: %s\n", warning)
	}
	return nil
}

func sessionListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session list", rtnErr == nil) }()
	res, err := wshclient.SessionListCommand(RpcClient, wshrpc.SessionListRequest{
		Source:  sessionSource,
		Query:   sessionQuery,
		Tag:     sessionTag,
		Project: sessionProject,
		Marked:  sessionMarked,
		Limit:   sessionLimit,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	if len(res.Records) == 0 {
		WriteStdout("no sessions found\n")
		return nil
	}
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "SOURCE\tID\tTITLE\tNOTE\tAGE\n")
	for _, rec := range res.Records {
		note := ""
		if rec.Card != nil {
			note = rec.Card.Note
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
			orDash(rec.Provider), shortId(rec.SessionId), orDash(rec.Title), orDash(note), sessionAge(rec))
	}
	return nil
}

func sessionForBlockRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session for-block", rtnErr == nil) }()
	blockId := sessionBlockArg(sessionBlockId)
	if len(args) > 0 && args[0] != "this" {
		blockId = args[0]
	}
	rec, err := wshclient.SessionGetCommand(RpcClient, wshrpc.SessionGetRequest{
		Identifier: "this",
		BlockId:    blockId,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(rec)
	}
	fmt.Fprintf(WrappedStdout, "block:   %s\n", orDash(rec.BlockId))
	fmt.Fprintf(WrappedStdout, "session: %s\n", orDash(rec.SessionId))
	fmt.Fprintf(WrappedStdout, "key:     %s\n", orDash(rec.SessionKey))
	fmt.Fprintf(WrappedStdout, "title:   %s\n", orDash(rec.Title))
	return nil
}

func writeJSON(value any) error {
	barr, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding json: %w", err)
	}
	WriteStdout("%s\n", string(barr))
	return nil
}

func shortId(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func sessionAge(rec wshrpc.SessionLiveRecord) string {
	var ts int64
	if rec.Issue != nil {
		ts = rec.Issue.UpdatedAt
	}
	if rec.Chat != nil && rec.Chat.LastUsedAt > ts {
		ts = rec.Chat.LastUsedAt
	}
	if ts == 0 {
		return "-"
	}
	delta := time.Since(time.UnixMilli(ts))
	if delta < 0 {
		delta = 0
	}
	if delta < time.Minute {
		return fmt.Sprintf("%ds", int(delta.Seconds()))
	}
	if delta < time.Hour {
		return fmt.Sprintf("%dm", int(delta.Minutes()))
	}
	return fmt.Sprintf("%dh", int(delta.Hours()))
}
