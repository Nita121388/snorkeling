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

	sessionUsersLimit  int
	sessionBeforeSeq   int
	sessionTurnsLimit  int
	sessionBeforeTurn  int
	sessionTurnNumber  int
	sessionTurnChars   int
	sessionReadRefresh bool

	sessionAnnotateAnchor       string
	sessionAnnotateKind         string
	sessionAnnotateTitle        string
	sessionAnnotateBody         string
	sessionAnnotateTags         []string
	sessionAnnotateStatus       string
	sessionAnnotateForce        bool
	sessionAnnotateExpectedHash string
	sessionAnnotateDryRun       bool
	sessionAnnotateYes          bool
	sessionAnnotateAIModel      string

	sessionMarkBlock  string
	sessionMarkUnmark bool
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

var sessionInfoCmd = &cobra.Command{
	Use:     "info <sessionKey|sessionId>",
	Short:   "Probe one session's size (counts/bytes/verdict) before reading it",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionInfoRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionUsersCmd = &cobra.Command{
	Use:     "users <sessionKey|sessionId>",
	Short:   "Read one page of user prompts (120 chars each)",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionUsersRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionTurnsCmd = &cobra.Command{
	Use:     "turns <sessionKey|sessionId> --limit N",
	Short:   "Read one page of turn summaries (limit is required, 1-10)",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionTurnsRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionTurnCmd = &cobra.Command{
	Use:     "turn <sessionKey|sessionId> --turn N --chars N",
	Short:   "Read one turn's original messages (chars is required, 1-8000)",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionTurnRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionAnnotateCmd = &cobra.Command{
	Use:   "annotate <sessionKey|sessionId|this>",
	Short: "Write one machine annotation draft onto a session timeline node",
	Long: `Write one machine annotation draft (source=ai).

Examples:
  wsh session annotate this --anchor tail --kind milestone --title "阶段推进" --body "..."
  wsh session get this --json                 # read .card.hash
  wsh session annotate this --anchor tail --kind milestone --title "阶段推进" --body "..." \
      --yes --expected-hash <hash>

Writes are dry-run unless --yes, and a real write requires --expected-hash.
Status defaults to draft; --status accepted additionally requires --force.
A repeat write at the same (session, kind, anchor) replaces the previous
machine annotation instead of adding another one. A human-authored or
human-edited annotation is never overwritten.`,
	Args:    cobra.ExactArgs(1),
	RunE:    sessionAnnotateRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionMarkCmd = &cobra.Command{
	Use:   "mark <sessionKey|sessionId|this>",
	Short: "Star (mark) or unstar one session",
	Long: `Star (mark) or unstar one session.

Marked is a boolean view state (the GUI star), not session content: this is the
same Manager.Mark the GUI toggle calls, with no dry-run or hash precondition.
Toggling is idempotent (last write wins).

  wsh session mark <key>                    # star
  wsh session mark <key> --unmark           # unstar
  wsh session list --marked true            # verify`,
	Args:    cobra.ExactArgs(1),
	RunE:    sessionMarkRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	sessionCmd.PersistentFlags().BoolVar(&sessionJSON, "json", false, "output as JSON")
	sessionCmd.PersistentFlags().Int64Var(&sessionTimeoutMs, "timeout", 8000, "RPC timeout in milliseconds")
	sessionCmd.AddCommand(sessionLiveCmd, sessionGetCmd, sessionListCmd, sessionForBlockCmd,
		sessionInfoCmd, sessionUsersCmd, sessionTurnsCmd, sessionTurnCmd, sessionAnnotateCmd, sessionMarkCmd, sessionEmojiCmd)

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

	sessionInfoCmd.Flags().BoolVar(&sessionReadRefresh, "refresh", false, "re-parse this session's messages before probing (single file, no full scan)")

	sessionUsersCmd.Flags().IntVar(&sessionUsersLimit, "limit", 20, "rows per page (max 100)")
	sessionUsersCmd.Flags().IntVar(&sessionBeforeSeq, "before-seq", 0, "cursor: return rows with seq < this (from 'nextBeforeSeq')")
	sessionUsersCmd.Flags().BoolVar(&sessionReadRefresh, "refresh", false, "re-parse this session's messages before reading (single file, no full scan)")

	sessionTurnsCmd.Flags().IntVar(&sessionTurnsLimit, "limit", 0, "rows per page: REQUIRED, 1-10 (run 'session info' first)")
	sessionTurnsCmd.Flags().IntVar(&sessionBeforeTurn, "before-turn", 0, "cursor: return turns with number < this (from 'nextBeforeTurn')")
	sessionTurnsCmd.Flags().BoolVar(&sessionReadRefresh, "refresh", false, "re-parse this session's messages before reading (single file, no full scan)")

	sessionTurnCmd.Flags().IntVar(&sessionTurnNumber, "turn", 0, "turn number (1-based, from 'session turns')")
	sessionTurnCmd.Flags().IntVar(&sessionTurnChars, "chars", 0, "chars budget: REQUIRED, 1-8000")
	sessionTurnCmd.Flags().BoolVar(&sessionReadRefresh, "refresh", false, "re-parse this session's messages before reading (single file, no full scan)")

	sessionAnnotateCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateAnchor, "anchor", "", "anchor: 'tail' or a message itemKey (REQUIRED)")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateKind, "kind", "note", "annotation kind: note | milestone | decision | question")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateTitle, "title", "", "short title")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateBody, "body", "", "body text (truncated at the storage limit)")
	sessionAnnotateCmd.Flags().StringSliceVar(&sessionAnnotateTags, "tags", nil, "comma-separated tags")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateStatus, "status", "draft", "status: draft (default) | accepted (needs --force)")
	sessionAnnotateCmd.Flags().BoolVar(&sessionAnnotateForce, "force", false, "allow --status accepted (a machine never accepts on its own otherwise)")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateExpectedHash, "expected-hash", "", "card hash from 'session get' (required for --yes)")
	sessionAnnotateCmd.Flags().BoolVar(&sessionAnnotateDryRun, "dry-run", false, "preview the resolved anchor and write without writing")
	sessionAnnotateCmd.Flags().BoolVar(&sessionAnnotateYes, "yes", false, "confirm the real write")
	sessionAnnotateCmd.Flags().StringVar(&sessionAnnotateAIModel, "ai-model", "", "model that produced this annotation (stored in ai_model)")

	sessionMarkCmd.Flags().StringVar(&sessionMarkBlock, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	sessionMarkCmd.Flags().BoolVar(&sessionMarkUnmark, "unmark", false, "clear the star instead of setting it")

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

// sessionAgeAt renders a millisecond timestamp as a compact age.
func sessionAgeAt(ts int64) string {
	if ts <= 0 {
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
	if delta < 24*time.Hour {
		return fmt.Sprintf("%dh", int(delta.Hours()))
	}
	return time.UnixMilli(ts).Format("2006-01-02 15:04")
}

func sessionInfoRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session info", rtnErr == nil) }()
	res, err := wshclient.SessionInfoCommand(RpcClient, wshrpc.SessionInfoRequest{
		Identifier: args[0],
		Refresh:    sessionReadRefresh,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	fmt.Fprintf(WrappedStdout, "key:      %s\n", orDash(res.SessionKey))
	fmt.Fprintf(WrappedStdout, "verdict:  %s\n", res.Verdict)
	fmt.Fprintf(WrappedStdout, "messages: %d (%d user)\n", res.MessageCount, res.UserMessageCount)
	fmt.Fprintf(WrappedStdout, "bytes:    %s\n", sessionSizeLabel(res.Bytes))
	if res.LastMessageAt > 0 {
		fmt.Fprintf(WrappedStdout, "last:     %s\n", sessionAgeAt(res.LastMessageAt))
	}
	if res.Stale {
		fmt.Fprintf(WrappedStdout, "warning:  message index is stale; re-run with --refresh to re-index this session\n")
	}
	return nil
}

func sessionSizeLabel(size int64) string {
	switch {
	case size >= 1024*1024:
		return fmt.Sprintf("%d (%.1fMB)", size, float64(size)/(1024*1024))
	case size >= 1024:
		return fmt.Sprintf("%d (%.1fKB)", size, float64(size)/1024)
	default:
		return fmt.Sprintf("%d", size)
	}
}

func sessionUsersRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session users", rtnErr == nil) }()
	res, err := wshclient.SessionUsersCommand(RpcClient, wshrpc.SessionUsersRequest{
		Identifier: args[0],
		Limit:      sessionUsersLimit,
		BeforeSeq:  sessionBeforeSeq,
		Refresh:    sessionReadRefresh,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	if res.Stale {
		fmt.Fprintf(WrappedStdout, "warning: message index is stale; re-run with --refresh to re-index this session\n")
	}
	if len(res.Rows) == 0 {
		if !res.Stale {
			WriteStdout("no user messages\n")
		}
		return nil
	}
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "SEQ\tAGE\tTEXT\n")
	for _, row := range res.Rows {
		text := row.Text
		if row.Truncated {
			text += "…"
		}
		fmt.Fprintf(w, "%d\t%s\t%s\n", row.Seq, sessionAgeAt(row.At), text)
	}
	if res.HasMore {
		fmt.Fprintf(w, "\n(more: pass --before-seq %d)\n", res.NextBeforeSeq)
	}
	return nil
}

func sessionTurnsRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session turns", rtnErr == nil) }()
	if !cmd.Flags().Changed("limit") {
		return fmt.Errorf("E_USAGE: --limit is required (1-10); run 'wsh session info %s' first to size the session", args[0])
	}
	res, err := wshclient.SessionTurnsCommand(RpcClient, wshrpc.SessionTurnsRequest{
		Identifier: args[0],
		Limit:      sessionTurnsLimit,
		BeforeTurn: sessionBeforeTurn,
		Refresh:    sessionReadRefresh,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	if res.Stale {
		fmt.Fprintf(WrappedStdout, "warning: message index is stale; re-run with --refresh to re-index this session\n")
	}
	if len(res.Rows) == 0 {
		if !res.Stale {
			WriteStdout("no turns\n")
		}
		return nil
	}
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "TURN\tSEQ\tAGE\tTOOLS\tCHARS\tMS\tTEXT\n")
	for _, row := range res.Rows {
		text := row.Text
		if row.Truncated {
			text += "…"
		}
		fmt.Fprintf(w, "%d\t%d\t%s\t%d\t%d\t%s\t%s\n", row.Turn, row.Seq, sessionAgeAt(row.At), row.ToolCount, row.Chars, sessionMsLabel(row.Ms), text)
	}
	if res.HasMore {
		fmt.Fprintf(w, "\n(more: pass --before-turn %d)\n", res.NextBeforeTurn)
	}
	return nil
}

func sessionMsLabel(ms int64) string {
	if ms < 0 {
		return "-"
	}
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	seconds := ms / 1000
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	minutes := seconds / 60
	if minutes < 60 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%dh", minutes/60)
}

func sessionTurnRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session turn", rtnErr == nil) }()
	if !cmd.Flags().Changed("chars") {
		return fmt.Errorf("E_USAGE: --chars is required (1-8000); run 'wsh session info %s' first to size the session", args[0])
	}
	res, err := wshclient.SessionTurnCommand(RpcClient, wshrpc.SessionTurnRequest{
		Identifier: args[0],
		Turn:       sessionTurnNumber,
		Chars:      sessionTurnChars,
		Refresh:    sessionReadRefresh,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	if res.Stale {
		fmt.Fprintf(WrappedStdout, "warning: message index is stale; re-run with --refresh to re-index this session\n")
	}
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "SEQ\tROLE\tAGE\tTEXT\n")
	for _, row := range res.Rows {
		text := row.Text
		if row.Truncated {
			text += "…"
		}
		fmt.Fprintf(w, "%d\t%s\t%s\t%s\n", row.Seq, orDash(row.Role), sessionAgeAt(row.At), text)
	}
	fmt.Fprintf(WrappedStdout, "\nturn %d: %d chars total%s\n", res.Turn, res.TotalChars, boolMark(res.Truncated, ", truncated to fit --chars"))
	return nil
}

func boolMark(flag bool, label string) string {
	if flag {
		return label
	}
	return ""
}

func sessionAnnotateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session annotate", rtnErr == nil) }()
	if !cmd.Flags().Changed("anchor") {
		return fmt.Errorf("E_USAGE: --anchor is required ('tail' or a message itemKey from 'wsh session turn')")
	}
	req := wshrpc.SessionAnnotateRequest{
		Identifier:   args[0],
		BlockId:      sessionBlockArg(sessionBlockId),
		Anchor:       sessionAnnotateAnchor,
		Kind:         sessionAnnotateKind,
		Title:        sessionAnnotateTitle,
		Body:         sessionAnnotateBody,
		Tags:         sessionAnnotateTags,
		Status:       sessionAnnotateStatus,
		Force:        sessionAnnotateForce,
		ExpectedHash: strings.TrimSpace(sessionAnnotateExpectedHash),
		DryRun:       sessionAnnotateDryRun,
		Yes:          sessionAnnotateYes && !sessionAnnotateDryRun,
		AIModel:      strings.TrimSpace(sessionAnnotateAIModel),
	}
	res, err := wshclient.SessionAnnotateCommand(RpcClient, req, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	action := "wrote"
	if res.DryRun {
		action = "would write"
	}
	fmt.Fprintf(WrappedStdout, "%s · %s [%s] · anchor %s (seq %d)\n", action, res.Row.Kind, res.Row.Status, res.Preview.AnchorKey, res.Preview.Seq)
	if res.Preview.AnchorPreview != "" {
		fmt.Fprintf(WrappedStdout, "anchor text: %s\n", res.Preview.AnchorPreview)
	}
	if res.DryRun {
		fmt.Fprintf(WrappedStdout, "dry-run: nothing was written; re-run with --yes --expected-hash <hash from 'session get'>\n")
	} else {
		if res.Created {
			fmt.Fprintf(WrappedStdout, "written: id=%d\n", res.Row.ID)
		} else {
			fmt.Fprintf(WrappedStdout, "written: id=%d (replaced id=%d)\n", res.Row.ID, res.Preview.ReplacedID)
		}
	}
	return nil
}

func sessionMarkRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("session mark", rtnErr == nil) }()
	res, err := wshclient.SessionMarkCommand(RpcClient, wshrpc.SessionMarkRequest{
		Identifier: args[0],
		BlockId:    sessionBlockArg(sessionMarkBlock),
		Marked:     !sessionMarkUnmark,
	}, sessionRpcOpts())
	if err != nil {
		return err
	}
	if sessionJSON {
		return writeJSON(res)
	}
	state := "unmarked"
	if res.Marked {
		state = "marked"
	}
	WriteStdout("%s\t%s\n", res.SessionKey, state)
	if res.Title != "" {
		WriteStdout("title\t%s\n", res.Title)
	}
	return nil
}

var (
	sessionEmojiValue        string
	sessionEmojiIfAbsent     bool
	sessionEmojiForce        bool
	sessionEmojiExpectedHash string
	sessionEmojiYes          bool
	sessionEmojiInjectedBy   string
	sessionEmojiCandidates   []string
	sessionEmojiTTLSeconds   int64
)

var sessionEmojiCmd = &cobra.Command{
	Use:   "emoji",
	Short: "Session emoji: read/write the backend emoji prop and manage external recommendations",
	Long: `Read and write the backend session emoji (ai_session_props prop_key='emoji')
and manage externally injected recommendations (design §8.2: 所有推荐来源都是
外部 agent，内部只展示).

  wsh session emoji get             <key|id|this>           # {emoji, source, updatedAt}
  wsh session emoji set             <key|id|this> --emoji X [--if-absent] [--force] [--expected-hash H] [--yes]
  wsh session emoji inject          <key|id|this> --injected-by hero:watchdog --candidate "🛡:reason" [--ttl-seconds 600]
  wsh session emoji recommendations <key|id|this>          # read injected payload
  wsh session emoji prefs           <key|id|this>           # preference buckets

Rules: a user-authored emoji is never overwritten by this channel (--force
overrides, humans only); --if-absent makes an existing slot an idempotent
no-op; empty candidates in inject clears the recommendation section.`,
}

var sessionEmojiGetCmd = &cobra.Command{
	Use:     "get <sessionKey|sessionId|this>",
	Short:   "Read the backend emoji prop of one session",
	Example: "wsh session emoji get this --json",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionEmojiGetRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionEmojiSetCmd = &cobra.Command{
	Use:   "set <sessionKey|sessionId|this> --emoji <e>",
	Short: "Write the session emoji (agent channel, source=ai)",
	Long: `Write the session emoji through the agent channel (source=ai always).

  wsh session emoji set this --emoji 🐛 --if-absent --yes

A user-authored value is skipped (skipped: "emoji: user-authored value")
unless --force. --if-absent makes an existing slot an idempotent no-op
(skipped: "emoji: exists (--if-absent)") and doubles as the concurrency
precondition for a real write. Without --if-absent a real write requires
--expected-hash. Writes are dry-run unless --yes.`,
	Example: "wsh session emoji set this --emoji 🐛 --if-absent --yes",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionEmojiSetRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionEmojiInjectCmd = &cobra.Command{
	Use:   "inject <sessionKey|sessionId|this>",
	Short: "Push live emoji recommendations from an external agent",
	Long: `Push an external agent's live recommendations for one session, replacing any
previous injection wholesale (design §8.2). Candidates are "emoji[:reason]"
strings; each is validated (one invalid rejects the whole injection) and the
list is capped at 8. Empty candidates clears the section (the picker then
hides it). --ttl-seconds expires the injection; omit for no expiry.`,
	Example: "wsh session emoji inject this --injected-by hero:watchdog --candidate '🛡:在修 wavesrv OOM' --candidate 🐛 --ttl-seconds 600",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionEmojiInjectRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionEmojiRecommendationsCmd = &cobra.Command{
	Use:     "recommendations <sessionKey|sessionId|this>",
	Short:   "Read the injected recommendation payload of one session",
	Example: "wsh session emoji recommendations this --json",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionEmojiRecommendationsRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionEmojiPrefsCmd = &cobra.Command{
	Use:     "prefs <sessionKey|sessionId|this>",
	Short:   "Read the emoji preference buckets an external recommender can consult",
	Example: "wsh session emoji prefs this --json",
	Args:    cobra.ExactArgs(1),
	RunE:    sessionEmojiPrefsRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	sessionEmojiCmd.AddCommand(sessionEmojiGetCmd, sessionEmojiSetCmd, sessionEmojiInjectCmd,
		sessionEmojiRecommendationsCmd, sessionEmojiPrefsCmd)

	sessionEmojiGetCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")

	sessionEmojiSetCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	sessionEmojiSetCmd.Flags().StringVar(&sessionEmojiValue, "emoji", "", "the single emoji grapheme to write (REQUIRED)")
	sessionEmojiSetCmd.Flags().BoolVar(&sessionEmojiIfAbsent, "if-absent", false, "skip when the slot already holds a value (idempotent; doubles as the precondition for --yes)")
	sessionEmojiSetCmd.Flags().BoolVar(&sessionEmojiForce, "force", false, "overwrite even a user-authored emoji (humans only)")
	sessionEmojiSetCmd.Flags().StringVar(&sessionEmojiExpectedHash, "expected-hash", "", "card hash from 'session emoji get'/'session get' (required for --yes without --if-absent)")
	sessionEmojiSetCmd.Flags().BoolVar(&sessionEmojiYes, "yes", false, "confirm the real write (otherwise dry-run)")

	sessionEmojiInjectCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	sessionEmojiInjectCmd.Flags().StringVar(&sessionEmojiInjectedBy, "injected-by", "", "identify the recommending agent (REQUIRED, e.g. hero:watchdog)")
	sessionEmojiInjectCmd.Flags().StringSliceVar(&sessionEmojiCandidates, "candidate", nil, "emoji[:reason] to recommend; repeatable")
	sessionEmojiInjectCmd.Flags().Int64Var(&sessionEmojiTTLSeconds, "ttl-seconds", 0, "expire the injection after N seconds (0 = no expiry)")

	sessionEmojiRecommendationsCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	sessionEmojiPrefsCmd.Flags().StringVar(&sessionBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
}

// sessionEmojiRenderError surfaces the stable control-surface codes. In --json
// mode the error is also printed as a structured object on stdout; the process
// still exits non-zero (the returned error) so agents can branch on either.
func sessionEmojiRenderError(err error) error {
	if err == nil {
		return nil
	}
	if sessionJSON {
		code, message := splitEmojiError(err.Error())
		_ = writeJSON(map[string]any{"error": map[string]any{"code": code, "message": message}})
	}
	return err
}

func splitEmojiError(message string) (string, string) {
	message = strings.TrimSpace(message)
	if strings.HasPrefix(message, "E_") {
		if idx := strings.Index(message, ": "); idx > 0 {
			return message[:idx], strings.TrimSpace(message[idx+2:])
		}
	}
	return "", message
}

func sessionEmojiGetRun(cmd *cobra.Command, args []string) error {
	result, err := wshclient.SessionEmojiGetCommand(RpcClient, wshrpc.SessionEmojiGetRequest{
		Identifier: args[0],
		BlockId:    sessionBlockArg(sessionBlockId),
	}, sessionRpcOpts())
	if err != nil {
		return sessionEmojiRenderError(err)
	}
	if sessionJSON {
		return writeJSON(result)
	}
	emoji := result.Emoji
	if emoji == "" {
		emoji = "-"
	}
	fmt.Fprintf(WrappedStdout, "id:      %s\n", orDash(result.ID))
	fmt.Fprintf(WrappedStdout, "key:     %s\n", orDash(result.SessionKey))
	fmt.Fprintf(WrappedStdout, "emoji:   %s\n", emoji)
	fmt.Fprintf(WrappedStdout, "source:  %s\n", orDash(result.Source))
	if result.UpdatedAt > 0 {
		fmt.Fprintf(WrappedStdout, "updated: %s\n", time.UnixMilli(result.UpdatedAt).Format(time.RFC3339))
	}
	return nil
}

func sessionEmojiSetRun(cmd *cobra.Command, args []string) error {
	if strings.TrimSpace(sessionEmojiValue) == "" {
		return fmt.Errorf("--emoji is required")
	}
	result, err := wshclient.SessionEmojiSetCommand(RpcClient, wshrpc.SessionEmojiSetRequest{
		Identifier:   args[0],
		BlockId:      sessionBlockArg(sessionBlockId),
		Emoji:        sessionEmojiValue,
		IfAbsent:     sessionEmojiIfAbsent,
		Force:        sessionEmojiForce,
		ExpectedHash: sessionEmojiExpectedHash,
		DryRun:       !sessionEmojiYes,
		Yes:          sessionEmojiYes,
	}, sessionRpcOpts())
	if err != nil {
		return sessionEmojiRenderError(err)
	}
	if sessionJSON {
		return writeJSON(result)
	}
	if result.DryRun {
		fmt.Fprintf(WrappedStdout, "dry-run: changed=%v", result.Changed)
		if len(result.Skipped) > 0 {
			fmt.Fprintf(WrappedStdout, " skipped=[%s]", strings.Join(result.Skipped, ", "))
		}
		fmt.Fprintf(WrappedStdout, "\n(re-run with --yes to write)\n")
		return nil
	}
	if result.Changed {
		fmt.Fprintf(WrappedStdout, "written: emoji = %s (source=ai)\n", sessionEmojiValue)
	} else {
		fmt.Fprintf(WrappedStdout, "skipped: %s\n", strings.Join(result.Skipped, ", "))
	}
	return nil
}

func sessionEmojiInjectRun(cmd *cobra.Command, args []string) error {
	if strings.TrimSpace(sessionEmojiInjectedBy) == "" {
		return fmt.Errorf("--injected-by is required")
	}
	candidates := make([]wshrpc.SessionEmojiRecommendation, 0, len(sessionEmojiCandidates))
	for _, raw := range sessionEmojiCandidates {
		emojiPart := raw
		reasonPart := ""
		if idx := strings.Index(raw, ":"); idx > 0 {
			emojiPart, reasonPart = raw[:idx], raw[idx+1:]
		}
		candidates = append(candidates, wshrpc.SessionEmojiRecommendation{Emoji: emojiPart, Reason: reasonPart})
	}
	result, err := wshclient.SessionEmojiInjectCommand(RpcClient, wshrpc.SessionEmojiInjectRequest{
		Identifier: args[0],
		BlockId:    sessionBlockArg(sessionBlockId),
		InjectedBy: sessionEmojiInjectedBy,
		Candidates: candidates,
		TTLSeconds: sessionEmojiTTLSeconds,
	}, sessionRpcOpts())
	if err != nil {
		return sessionEmojiRenderError(err)
	}
	if sessionJSON {
		return writeJSON(result)
	}
	if len(candidates) == 0 {
		fmt.Fprintf(WrappedStdout, "cleared: recommendations for %s\n", orDash(result.SessionKey))
	} else {
		fmt.Fprintf(WrappedStdout, "injected: %d candidate(s) for %s (by %s)\n", result.Candidates, orDash(result.SessionKey), sessionEmojiInjectedBy)
		if len(candidates) > result.Candidates {
			fmt.Fprintf(WrappedStdout, "note: %d candidate(s) dropped (invalid or over the cap)\n", len(candidates)-result.Candidates)
		}
	}
	return nil
}

func sessionEmojiRecommendationsRun(cmd *cobra.Command, args []string) error {
	result, err := wshclient.SessionEmojiRecommendationsCommand(RpcClient, wshrpc.SessionEmojiRecommendationsRequest{
		Identifier: args[0],
		BlockId:    sessionBlockArg(sessionBlockId),
	}, sessionRpcOpts())
	if err != nil {
		return sessionEmojiRenderError(err)
	}
	if sessionJSON {
		return writeJSON(result)
	}
	if !result.Found || len(result.Candidates) == 0 {
		fmt.Fprintln(WrappedStdout, "no recommendations (inject first, or the payload expired)")
		return nil
	}
	fmt.Fprintf(WrappedStdout, "session:  %s\n", orDash(result.SessionKey))
	fmt.Fprintf(WrappedStdout, "injected: %s (%s)\n", orDash(result.InjectedBy), time.UnixMilli(result.InjectedAt).Format(time.RFC3339))
	if result.ExpiresAt > 0 {
		fmt.Fprintf(WrappedStdout, "expires:  %s\n", time.UnixMilli(result.ExpiresAt).Format(time.RFC3339))
	}
	for idx, candidate := range result.Candidates {
		if candidate.Reason != "" {
			fmt.Fprintf(WrappedStdout, "%d. %-2s %s\n", idx+1, candidate.Emoji, candidate.Reason)
		} else {
			fmt.Fprintf(WrappedStdout, "%d. %s\n", idx+1, candidate.Emoji)
		}
	}
	return nil
}

func sessionEmojiPrefsRun(cmd *cobra.Command, args []string) error {
	result, err := wshclient.SessionEmojiPrefsCommand(RpcClient, wshrpc.SessionEmojiPrefsRequest{
		Identifier: args[0],
		BlockId:    sessionBlockArg(sessionBlockId),
	}, sessionRpcOpts())
	if err != nil {
		return sessionEmojiRenderError(err)
	}
	if sessionJSON {
		return writeJSON(result)
	}
	fmt.Fprintf(WrappedStdout, "session:    %s\n", orDash(result.SessionKey))
	fmt.Fprintf(WrappedStdout, "prefVersion:%d\n", result.PrefVersion)
	dumpPrefs := func(label string, values map[string]int) {
		if len(values) == 0 {
			fmt.Fprintf(WrappedStdout, "%s: (none)\n", label)
			return
		}
		parts := make([]string, 0, len(values))
		for emoji, count := range values {
			parts = append(parts, fmt.Sprintf("%s=%d", emoji, count))
		}
		fmt.Fprintf(WrappedStdout, "%s: %s\n", label, strings.Join(parts, ", "))
	}
	dumpPrefs("project", result.Project)
	dumpPrefs("persona", result.Persona)
	dumpPrefs("global", result.Global)
	return nil
}
