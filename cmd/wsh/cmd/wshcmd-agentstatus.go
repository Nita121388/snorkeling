// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var agentStatusCmd = &cobra.Command{
	Use:     "agentstatus {working|idle|blocked|release|unknown}",
	Short:   "report an agent status for the current block",
	Args:    cobra.ExactArgs(1),
	RunE:    agentStatusRun,
	PreRunE: preRunSetupRpcClient,
}

var agentStatusInstallHooksCmd = &cobra.Command{
	Use:   "install-hooks [codex|claude|all]",
	Short: "install Codex/Claude hooks that report agent status",
	Args:  cobra.MaximumNArgs(1),
	RunE:  agentStatusInstallHooksRun,
}

var (
	agentStatusProvider  string
	agentStatusSessionId string
	agentStatusSource    string
	agentStatusPhase     string
	agentStatusMessage   string
	agentStatusToolName  string
	agentStatusSeq       int64
	agentStatusTtlMs     int64
	agentStatusJSON      bool
)

func init() {
	rootCmd.AddCommand(agentStatusCmd)
	agentStatusCmd.AddCommand(agentStatusInstallHooksCmd)
	agentStatusCmd.Flags().StringVar(&agentStatusProvider, "provider", "", "agent provider")
	agentStatusCmd.Flags().StringVar(&agentStatusSessionId, "session-id", "", "agent session id")
	agentStatusCmd.Flags().StringVar(&agentStatusSource, "source", agentstatus.SourceHook, "status source")
	agentStatusCmd.Flags().StringVar(&agentStatusPhase, "phase", "", "agent phase")
	agentStatusCmd.Flags().StringVar(&agentStatusMessage, "message", "", "status message")
	agentStatusCmd.Flags().StringVar(&agentStatusToolName, "tool", "", "tool name")
	agentStatusCmd.Flags().Int64Var(&agentStatusSeq, "seq", 0, "monotonic sequence number")
	agentStatusCmd.Flags().Int64Var(&agentStatusTtlMs, "ttl-ms", 0, "status time-to-live in milliseconds")
	agentStatusCmd.Flags().BoolVar(&agentStatusJSON, "json", false, "print reported status as JSON")
}

func agentStatusInstallHooksRun(cmd *cobra.Command, args []string) error {
	target := agentstatus.HookTargetAll
	if len(args) > 0 {
		target = args[0]
	}
	results, err := agentstatus.InstallHooks(target)
	if err != nil {
		return err
	}
	for _, result := range results {
		WriteStdout("installed %s agent status hook: %s\n", result.Provider, result.HookPath)
		if result.HooksPath != "" {
			WriteStdout("updated hooks: %s\n", result.HooksPath)
		}
		if result.SettingsPath != "" {
			WriteStdout("updated settings: %s\n", result.SettingsPath)
		}
		if result.ConfigPath != "" {
			WriteStdout("updated config: %s\n", result.ConfigPath)
		}
	}
	return nil
}

func agentStatusRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("agentstatus", rtnErr == nil)
	}()

	report := agentstatus.AgentStatusReport{
		BlockId:    os.Getenv("WAVETERM_BLOCKID"),
		Provider:   agentStatusProvider,
		SessionId:  agentStatusSessionId,
		Source:     agentStatusSource,
		State:      args[0],
		Phase:      agentStatusPhase,
		Message:    agentStatusMessage,
		ToolName:   agentStatusToolName,
		Seq:        agentStatusSeq,
		TtlMs:      agentStatusTtlMs,
		ReportedAt: time.Now().UnixMilli(),
	}
	if report.Provider == "" {
		report.Provider = os.Getenv("WAVETERM_AGENT_PROVIDER")
	}
	if report.SessionId == "" {
		report.SessionId = os.Getenv("WAVETERM_AGENT_SESSIONID")
	}
	if report.Seq == 0 {
		report.Seq = time.Now().UnixNano()
	}
	if strings.EqualFold(report.State, agentstatus.StateRelease) {
		report.Phase = agentstatus.PhaseNone
	}
	normalized, err := agentstatus.SanitizeReport(report, os.Getenv("WAVETERM_BLOCKID"))
	if err != nil {
		return err
	}

	status, err := wshclient.AgentStatusCommand(RpcClient, normalized, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("reporting agent status: %w", err)
	}
	if agentStatusJSON {
		barr, err := json.Marshal(status)
		if err != nil {
			return fmt.Errorf("encoding status json: %w", err)
		}
		WriteStdout("%s\n", string(barr))
	} else if status == nil {
		WriteStdout("agent status released\n")
	} else {
		WriteStdout("agent status %s\n", status.State)
	}
	return nil
}
