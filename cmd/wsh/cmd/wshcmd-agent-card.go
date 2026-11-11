// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	agentCardJSON         bool
	agentCardBlockId      string
	agentCardNote         string
	agentCardTitle        string
	agentCardTagsSet      []string
	agentCardTagsAdd      []string
	agentCardTagsRemove   []string
	agentCardProps        []string
	agentCardPropScope    string
	agentCardForce        bool
	agentCardExpectedHash string
	agentCardDryRun       bool
	agentCardYes          bool
	agentCardTimeoutMs    int64
)

var agentCardCmd = &cobra.Command{
	Use:   "card",
	Short: "Read or write the Snorkeling session card (note/tags/title/props)",
	Long: `Read or write the Snorkeling session card for one AI session.

Reads are free. Writes always go through the agentdata patch pipeline, which
provides dry-run previews, SQLite backups, an audit log and expectedHash
preconditions. Writes are dry-run unless --yes is passed, and a real write
requires --expected-hash (or --expected-updated-at) from a fresh 'card get'.

The session card never overwrites user-authored content: a title whose
titleSource is "user" is refused unless --force is given, and a custom property
whose source is "user" is skipped unless --force is given.`,
}

var agentCardGetCmd = &cobra.Command{
	Use:     "get <sessionKey|sessionId|this>",
	Short:   "Show the session card (title, note, tags, props, hash)",
	Args:    cobra.ExactArgs(1),
	RunE:    agentCardGetRun,
	PreRunE: preRunSetupRpcClient,
}

var agentCardSetCmd = &cobra.Command{
	Use:   "set <sessionKey|sessionId|this>",
	Short: "Write the session card (dry-run unless --yes)",
	Long: `Write the session card.

Examples:
  wsh agent card set this --note "整理完成" --tags-add 已整理 --dry-run
  wsh agent card get this --json            # read .hash
  wsh agent card set this --note "整理完成" --yes --expected-hash <hash>
  wsh agent card set this --title "ACS 设计" --yes --expected-hash <hash>
  wsh agent card set this --title "ACS 设计" --force --yes --expected-hash <hash>
  wsh agent card set this --prop 优先级=select:P1 --yes --expected-hash <hash>
  wsh agent card set this --prop 优先级=select:P1 --prop-scope agent --dry-run`,
	Args:    cobra.ExactArgs(1),
	RunE:    agentCardSetRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	agentCardCmd.PersistentFlags().BoolVar(&agentCardJSON, "json", false, "output as JSON")
	agentCardCmd.PersistentFlags().Int64Var(&agentCardTimeoutMs, "timeout", 15000, "RPC timeout in milliseconds")
	agentCardCmd.AddCommand(agentCardGetCmd, agentCardSetCmd)

	agentCardGetCmd.Flags().StringVar(&agentCardBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")

	agentCardSetCmd.Flags().StringVar(&agentCardBlockId, "block", "", "block id for 'this' resolution (defaults to WAVETERM_BLOCKID)")
	agentCardSetCmd.Flags().StringVar(&agentCardNote, "note", "", "set the session note (use --note \"\" to clear)")
	agentCardSetCmd.Flags().StringVar(&agentCardTitle, "title", "", "set the session title (marks titleSource=ai)")
	agentCardSetCmd.Flags().StringSliceVar(&agentCardTagsSet, "tags-set", nil, "replace all tags")
	agentCardSetCmd.Flags().StringSliceVar(&agentCardTagsAdd, "tags-add", nil, "add tags (idempotent)")
	agentCardSetCmd.Flags().StringSliceVar(&agentCardTagsRemove, "tags-remove", nil, "remove tags")
	agentCardSetCmd.Flags().StringArrayVar(&agentCardProps, "prop", nil, "set a custom property as key=type:value (repeatable)")
	agentCardSetCmd.Flags().StringVar(&agentCardPropScope, "prop-scope", "session", "visibility of this call's --prop definitions: session | agent | all")
	agentCardSetCmd.Flags().BoolVar(&agentCardForce, "force", false, "overwrite user-authored title / property values")
	agentCardSetCmd.Flags().StringVar(&agentCardExpectedHash, "expected-hash", "", "precondition hash from 'agent card get' (required for --yes)")
	agentCardSetCmd.Flags().BoolVar(&agentCardDryRun, "dry-run", false, "preview the field-level diff without writing")
	agentCardSetCmd.Flags().BoolVar(&agentCardYes, "yes", false, "confirm the real write")

	agentCmd.AddCommand(agentCardCmd)
}

func agentCardRpcOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Timeout: agentCardTimeoutMs}
}

func agentCardGetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("agent card get", rtnErr == nil) }()
	res, err := wshclient.AgentCardGetCommand(RpcClient, wshrpc.AgentCardGetRequest{
		Identifier: args[0],
		BlockId:    agentCardBlockArg(),
	}, agentCardRpcOpts())
	if err != nil {
		return err
	}
	if agentCardJSON {
		return agentCardWriteJSON(res)
	}
	WriteStdout("session:     %s\n", orDash(res.SessionKey))
	WriteStdout("title:       %s (%s)\n", orDash(res.Title), orDash(res.TitleSource))
	note, tags := "", []string(nil)
	if res.Summary != nil {
		note = res.Summary.Note
		tags = res.Summary.Tags
	}
	WriteStdout("note:        %s\n", orDash(note))
	WriteStdout("tags:        %s\n", orDash(strings.Join(tags, ", ")))
	if res.Summary != nil && len(res.Summary.Props) > 0 {
		WriteStdout("props:\n")
		for key, prop := range res.Summary.Props {
			WriteStdout("  %s = %v (%s, %s)\n", key, prop.Value, orDash(prop.Type), orDash(prop.Source))
		}
	}
	if len(res.Schema) > 0 {
		WriteStdout("schema:\n")
		for _, def := range res.Schema {
			WriteStdout("  %s (%s, scope=%s)\n", orDash(def.Key), orDash(def.Type), orDash(schemaScopeLabel(def.Scope)))
		}
	}
	WriteStdout("hash:        %s\n", res.Hash)
	return nil
}

