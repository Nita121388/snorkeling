// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentmcp"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	mcpTokenFile string
	mcpTimeout   int64
	mcpStdio     bool
)

var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Model Context Protocol server for external agents",
}

var mcpServeCmd = &cobra.Command{
	Use:   "serve --stdio",
	Short: "Serve the Agent Control Surface as MCP tools over stdio",
	Long: `Serves Snorkeling's control surface as MCP tools so an external agent
(Claude Code, Codex, pi, Cursor) can observe and navigate the app.

Transport is stdio only: no listener is opened. The token is read from
--token-file or SNORKELING_AGENT_TOKEN_FILE, never from the command line, so it
does not leak into the host's process list or config.

Register it in your MCP client as:
  wsh mcp serve --stdio --token-file ~/.config/snorkeling/agent-token.json`,
	Args: cobra.NoArgs,
	RunE: mcpServeRun,
}

func init() {
	mcpCmd.PersistentFlags().Int64Var(&mcpTimeout, "timeout", 15000, "per-call RPC timeout in milliseconds")
	mcpCmd.AddCommand(mcpServeCmd)
	mcpServeCmd.Flags().StringVar(&mcpTokenFile, "token-file", "", "agent token file (see: wsh auth grant)")
	// --stdio is the only transport. The flag exists so the invocation reads
	// as intent, and so a future attempt to add a listener has to fight a
	// deliberate name rather than slip in silently.
	mcpServeCmd.Flags().BoolVar(&mcpStdio, "stdio", true, "serve over stdio (the only supported transport)")
	rootCmd.AddCommand(mcpCmd)
}

// rpcBackend adapts the generated wsh client to agentmcp.Backend. Every method
// is a thin call — the tools have no logic of their own, so the CLI and the MCP
// server cannot diverge.
type rpcBackend struct{}

func (rpcBackend) opts() *wshrpc.RpcOpts { return &wshrpc.RpcOpts{Timeout: mcpTimeout} }

