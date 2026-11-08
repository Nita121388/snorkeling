// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentmcp"
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
