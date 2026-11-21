// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	agentResumeBlock         string
	agentResumeTab           string
	agentResumeWsId          string
	agentResumeCwd           string
	agentResumeNoFocus       bool
	agentResumeWait          bool
	agentResumeWaitMs        int
	agentResumeSend          string
	agentResumeSendStdin     bool
	agentResumeNoSubmit      bool
	agentResumeNoSendWait    bool
	agentResumeSendWaitMs    int
	agentResumeQuietMs       int
	agentResumeSubmitDelayMs int
	agentResumeJSON          bool
)

// agentResumeTimeoutMs is the no-send RPC budget. Stock 8s is not enough: the
// block creation plus the optional layout wait can take a few seconds.
const agentResumeTimeoutMs = 30000

// agentResumeSendTimeoutMs is the --send budget: delivery waits for TUI quiet
// (default 30s) and then for submit confirmation (default 180s, pi's startup
// update checks are the slow case). Pre-registered trap for this package.
const agentResumeSendTimeoutMs = 300000

var agentResumeCmd = &cobra.Command{
	Use:   "resume <sessionKey|sessionId|this>",
	Short: "Recreate an agent block for an existing session",
	Long: `Recreate an agent block for an existing session (resume its conversation).

The session is resolved exactly (key / id / 'this'), then the block is recreated
with the same meta the GUI restore flow writes: the agent TUI starts with the
provider's real resume argument, so the conversation history comes back.

  wsh session list --source pi --limit 5          # find a session key
  wsh agent resume <key> --json
  wsh agent resume <key> --tab new --workspace <wsid>
  wsh agent resume <key> --send "continue from the last plan" --json

--send delivers one message after the block exists (same pipeline as
'wsh agent send': quiet wait, bracketed paste, submit confirmation). A delivery
failure does not roll the block back; the block id is reported in the result.

Only claude / codex / opencode / pi sessions are resumable. Unknown sources
(e.g. gemini) are refused with E_USAGE instead of guessing a command.`,
	Args:    cobra.ExactArgs(1),
	RunE:    agentResumeRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	agentResumeCmd.Flags().StringVar(&agentResumeBlock, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	agentResumeCmd.Flags().StringVar(&agentResumeTab, "tab", "active", "active | new | <tabid>")
	agentResumeCmd.Flags().StringVar(&agentResumeWsId, "workspace", "", "workspace id (required with --tab new)")
	agentResumeCmd.Flags().StringVar(&agentResumeCwd, "cwd", "", "block working directory (overrides the session project path)")
	agentResumeCmd.Flags().BoolVar(&agentResumeNoFocus, "no-focus", false, "do not focus the new block")
	agentResumeCmd.Flags().BoolVar(&agentResumeWait, "wait", false, "wait until the frontend applied the layout")
	agentResumeCmd.Flags().IntVar(&agentResumeWaitMs, "wait-ms", 0, "layout wait budget in ms (default 5000)")
	agentResumeCmd.Flags().StringVar(&agentResumeSend, "send", "", "text to deliver to the resumed TUI")
	agentResumeCmd.Flags().BoolVar(&agentResumeSendStdin, "send-stdin", false, "read the text to deliver from stdin")
	agentResumeCmd.Flags().BoolVar(&agentResumeNoSubmit, "no-submit", false, "paste without pressing Enter")
	agentResumeCmd.Flags().BoolVar(&agentResumeNoSendWait, "no-send-wait", false, "do not wait for the TUI to be quiet before injecting")
	agentResumeCmd.Flags().IntVar(&agentResumeSendWaitMs, "send-wait-ms", 0, "delivery readiness deadline in ms (default 30000)")
	agentResumeCmd.Flags().IntVar(&agentResumeQuietMs, "quiet-ms", 0, "how long the TUI must be silent before injecting (default 400)")
	agentResumeCmd.Flags().IntVar(&agentResumeSubmitDelayMs, "submit-delay-ms", 0, "paste -> enter delay in ms (default 150)")
	agentResumeCmd.Flags().BoolVar(&agentResumeJSON, "json", false, "output the result as JSON")
	agentCmd.AddCommand(agentResumeCmd)
}

// buildAgentResumeRequest translates the bound flags into the RPC DTO. Split
// out so the flag -> DTO mapping is testable without an RPC client.
func buildAgentResumeRequest(identifier string) (wshrpc.AgentResumeRequest, error) {
	req := wshrpc.AgentResumeRequest{
		Identifier:  strings.TrimSpace(identifier),
		BlockId:     sessionBlockArg(agentResumeBlock),
		Tab:         agentResumeTab,
		WorkspaceId: strings.TrimSpace(agentResumeWsId),
		Cwd:         strings.TrimSpace(agentResumeCwd),
		NoFocus:     agentResumeNoFocus,
		Wait:        agentResumeWait,
		WaitMs:      agentResumeWaitMs,
	}
	if strings.TrimSpace(req.Identifier) == "" {
		req.Identifier = "this"
	}
	if agentResumeSend != "" || agentResumeSendStdin {
		text := agentResumeSend
		if agentResumeSendStdin {
			stdinText, err := readStdinText()
			if err != nil {
				return req, err
			}
			text = stdinText
		}
		if strings.TrimSpace(text) == "" {
			return req, fmt.Errorf("E_USAGE: --send/--send-stdin produced no text")
		}
		// Text64 keeps the payload intact through the RPC layer (newlines, tabs,
		// very long prompts). The backend still sanitizes it.
		req.SendText64 = base64.StdEncoding.EncodeToString([]byte(text))
		submit := !agentResumeNoSubmit
		sendWait := !agentResumeNoSendWait
		req.Submit = &submit
		req.SendWait = &sendWait
		req.SendWaitMs = agentResumeSendWaitMs
		req.QuietMs = agentResumeQuietMs
		req.SubmitDelayMs = agentResumeSubmitDelayMs
	}
	return req, nil
}

func agentResumeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("agent resume", rtnErr == nil)
	}()

	req, err := buildAgentResumeRequest(args[0])
	if err != nil {
		return err
	}
	timeoutMs := int64(agentResumeTimeoutMs)
	if req.SendText64 != "" {
		timeoutMs = agentResumeSendTimeoutMs
	}
	res, err := wshclient.AgentResumeCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: timeoutMs})
	if err != nil {
		// A delivery failure comes back with the block already created; report
		// the block id so the caller can still use (or close) it.
		if agentResumeJSON && res != nil && res.BlockId != "" {
			_ = writeJSONResult(res)
		}
		return err
	}
	if agentResumeJSON {
		return writeJSONResult(res)
	}
	WriteStdout("block\t%s\n", res.BlockId)
	WriteStdout("sessionid\t%s\n", res.SessionId)
	WriteStdout("source\t%s\n", res.Source)
	if res.ProjectPath != "" {
		WriteStdout("projectpath\t%s\n", res.ProjectPath)
	}
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
