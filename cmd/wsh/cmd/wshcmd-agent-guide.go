// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentguide"
)

var agentGuideJSON bool

var agentGuideCmd = &cobra.Command{
	Use:   "guide",
	Short: "One-page guide to the control surface (what you can do from outside the app)",
	Long: `Prints the external control surface: the commands, the scope each one needs, and
the caveats that stop you from reporting something as done when it is not.

The same table generates the skill that ` + "`wsh agent install-skill`" + ` writes out, so this
output and the skill cannot disagree.`,
	Args: cobra.NoArgs,
	RunE: agentGuideRun,
}

func init() {
	agentCmd.AddCommand(agentGuideCmd)
	agentGuideCmd.Flags().BoolVar(&agentGuideJSON, "json", false, "machine-readable: commands + flags + errors + red lines")
}

func agentGuideRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("agent guide", rtnErr == nil) }()
	if agentGuideJSON {
		out, err := agentguide.JSON()
		if err != nil {
			return err
		}
		fmt.Print(out)
		return nil
	}
	fmt.Print(agentguide.Text())
	return nil
}
