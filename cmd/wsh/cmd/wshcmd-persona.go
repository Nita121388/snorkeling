// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/persona"
)

// wsh persona is the data foundation of the Persona system (design/plans/
// persona-system.md §3.1). It is deliberately a local, pure-filesystem
// command group: no RPC, no app dependency — the home bases must be
// inspectable even when the app is not running.
//
// Write discipline (same as wsh agent card / wsh data):
//   - dry-run by default; --yes is required for any disk write
//   - idempotent: an existing slug is returned, never overwritten
//   - --json emits one structured object, no human prose mixed in

var (
	personaJSON     bool
	personaYes      bool
	personaRoot     string
	personaDryRun   bool
	personaName     string
	personaEmoji    string
	personaRole     string
	personaProvider string
	personaModel    string
)

var personaCmd = &cobra.Command{
	Use:   "persona",
	Short: "Manage persona home bases (create/list/get/rename)",
	Long: `Manage persona home bases: identity, CHARTER and MEMORY on disk.

Layout (design §3.1): <rootdir>/<id>/.persona/{persona.json, CHARTER.md,
MEMORY/…, agents/} plus a root AGENTS.md pointer and a work/ area.
The roster is derived at <rootdir>/.index/PERSONAS.md.

Writes are dry-run unless --yes is passed. Creates are idempotent: an
existing slug is reported and left untouched.`,
}

var personaCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Scaffold a persona home base (dry-run unless --yes)",
	Long: `Scaffold a persona home base.

The id (directory name) is derived from --name; the display name lives in
persona.json and can be changed freely. A non-ASCII name gets a deterministic
hash suffix so distinct names never collapse onto one slug.

Examples:
  wsh persona create --name "Backup Guard" --role "备份归档" --dry-run
  wsh persona create --name "Backup Guard" --emoji 🎭 --provider pi --model deepseek --yes
  wsh persona create --name smoke --json --yes`,
	Args: cobra.NoArgs,
	RunE: personaCreateRun,
}

var personaListCmd = &cobra.Command{
	Use:   "list",
	Short: "List personas from a directory scan",
	Args:  cobra.NoArgs,
	RunE:  personaListRun,
}

var personaGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Show one persona identity card and CHARTER",
	Args:  cobra.ExactArgs(1),
	RunE:  personaGetRun,
}

var personaRenameCmd = &cobra.Command{
	Use:   "rename <oldId> <newId>",
	Short: "Rename a persona id (the only legal id-change path)",
	Long: `Rename a persona id: move the directory, rewrite persona.json.id and
regenerate the roster. The display name is not touched (design §3.1:
directory name == id; display name lives in persona.json).

Dry-run by default; --yes applies the move. Refuses to overwrite an
existing target id.`,
	Args: cobra.ExactArgs(2),
	RunE: personaRenameRun,
}

func init() {
	personaCreateCmd.Flags().BoolVar(&personaDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	personaCreateCmd.Flags().StringVar(&personaName, "name", "", "display name (the id is derived from it)")
	personaCreateCmd.Flags().StringVar(&personaEmoji, "emoji", "", "emoji shown in the roster line")
	personaCreateCmd.Flags().StringVar(&personaRole, "role", "", "one-line duty, rendered into the roster L0 line")
	personaCreateCmd.Flags().StringVar(&personaProvider, "provider", "", "default agent provider")
	personaCreateCmd.Flags().StringVar(&personaModel, "model", "", "default model")
	personaCmd.PersistentFlags().BoolVar(&personaJSON, "json", false, "output as JSON")
	personaCmd.PersistentFlags().BoolVar(&personaYes, "yes", false, "apply writes (default is dry-run)")
	personaCmd.PersistentFlags().StringVar(&personaRoot, "root", "", "persona root dir (default ~/.snorkeling/personas, override with PERSONA_ROOT)")
	personaRenameCmd.Flags().BoolVar(&personaDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	personaCmd.AddCommand(personaCreateCmd, personaListCmd, personaGetCmd, personaRenameCmd)
	rootCmd.AddCommand(personaCmd)
}

func personaCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona create", rtnErr == nil)
	}()
	res, err := persona.Create(persona.Options{
		Root:     personaRoot,
		Name:     personaName,
		Emoji:    personaEmoji,
		Role:     personaRole,
		Provider: personaProvider,
		Model:    personaModel,
		DryRun:   !personaYes || personaDryRun,
	})
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(res)
	}
	if !res.Created {
		WriteStdout("persona %q already exists at %s (nothing written)\n", res.Persona.ID, res.Dir)
		return nil
	}
	if res.Applied {
		WriteStdout("created %s\n", res.Dir)
	} else {
		WriteStdout("dry-run: would create %s\n", res.Dir)
	}
	WriteStdout("  %d files, e.g.:\n", len(res.Files))
	for _, f := range res.Files {
		WriteStdout("    %s\n", strings.TrimPrefix(f.Path, res.Dir+string(os.PathSeparator)))
	}
	if !personaYes {
		WriteStdout("re-run with --yes to write these files\n")
	}
	return nil
}

func personaListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona list", rtnErr == nil)
	}()
	root, err := persona.ResolveRoot(personaRoot)
	if err != nil {
		return err
	}
	personas, err := persona.List(personaRoot)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"root": root, "personas": personas})
	}
	if len(personas) == 0 {
		WriteStdout("no personas under %s\n", root)
		return nil
	}
	for _, p := range personas {
		stack := p.Provider
		if p.Model != "" {
			if stack == "" {
				stack = p.Model
			} else {
				stack = stack + "/" + p.Model
			}
		}
		line := fmt.Sprintf("%s | %s | %s", rosterIDCellCLI(p), orDash(p.Role), orDash(stack))
		WriteStdout("%s\n", line)
	}
	return nil
}

func rosterIDCellCLI(p persona.Persona) string {
	if p.Emoji != "" {
		return p.Emoji + " " + p.ID
	}
	return p.ID
}

func personaGetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona get", rtnErr == nil)
	}()
	id := args[0]
	p, charter, err := persona.Get(personaRoot, id)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"persona": p, "charter": charter})
	}
	barr, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(barr))
	WriteStdout("--- CHARTER.md ---\n%s\n", charter)
	return nil
}

func personaRenameRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona rename", rtnErr == nil)
	}()
	oldID, newID := args[0], args[1]
	res, err := persona.Rename(personaRoot, oldID, newID, !personaYes || personaDryRun)
	if err != nil {
		if errors.Is(err, persona.ErrNotFound) {
			return fmt.Errorf("no persona %q (use `wsh persona list`)", oldID)
		}
		return err
	}
	if personaJSON {
		return writeJSONObj(res)
	}
	if res.Applied {
		WriteStdout("renamed %s -> %s (%s)\n", res.OldID, res.NewID, res.NewDir)
		WriteStdout("  block meta refs rewritten: %d\n", res.MetaRefs)
	} else {
		WriteStdout("dry-run: would rename %s -> %s\n%s -> %s\n", res.OldID, res.NewID, res.OldDir, res.NewDir)
		WriteStdout("re-run with --yes to apply\n")
	}
	return nil
}

func writeJSONObj(v any) error {
	barr, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding json: %w", err)
	}
	WriteStdout("%s\n", string(barr))
	return nil
}
