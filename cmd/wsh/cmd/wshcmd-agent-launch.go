// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	agentLaunchProfile   string
	agentLaunchModel     string
	agentLaunchTab       string
	agentLaunchWsId      string
	agentLaunchSplit     string
	agentLaunchCwd       string
	agentLaunchConn      string
	agentLaunchMagnified bool
	agentLaunchNoFocus   bool
	agentLaunchWait      bool
	agentLaunchWaitMs    int
	agentLaunchSend      string
	agentLaunchSendStdin bool
	agentLaunchJSON      bool
	agentLaunchHeadless  bool

	agentSendBlock         string
	agentSendText          string
	agentSendStdin         bool
	agentSendNoSubmit      bool
	agentSendNoWait        bool
	agentSendWaitMs        int
	agentSendQuietMs       int
	agentSendSubmitDelayMs int
	agentSendJSON          bool
	agentSendAsync         bool
	agentSendWaitReply     bool
	agentSendReplyWaitMs   int
	agentSendReplyChars    int
	agentSendReplyPollMs   int
)

var agentLaunchCmd = &cobra.Command{
	Use:   "launch",
	Short: "Launch a TUI agent block from the agent catalog",
	Long: `Launch a TUI agent block (term block + agent:* meta) from the agent catalog.

Only catalog profiles and models are legal: the caller picks an agent and
optionally a model, never a raw command, args or env. The block is created
through the same path the GUI "New Agent" flow uses, so the frontend sees the
same events and the block is an ordinary, visible block in the target tab.

  wsh agent list --json                       # discover profiles/models first
  wsh agent launch --profile pi --wait --json
  wsh agent launch --profile claude --model claude-sonnet-4 --tab new
  wsh agent launch --profile pi --cwd ~/proj --send "summarize this repo" --json`,
	RunE:    agentLaunchRun,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
}