func (b rpcBackend) SessionLive(ctx context.Context, req wshrpc.SessionLiveRequest) (*wshrpc.SessionLiveResult, error) {
	return wshclient.SessionLiveCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionGet(ctx context.Context, req wshrpc.SessionGetRequest) (*wshrpc.SessionLiveRecord, error) {
	return wshclient.SessionGetCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionList(ctx context.Context, req wshrpc.SessionListRequest) (*wshrpc.SessionListResult, error) {
	return wshclient.SessionListCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionInfo(ctx context.Context, req wshrpc.SessionInfoRequest) (*wshrpc.SessionInfoResult, error) {
	return wshclient.SessionInfoCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionUsers(ctx context.Context, req wshrpc.SessionUsersRequest) (*wshrpc.SessionUsersResult, error) {
	return wshclient.SessionUsersCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionTurns(ctx context.Context, req wshrpc.SessionTurnsRequest) (*wshrpc.SessionTurnsResult, error) {
	return wshclient.SessionTurnsCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionTurn(ctx context.Context, req wshrpc.SessionTurnRequest) (*wshrpc.SessionTurnResult, error) {
	return wshclient.SessionTurnCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionWait(ctx context.Context, req wshrpc.SessionWaitRequest) (*wshrpc.SessionWaitResult, error) {
	// The wait window (default 60s, up to 300s) is far above the MCP default
	// (15s): without a per-call timeout every non-instant wait would come back
	// as a transport error instead of matched=false.
	waitMs := req.TimeoutMs
	if waitMs <= 0 {
		waitMs = 60000
	}
	return wshclient.SessionWaitCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: rpcWaitTimeout(waitMs)})
}

func (b rpcBackend) UIActive(ctx context.Context, req wshrpc.UIActiveRequest) (*wshrpc.UIActiveSnapshot, error) {
	return wshclient.UIActiveCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) UIState(ctx context.Context, req wshrpc.UIStateRequest) (*wshrpc.UIStateSnapshot, error) {
	return wshclient.UIStateCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) BlockRead(ctx context.Context, req wshrpc.BlockReadRequest) (*wshrpc.BlockReadResult, error) {
	return wshclient.BlockReadCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) BlockOpen(ctx context.Context, req wshrpc.BlockOpenRequest) (*wshrpc.BlockOpenResult, error) {
	return wshclient.BlockOpenCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) TabList(ctx context.Context, req wshrpc.TabListRequest) (*wshrpc.TabListResult, error) {
	return wshclient.TabListCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) TabCreate(ctx context.Context, req wshrpc.TabCreateRequest) (*wshrpc.TabCreateResult, error) {
	return wshclient.TabCreateCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) TabActivate(ctx context.Context, req wshrpc.TabActivateRequest) (*wshrpc.TabActivateResult, error) {
	return wshclient.TabActivateCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) AgentCardGet(ctx context.Context, req wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error) {
	return wshclient.AgentCardGetCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) AgentCardSet(ctx context.Context, req wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error) {
	return wshclient.AgentCardSetCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionAnnotate(ctx context.Context, req wshrpc.SessionAnnotateRequest) (*wshrpc.SessionAnnotateResult, error) {
	return wshclient.SessionAnnotateCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionEmojiGet(ctx context.Context, req wshrpc.SessionEmojiGetRequest) (*wshrpc.SessionEmojiGetResult, error) {
	return wshclient.SessionEmojiGetCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionEmojiSet(ctx context.Context, req wshrpc.SessionEmojiSetRequest) (*wshrpc.SessionEmojiSetResult, error) {
	return wshclient.SessionEmojiSetCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionEmojiInject(ctx context.Context, req wshrpc.SessionEmojiInjectRequest) (*wshrpc.SessionEmojiInjectResult, error) {
	return wshclient.SessionEmojiInjectCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionEmojiRecommendations(ctx context.Context, req wshrpc.SessionEmojiRecommendationsRequest) (*wshrpc.SessionEmojiRecommendationsResult, error) {
	return wshclient.SessionEmojiRecommendationsCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionEmojiPrefs(ctx context.Context, req wshrpc.SessionEmojiPrefsRequest) (*wshrpc.SessionEmojiPrefsResult, error) {
	return wshclient.SessionEmojiPrefsCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) RecordEmojiPick(ctx context.Context, req wshrpc.SessionEmojiRecordPickRequest) (*wshrpc.SessionEmojiRecordPickResult, error) {
	return wshclient.SessionEmojiRecordPickCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) SessionEmojiMigrate(ctx context.Context, req wshrpc.SessionEmojiMigrateRequest) (*wshrpc.SessionEmojiMigrateResult, error) {
	return wshclient.SessionEmojiMigrateCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) AgentLaunch(ctx context.Context, req wshrpc.AgentLaunchRequest) (*wshrpc.AgentLaunchResult, error) {
	return wshclient.AgentLaunchCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) AgentSend(ctx context.Context, req wshrpc.AgentSendRequest) (*wshrpc.AgentSendResult, error) {
	// A wait-reply roundtrip blocks for the whole reply window; the MCP default
	// (15s) would time it out. Mirror the CLI sizing: wait + 15s, floor 90s
	// (readiness + submit confirmation), cap 320s (server-side cap + slack).
	if req.WaitReply != nil && *req.WaitReply {
		waitMs := req.ReplyWaitMs
		if waitMs <= 0 {
			waitMs = 60000
		}
		return wshclient.AgentSendCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: rpcWaitTimeout(waitMs)})
	}
	return wshclient.AgentSendCommand(RpcClient, req, b.opts())
}

// rpcWaitTimeout sizes an RPC deadline above a server-side wait window.
func rpcWaitTimeout(waitMs int) int64 {
	const baseTimeoutMs = 90000
	if waitMs > 300000 {
		waitMs = 300000
	}
	timeoutMs := int64(waitMs) + 15000
	if timeoutMs < baseTimeoutMs {
		timeoutMs = baseTimeoutMs
	}
	if timeoutMs > 320000 {
		timeoutMs = 320000
	}
	return timeoutMs
}

func (b rpcBackend) AgentResume(ctx context.Context, req wshrpc.AgentResumeRequest) (*wshrpc.AgentResumeResult, error) {
	// Resume with a send rides on the same long delivery windows as agent send
	// (TUI quiet + submit confirmation); the MCP default would time out.
	return wshclient.AgentResumeCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: 300000})
}

func (b rpcBackend) SessionMark(ctx context.Context, req wshrpc.SessionMarkRequest) (*wshrpc.SessionMarkResult, error) {
	return wshclient.SessionMarkCommand(RpcClient, req, b.opts())
}

func (b rpcBackend) ScheduledTaskList(ctx context.Context) ([]wconfig.ScheduledTaskType, error) {
	return wshclient.ScheduledTaskListCommand(RpcClient, b.opts())
}

func (b rpcBackend) ScheduledTaskCreate(ctx context.Context, task wconfig.ScheduledTaskType) (wconfig.ScheduledTaskType, error) {
	return wshclient.ScheduledTaskCreateCommand(RpcClient, task, b.opts())
}

func (b rpcBackend) ScheduledTaskRun(ctx context.Context, taskID string) (*wshrpc.ScheduledTaskRunResult, error) {
	// A scheduled run can take up to 30 minutes; the MCP default (15s) would
	// time out the moment the task actually starts.
	return wshclient.ScheduledTaskRunCommand(RpcClient, taskID, &wshrpc.RpcOpts{Timeout: 35 * 60 * 1000})
}

func mcpServeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("mcp serve", rtnErr == nil) }()

	if !mcpStdio {
		// There is no other transport on purpose (design §10.5.5: a TCP
		// listener would enlarge the threat model by an order of magnitude).
		return fmt.Errorf("E_USAGE: only --stdio is supported; no listener transport exists")
	}

	// The token must come from a file or the environment: putting it in argv
	// would expose it to `ps` and to the host's MCP config file.
	if mcpTokenFile == "" {
		mcpTokenFile = os.Getenv("SNORKELING_AGENT_TOKEN_FILE")
	}
	if mcpTokenFile == "" {
		return fmt.Errorf("no agent token: pass --token-file or set SNORKELING_AGENT_TOKEN_FILE (create one with: wsh auth grant)")
	}
	if err := setupRpcClientFromTokenFile(mcpTokenFile); err != nil {
		return err
	}

	server := &agentmcp.Server{
		Backend: rpcBackend{},
		Scopes:  agentTokenScopes,
		Out:     os.Stdout,
	}
	// MCP framing is newline-delimited JSON on stdin/stdout. Diagnostics must
	// never go to stdout or they would corrupt the protocol stream.
	return server.Serve(context.Background(), os.Stdin)
}
