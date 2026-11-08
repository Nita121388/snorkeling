// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentmcphost"
	"github.com/wavetermdev/waveterm/pkg/agentskill"
)

var (
	skillRoots   []string
	skillJSON    bool
	skillDryRun  bool
	mcpConfigOut string
	mcpConfigHost string
)

var agentInstallSkillCmd = &cobra.Command{
	Use:   "install-skill [--root <dir>]...",
	Short: "Install the control-surface skill for external agents",
	Long: `Writes the snorkeling-control skill (bundled inside wsh, so no repo needed)
into one or more agent skill directories.

With no --root, it installs into the conventional locations that exist on this
machine (Claude Code, Codex, pi). Pick one explicitly if you keep skills
elsewhere.`,
	Args: cobra.NoArgs,
	RunE: agentInstallSkillRun,
}

var agentMCPConfigCmd = &cobra.Command{
	Use:   "mcp-config [--host claude|cursor|codex]",
	Short: "Print the MCP server entry for an external agent host",
	Long: `Prints (or writes, with --out) the MCP server configuration that registers
wsh as a stdio MCP server. The token file goes in env, never in args: args are
visible in the host's process list and config files.`,
	Args: cobra.NoArgs,
	RunE: agentMCPConfigRun,
}

func init() {
	agentCmd.AddCommand(agentInstallSkillCmd, agentMCPConfigCmd)

	agentInstallSkillCmd.Flags().StringSliceVar(&skillRoots, "root", nil, "skill root directory (repeatable); default: detected agent dirs")
	agentInstallSkillCmd.Flags().BoolVar(&skillJSON, "json", false, "output as JSON")
	agentInstallSkillCmd.Flags().BoolVar(&skillDryRun, "dry-run", false, "show what would be written")

	agentMCPConfigCmd.Flags().StringVar(&mcpConfigHost, "host", "claude", "host flavour: claude|cursor|codex")
	agentMCPConfigCmd.Flags().StringVar(&mcpConfigOut, "out", "", "write to this file instead of stdout")
}

// detectRoots keeps only the skill directories that already exist, so we do not
// scatter ~/.claude (etc.) onto machines that never used that agent.
func detectRoots() ([]string, []string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, nil
	}
	var existing, missing []string
	for _, root := range agentskill.DefaultRoots(home) {
		parent := filepath.Dir(root)
		if _, err := os.Stat(parent); err == nil {
			existing = append(existing, root)
		} else {
			missing = append(missing, root)
		}
	}
	return existing, missing
}

func agentInstallSkillRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("agent install-skill", rtnErr == nil) }()

	roots := skillRoots
	missing := []string(nil)
	if len(roots) == 0 {
		roots, missing = detectRoots()
		if len(roots) == 0 {
			return fmt.Errorf("no agent skill directory detected; pass --root <dir> (e.g. ~/.claude/skills)")
		}
	}

	files, err := agentskill.Files()
	if err != nil {
		return err
	}
	if skillDryRun {
		for _, root := range roots {
			fmt.Printf("would install %d files into %s\n", len(files), filepath.Join(root, agentskill.SkillName))
		}
		for _, m := range missing {
			fmt.Printf("would skip (no such agent home): %s\n", m)
		}
		return nil
	}

	type result struct {
		Root    string   `json:"root"`
		Written []string `json:"written,omitempty"`
	}
	var results []result
	for _, root := range roots {
		written, err := agentskill.Install(root)
		if err != nil {
			return fmt.Errorf("install into %s: %w", root, err)
		}
		results = append(results, result{Root: root, Written: written})
	}
	if skillJSON {
		out, _ := json.Marshal(map[string]any{"skill": agentskill.SkillName, "installs": results, "skipped": missing})
		fmt.Println(string(out))
		return nil
	}
	for _, r := range results {
		fmt.Printf("installed\t%s (%d files)\n", filepath.Join(r.Root, agentskill.SkillName), len(r.Written))
	}
	for _, m := range missing {
		fmt.Printf("skipped\t%s (agent home not found; pass --root to force)\n", m)
	}
	fmt.Println("\nnext: create a token inside a Snorkeling block")
	fmt.Println("  wsh auth grant --name <agent> --scope observe --ttl 30m --out ~/.config/snorkeling/agent-token.json")
	return nil
}

func agentMCPConfigRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("agent mcp-config", rtnErr == nil) }()

	// Same builder as the in-app Agent Access panel, so the two never diverge.
	config, err := agentmcphost.Config(mcpConfigHost)
	if err != nil {
		return err
	}
	if mcpConfigOut != "" {
		if err := os.WriteFile(mcpConfigOut, append([]byte(config), byte(10)), 0o644); err != nil {
			return err
		}
		fmt.Println("wrote	" + mcpConfigOut)
		return nil
	}
	fmt.Println(config)
	return nil
}