var agentSendCmd = &cobra.Command{
	Use:   "send",
	Short: "Send text to an existing term/agent block",
	Long: `Send text to an existing term/agent block.

The text is written into the block's PTY with a bracketed paste (so multi-line
text stays one paste) and then submitted with a real Enter. The command waits
for the TUI to stop producing output first, so text does not land while a
screen is still painting.

--wait-reply turns send into a roundtrip: after the paste is submitted the
command blocks until the target agent's turn completes and returns the reply
summary. A finished turn is detected by three signals together (agent status,
session file growth, turn count), so a half-written or half-read reply cannot
be mistaken for a done turn. A timeout is not an error: replied=false plus a
"reply-timeout" warning, exit code 0 — the send itself succeeded.

  wsh agent send --block this --text "run the tests"
  printf 'line1\nline2' | wsh agent send --block <id> --stdin
  wsh agent send --block <id> --text "draft only" --no-submit
  wsh agent send --block <id> --text "reply with exactly: OK" --wait-reply --json
  wsh agent send --block <id> --text "go on" --no-wait --json   # later: session turns --limit 1`,
	RunE:    agentSendRun,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	agentLaunchCmd.Flags().StringVar(&agentLaunchProfile, "profile", "", "agent profile from the catalog (required)")
	agentLaunchCmd.Flags().StringVar(&agentLaunchModel, "model", "", "model id or provider/id (default: profile default)")
	agentLaunchCmd.Flags().StringVar(&agentLaunchTab, "tab", "active", "active | new | <tabid>")
	agentLaunchCmd.Flags().StringVar(&agentLaunchWsId, "workspace", "", "workspace id (only with --tab new)")
	agentLaunchCmd.Flags().StringVar(&agentLaunchSplit, "split", "", "right|down|left|up")
	agentLaunchCmd.Flags().StringVar(&agentLaunchCwd, "cwd", "", "block working directory")
	agentLaunchCmd.Flags().StringVar(&agentLaunchConn, "conn", "", "connection name (local only)")
	agentLaunchCmd.Flags().BoolVar(&agentLaunchMagnified, "magnified", false, "open the block magnified")
	agentLaunchCmd.Flags().BoolVar(&agentLaunchNoFocus, "no-focus", false, "do not focus the new block")
	agentLaunchCmd.Flags().BoolVar(&agentLaunchWait, "wait", false, "wait until the frontend applied the layout")
	agentLaunchCmd.Flags().IntVar(&agentLaunchWaitMs, "wait-ms", 0, "layout wait budget in ms (default 5000)")
	agentLaunchCmd.Flags().StringVar(&agentLaunchSend, "send", "", "text to deliver to the new block's TUI after launch")
	agentLaunchCmd.Flags().BoolVar(&agentLaunchSendStdin, "send-stdin", false, "read the text to deliver from stdin")
	agentLaunchCmd.Flags().BoolVar(&agentLaunchJSON, "json", false, "output the result as JSON")
	agentLaunchCmd.Flags().BoolVar(&agentLaunchHeadless, "headless", false, "run the agent CLI once without creating a block (one-shot, log under ~/.snorkeling/scheduledtask-runs/)")
	agentLaunchCmd.MarkFlagRequired("profile")
	agentCmd.AddCommand(agentLaunchCmd)

	agentSendCmd.Flags().StringVar(&agentSendBlock, "block", "this", "block id, or 'this' for the calling block")
	agentSendCmd.Flags().StringVar(&agentSendText, "text", "", "text to send")
	agentSendCmd.Flags().BoolVar(&agentSendStdin, "stdin", false, "read the text from stdin")
	agentSendCmd.Flags().BoolVar(&agentSendNoSubmit, "no-submit", false, "paste without pressing Enter")
	agentSendCmd.Flags().BoolVar(&agentSendNoWait, "no-wait", false, "do not wait for the TUI to be quiet")
	agentSendCmd.Flags().IntVar(&agentSendWaitMs, "wait-ms", 0, "readiness deadline in ms (default 30000)")
	agentSendCmd.Flags().IntVar(&agentSendQuietMs, "quiet-ms", 0, "how long the TUI must be silent (default 400)")
	agentSendCmd.Flags().IntVar(&agentSendSubmitDelayMs, "submit-delay-ms", 0, "paste -> enter delay in ms (default 150)")
	agentSendCmd.Flags().BoolVar(&agentSendJSON, "json", false, "output the result as JSON")
	agentSendCmd.Flags().BoolVar(&agentSendAsync, "async", false, "queue the dispatch and return its id immediately (delivery runs in the background)")
	agentSendCmd.Flags().BoolVar(&agentSendWaitReply, "wait-reply", false, "wait for the agent's turn to finish and return the reply summary (fire-and-forget otherwise)")
	agentSendCmd.Flags().IntVar(&agentSendReplyWaitMs, "reply-wait-ms", 0, "reply wait budget in ms (default 60000, max 300000)")
	agentSendCmd.Flags().IntVar(&agentSendReplyChars, "reply-chars", 0, "reply text budget in characters (default 2000, max 8000)")
	agentSendCmd.Flags().IntVar(&agentSendReplyPollMs, "reply-poll-ms", 0, "reply poll interval in ms (default 250, range 100-2000)")
	agentCmd.AddCommand(agentSendCmd)
}

func agentLaunchRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("agent launch", rtnErr == nil)
	}()

	// --headless is a one-shot run: mutually exclusive with anything that picks
	// a block location. --tab defaults to "active", so the flag must be tested
	// with Changed() rather than by value.
	if agentLaunchHeadless {
		if cmd.Flags().Changed("tab") || agentLaunchSplit != "" {
			return fmt.Errorf("E_USAGE: --headless and --tab/--split are mutually exclusive (headless never creates a block)")
		}
		return agentLaunchHeadlessRun(cmd, args)
	}

	req := wshrpc.AgentLaunchRequest{
		Profile:     strings.TrimSpace(agentLaunchProfile),
		Model:       strings.TrimSpace(agentLaunchModel),
		Tab:         agentLaunchTab,
		WorkspaceId: agentLaunchWsId,
		Split:       agentLaunchSplit,
		Cwd:         agentLaunchCwd,
		Connection:  agentLaunchConn,
		Magnified:   agentLaunchMagnified,
		NoFocus:     agentLaunchNoFocus,
		Wait:        agentLaunchWait,
		WaitMs:      agentLaunchWaitMs,
	}
	if agentLaunchSend != "" || agentLaunchSendStdin {
		text := agentLaunchSend
		if agentLaunchSendStdin {
			stdinText, err := readStdinText()
			if err != nil {
				return err
			}
			text = stdinText
		}
		if strings.TrimSpace(text) == "" {
			return fmt.Errorf("--send/--send-stdin produced no text")
		}
		// Text64 keeps the payload intact through the RPC layer (newlines, tabs,
		// very long prompts). The backend still sanitizes it.
		req.Send = &wshrpc.AgentSendRequest{Text64: base64.StdEncoding.EncodeToString([]byte(text))}
	}

	res, err := wshclient.AgentLaunchCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return err
	}
	if agentLaunchJSON {
		return writeJSONResult(res)
	}
	WriteStdout("block\t%s\n", res.BlockId)
	WriteStdout("tab\t%s\n", res.TabId)
	WriteStdout("profile\t%s\n", res.Profile)
	if res.Model != "" {
		WriteStdout("model\t%s\n", res.Model)
	}
	WriteStdout("cmd\t%s\n", res.Cmd)
	if res.SyncState != "" {
		WriteStdout("syncstate\t%s\n", res.SyncState)
	}
	if res.Send != nil {
		WriteStdout("send\tinjected=%v submitted=%v\n", res.Send.Injected, res.Send.Submitted)
	}
	for _, warn := range res.Warnings {
		WriteStdout("warning\t%s\n", warn)
	}
	return nil
}

// agentLaunchHeadlessRun runs the profile's CLI once (no block). The prompt
// comes from --send/--send-stdin exactly like the block path; the RPC result
// carries exit code, duration and the log file path, and a non-zero exit
// arrives as a structured E_AGENT_FAILED error (CLI exit 1).
func agentLaunchHeadlessRun(cmd *cobra.Command, args []string) error {
	text := agentLaunchSend
	if agentLaunchSendStdin {
		stdinText, err := readStdinText()
		if err != nil {
			return err
		}
		text = stdinText
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("E_USAGE: --send/--send-stdin text is required for --headless (the one-shot prompt)")
	}
	req := wshrpc.AgentLaunchRequest{
		Profile: strings.TrimSpace(agentLaunchProfile),
		Model:   strings.TrimSpace(agentLaunchModel),
		Cwd:     agentLaunchCwd,
		Send: &wshrpc.AgentSendRequest{
			Text64: base64.StdEncoding.EncodeToString([]byte(text)),
		},
	}
	res, err := wshclient.AgentLaunchHeadlessCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: 35 * 60 * 1000})
	if err != nil {
		if agentLaunchJSON && res != nil {
			_ = writeJSONResult(res)
		}
		return err
	}
	if agentLaunchJSON {
		return writeJSONResult(res)
	}
	WriteStdout("status\t%s\n", res.Status)
	WriteStdout("exitcode\t%d\n", res.ExitCode)
	WriteStdout("durationms\t%d\n", res.DurationMs)
	if res.OutputPath != "" {
		WriteStdout("outputpath\t%s\n", res.OutputPath)
	}
	if res.Error != "" {
		WriteStdout("error\t%s\n", res.Error)
	}
	return nil
}

func agentSendRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("agent send", rtnErr == nil)
	}()

	text := agentSendText
	if agentSendStdin {
		stdinText, err := readStdinText()
		if err != nil {
			return err
		}
		text = stdinText
	}
	if text == "" {
		return fmt.Errorf("--text or --stdin is required")
	}

	// Mutual exclusions are validated here (better error) and again server-side
	// (normalizeSendParams) so MCP and other clients cannot sneak past them.
	if agentSendWaitReply && agentSendAsync {
		return fmt.Errorf("E_USAGE: --wait-reply and --async are mutually exclusive (an async dispatch is delivered in the background and cannot be waited on)")
	}
	if agentSendWaitReply && agentSendNoWait {
		return fmt.Errorf("E_USAGE: --wait-reply and --no-wait are mutually exclusive (wait for the reply, or take the cursor)")
	}

	submit := !agentSendNoSubmit
	wait := !agentSendNoWait
	var waitReply *bool
	if agentSendWaitReply {
		requested := true
		waitReply = &requested
	}
	res, err := wshclient.AgentSendCommand(RpcClient, wshrpc.AgentSendRequest{
		BlockId:       agentSendBlock,
		Text64:        base64.StdEncoding.EncodeToString([]byte(text)),
		Submit:        &submit,
		Wait:          &wait,
		WaitMs:        agentSendWaitMs,
		QuietMs:       agentSendQuietMs,
		SubmitDelayMs: agentSendSubmitDelayMs,
		Async:         agentSendAsync,
		Requester:     "cli",
		// --no-wait already meant "skip the readiness wait"; the roundtrip
		// package extends it coherently: do not wait for a reply either, take
		// the cursor instead. With --wait-reply the two flags contradict each
		// (see the check above).
		NoWait:      agentSendNoWait,
		WaitReply:   waitReply,
		ReplyWaitMs: agentSendReplyWaitMs,
		ReplyChars:  agentSendReplyChars,
		ReplyPollMs: agentSendReplyPollMs,
	}, agentSendRpcOpts())
	if err != nil {
		return err
	}
	if agentSendJSON {
		return writeJSONResult(res)
	}
	WriteStdout("block\t%s\n", res.BlockId)
	WriteStdout("injected\t%v\n", res.Injected)
	WriteStdout("submitted\t%v\n", res.Submitted)
	if res.Replied || res.ReplyCursor != 0 {
		WriteStdout("replied\t%v\n", res.Replied)
		if res.Replied {
			WriteStdout("turn\t%d\n", res.Turn)
			WriteStdout("totalchars\t%d\n", res.TotalChars)
			WriteStdout("truncated\t%v\n", res.Truncated)
		}
		if res.ReplyCursor != 0 {
			WriteStdout("replycursor\t%d\n", res.ReplyCursor)
		}
		if res.ReplyText != "" {
			WriteStdout("replytext\t%s\n", strings.ReplaceAll(res.ReplyText, "\n", " "))
		}
		if res.ReplyWaitedMs > 0 {
			WriteStdout("replywaitedms\t%d\n", res.ReplyWaitedMs)
		}
	} else if res.WaitedMs > 0 {
		WriteStdout("waitedms\t%d\n", res.WaitedMs)
	}
	for _, warn := range res.Warnings {
		WriteStdout("warning\t%s\n", warn)
	}
	return nil
}

// agentSendRpcOpts sizes the RPC timeout for the actual server-side windows.
// The known pitfall of the roundtrip package (implement.md rollback point):
// the wait window (default 60s, up to 300s) dwarfs the 5s wsh default, so every
// synchronous --wait-reply would fail with a fake E_TIMEOUT unless the timeout
// is raised above the wait budget (wait + 15s, capped at the 320s server cap).
func agentSendRpcOpts() *wshrpc.RpcOpts {
	const baseTimeoutMs = 90000
	if !agentSendWaitReply {
		return &wshrpc.RpcOpts{Timeout: baseTimeoutMs}
	}
	waitMs := agentSendReplyWaitMs
	if waitMs <= 0 {
		waitMs = agentDefaultReplyWaitMs
	}
	if waitMs > agentMaxReplyWaitMs {
		waitMs = agentMaxReplyWaitMs
	}
	timeoutMs := int64(waitMs) + 15000
	if timeoutMs < baseTimeoutMs {
		timeoutMs = baseTimeoutMs
	}
	if timeoutMs > 320000 {
		timeoutMs = 320000
	}
	return &wshrpc.RpcOpts{Timeout: timeoutMs}
}

// Mirrors of wshserver.DefaultReplyWaitMs / MaxReplyWaitMs. Duplicated because
// cmd must not import the server package; when one changes, change both.
const (
	agentDefaultReplyWaitMs = 60000
	agentMaxReplyWaitMs     = 300000
)

// readStdinText reads the whole of stdin; usage errors surface instead of an
// empty injection that would look successful.
func readStdinText() (string, error) {
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("reading stdin: %w", err)
	}
	return string(data), nil
}

func writeJSONResult(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(data))
	return nil
}