// schemaScopeLabel renders the settings-side scope for humans.
func schemaScopeLabel(scope string) string {
	if strings.TrimSpace(scope) == "" {
		return "all sessions"
	}
	return scope
}

func agentCardSetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("agent card set", rtnErr == nil) }()

	req := wshrpc.AgentCardSetRequest{
		Identifier:   args[0],
		BlockId:      agentCardBlockArg(),
		Force:        agentCardForce,
		ExpectedHash: strings.TrimSpace(agentCardExpectedHash),
		DryRun:       agentCardDryRun,
		Yes:          agentCardYes && !agentCardDryRun,
	}

	if cmd.Flags().Changed("note") {
		note := agentCardNote
		req.Note = &note
	}
	if cmd.Flags().Changed("title") {
		title := agentCardTitle
		req.Title = &title
	}
	if cmd.Flags().Changed("tags-set") || cmd.Flags().Changed("tags-add") || cmd.Flags().Changed("tags-remove") {
		req.Tags = &wshrpc.AgentCardTagPatch{
			Set:    agentCardTagsSet,
			Add:    agentCardTagsAdd,
			Remove: agentCardTagsRemove,
		}
	}
	propScope, err := normalizePropScope(agentCardPropScope)
	if err != nil {
		return err
	}
	props, err := parseCardProps(agentCardProps)
	if err != nil {
		return err
	}
	for key, prop := range props {
		prop.Scope = propScope
		props[key] = prop
	}
	if len(props) > 0 {
		req.Props = props
	}

	res, err := wshclient.AgentCardSetCommand(RpcClient, req, agentCardRpcOpts())
	if err != nil {
		if res != nil && agentCardJSON {
			_ = agentCardWriteJSON(res)
		}
		return err
	}
	if agentCardJSON {
		return agentCardWriteJSON(res)
	}
	agentCardPrintSummary(res)
	return nil
}

// normalizePropScope validates --prop-scope. Unknown values are an error:
// silently falling back to session would misrepresent the caller's intent.
func normalizePropScope(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "session":
		return "session", nil
	case "agent":
		return "agent", nil
	case "all":
		return "all", nil
	}
	return "", fmt.Errorf("invalid --prop-scope %q: expected session, agent or all", raw)
}

// parseCardProps parses repeated --prop key=type:value flags. A bare key=value
// defaults to type "text"; type "number"/"checkbox" values are converted so the
// backend type validator accepts them.
func parseCardProps(raw []string) (map[string]wshrpc.AgentCardPropPatch, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	props := make(map[string]wshrpc.AgentCardPropPatch, len(raw))
	for _, entry := range raw {
		key, rest, ok := strings.Cut(entry, "=")
		if !ok || strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("invalid --prop %q: expected key=value or key=type:value", entry)
		}
		key = strings.TrimSpace(key)
		propType := "text"
		value := rest
		if typeName, typedValue, typed := strings.Cut(rest, ":"); typed {
			switch typeName {
			case "text", "number", "select", "multi_select", "status", "date", "checkbox", "url":
				propType = typeName
				value = typedValue
			}
		}
		props[key] = wshrpc.AgentCardPropPatch{Type: propType, Value: convertCardPropValue(propType, value)}
	}
	return props, nil
}

func convertCardPropValue(propType string, raw string) any {
	switch propType {
	case "checkbox":
		return raw == "true" || raw == "1"
	case "number":
		var number float64
		if _, err := fmt.Sscanf(raw, "%g", &number); err == nil {
			return number
		}
		return raw
	case "multi_select":
		if strings.TrimSpace(raw) == "" {
			return []string{}
		}
		parts := strings.Split(raw, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	default:
		return raw
	}
}

func agentCardPrintSummary(res *wshrpc.AgentCardSetResult) {
	mode := "dry-run"
	if !res.DryRun {
		mode = "applied"
	}
	status := "unchanged"
	if res.Changed {
		status = "changed"
	}
	WriteStdout("agent card set %s: %s\n", mode, status)
	if res.Target != "" {
		WriteStdout("target: %s\n", res.Target)
	}
	for _, change := range res.Changes {
		WriteStdout("  %s: %v -> %v\n", change.Field, formatChangeValue(change.Before), formatChangeValue(change.After))
	}
	for _, message := range res.Messages {
		WriteStdout("  note: %s\n", message)
	}
	for _, skipped := range res.Skipped {
		WriteStdout("  skipped: %s\n", skipped)
	}
	for _, id := range res.BackupIds {
		WriteStdout("  backup: %s\n", id)
	}
	if res.DryRun {
		WriteStdout("\nnothing was written. Re-run with --yes --expected-hash <hash> to apply.\n")
	}
}

func agentCardBlockArg() string {
	if strings.TrimSpace(agentCardBlockId) != "" {
		return strings.TrimSpace(agentCardBlockId)
	}
	return strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID"))
}

func agentCardWriteJSON(value any) error {
	barr, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding json: %w", err)
	}
	WriteStdout("%s\n", string(barr))
	return nil
}
