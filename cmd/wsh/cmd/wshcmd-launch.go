// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var magnifyBlock bool

var launchCmd = &cobra.Command{
	Use:     "launch",
	Short:   "launch a widget by its ID",
	Args:    cobra.ExactArgs(1),
	RunE:    launchRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	launchCmd.Flags().BoolVarP(&magnifyBlock, "magnify", "m", false, "start the widget in magnified mode")
	rootCmd.AddCommand(launchCmd)
}

// DefaultAgentWidgetId is the built-in agent widget id. It lives here (CLI
// layer) because the backend catalog owns profiles, not widget ids.
const DefaultAgentWidgetId = "defwidget@agent"

// launchDefaultAgentWidget resolves the catalog's default profile and launches
// it exactly the way `wsh agent launch --profile <default>` would.
func launchDefaultAgentWidget(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("launch", rtnErr == nil)
	}()

	profiles, err := wshclient.AgentProfileListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("listing agent profiles: %w", err)
	}
	defaultProfile := ""
	for _, p := range profiles {
		if p.Default {
			defaultProfile = p.Name
			break
		}
	}
	if defaultProfile == "" {
		return fmt.Errorf("agent catalog has no default profile (agent:defaultprofile)")
	}
	oref, err := wshclient.AgentLaunchCommand(RpcClient, wshrpc.AgentLaunchRequest{
		Profile:   defaultProfile,
		Tab:       getTabIdFromEnv(),
		Magnified: magnifyBlock,
	}, &wshrpc.RpcOpts{Timeout: 30000})
	if err != nil {
		return err
	}
	WriteStdout("launched agent %q: %s\n", defaultProfile, oref.BlockId)
	return nil
}

func launchRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("launch", rtnErr == nil)
	}()

	widgetId := args[0]

	// defwidget@agent historically produced a bare `codex` block (the default
	// widget's hard-coded blockdef). Route it through the catalog-constrained
	// agent launch instead: same path as `wsh agent launch`, default profile
	// resolved from the catalog (no agent name is hard-coded here).
	if widgetId == DefaultAgentWidgetId {
		return launchDefaultAgentWidget(cmd, args)
	}

	// Get the full configuration
	config, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting configuration: %w", err)
	}

	// Look for widget in both widgets and defaultwidgets
	widget, ok := config.Widgets[widgetId]
	if !ok {
		widget, ok = config.DefaultWidgets[widgetId]
		if !ok {
			return fmt.Errorf("widget %q not found in configuration", widgetId)
		}
	}

	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("no WAVETERM_TABID env var set")
	}
	if widget.BlockDef == nil {
		if widget.Action != "" {
			return fmt.Errorf("widget %q uses action %q, which cannot be launched from wsh launch", widgetId, widget.Action)
		}
		return fmt.Errorf("widget %q has no blockdef", widgetId)
	}

	// Create block data from widget config
	createBlockData := wshrpc.CommandCreateBlockData{
		TabId:     tabId,
		BlockDef:  widget.BlockDef,
		Magnified: magnifyBlock || widget.Magnified,
		Focused:   true,
	}

	// Create the block
	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		return fmt.Errorf("creating widget block: %w", err)
	}

	WriteStdout("launched widget %q: %s\n", widgetId, oref)
	return nil
}
