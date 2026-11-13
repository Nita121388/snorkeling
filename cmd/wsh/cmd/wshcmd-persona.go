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
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
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
//
// A2.5 (agent self-creation, task design §2): an agent caller — identified by
// --from-session or --agent-name — does not scaffold personas. Without --yes
// it writes .index/proposals/<slug>.json and stops; a human approves with
// `wsh persona approve <slug> --yes`. A human caller keeps the A1 behaviour
// (dry-run preview / --yes apply).

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

	personaFromSession       string
	personaAgentName         string
	personaBlockFlag         string
	personaCharterFile       string
	personaMemoryFromSession bool

	personaSection string
	personaText    string
)

var personaCmd = &cobra.Command{
	Use:   "persona",
	Short: "Manage persona home bases (create/list/get/rename/propose/memory)",
	Long: `Manage persona home bases: identity, CHARTER and MEMORY on disk.

Layout (design §3.1): <rootdir>/<id>/.persona/{persona.json, CHARTER.md,
MEMORY/…, agents/} plus a root AGENTS.md pointer and a work/ area.
The roster is derived at <rootdir>/.index/PERSONAS.md.

Writes are dry-run unless --yes is passed. Creates are idempotent: an
existing slug is reported and left untouched.

Agents never scaffold directly: pass --from-session <key>|this (or
--agent-name <n>) and the create becomes a proposal under
.index/proposals/, pending a human ` + "`wsh persona approve <slug> --yes`" + `.`,
}

var personaCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Scaffold a persona home base (dry-run unless --yes; agent = propose)",
	Long: `Scaffold a persona home base.

The id (directory name) is derived from --name; the display name lives in
persona.json and can be changed freely. A non-ASCII name gets a deterministic
hash suffix so distinct names never collapse onto one slug.

Caller identity decides the gate (design §2):
  human (no --from-session/--agent-name)  dry-run preview; --yes applies
  agent (--from-session/--agent-name)     proposal written; --yes applies

Examples:
  wsh persona create --name "Backup Guard" --role "备份归档" --dry-run
  wsh persona create --name "Backup Guard" --emoji 🎭 --provider pi --model deepseek --yes
  wsh persona create --name "Backup Guard" --from-session this
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

var personaProposeCmd = &cobra.Command{
	Use:   "propose",
	Short: "Inspect agent proposals (pending persona creates)",
}

var personaProposeListCmd = &cobra.Command{
	Use:   "list",
	Short: "List pending persona proposals",
	Args:  cobra.NoArgs,
	RunE:  personaProposeListRun,
}

var personaApproveCmd = &cobra.Command{
	Use:   "approve <slug>",
	Short: "Approve a proposal: scaffold it and delete the proposal",
	Long: `Approve a pending agent proposal.

The scaffold keeps the agent provenance (createdBy.kind=agent) and stamps
approvedBy with the approving human. --yes is required: approval is a human
decision and must be typed out.`,
	Args: cobra.ExactArgs(1),
	RunE: personaApproveRun,
}

var personaRejectCmd = &cobra.Command{
	Use:   "reject <slug>",
	Short: "Reject a proposal: delete it, leave one journal line",
	Args:  cobra.ExactArgs(1),
	RunE:  personaRejectRun,
}

var personaMemoryCmd = &cobra.Command{
	Use:   "memory",
	Short: "Read/write persona memory (journal direct; facts/lessons via inbox)",
}

// A5 sync: the rootdir itself is the git repo. init/status/pull/push are thin
// git wrappers; rebuild regenerates the derived artifacts after a clone.
var personaSyncCmd = &cobra.Command{
	Use:   "sync",
	Short: "Cross-machine sync (rootdir git repo + generated-artifact rebuild)",
}

var personaSyncInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize the rootdir git repo and its §3.2 .gitignore",
	Args:  cobra.NoArgs,
	RunE:  personaSyncInitRun,
}

var personaSyncStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show repo state (clean / branch / remote / unmerged paths)",
	Args:  cobra.NoArgs,
	RunE:  personaSyncStatusRun,
}

var personaSyncPullCmd = &cobra.Command{
	Use:   "pull",
	Short: "git pull the rootdir repo",
	Args:  cobra.NoArgs,
	RunE:  personaSyncPullRun,
}

var personaSyncPushCmd = &cobra.Command{
	Use:   "push",
	Short: "git push the rootdir repo",
	Args:  cobra.NoArgs,
	RunE:  personaSyncPushRun,
}

var personaSyncRebuildCmd = &cobra.Command{
	Use:   "rebuild",
	Short: "Rebuild PERSONAS.md + generated provider contracts after a clone",
	Args:  cobra.NoArgs,
	RunE:  personaSyncRebuildRun,
}

var personaSyncModeCmd = &cobra.Command{
	Use:   "mode <id> <shared|own>",
	Short: "Set a persona's sync.mode in its (ignored) persona.local.json",
	Args:  cobra.ExactArgs(2),
	RunE:  personaSyncModeRun,
}

var personaMemoryAddCmd = &cobra.Command{
	Use:   "add <id>",
	Short: "Append memory (journal direct; facts/lessons become inbox proposals)",
	Long: `Append one memory entry to a persona.

Memory discipline (design §4.5 / §6):
  journal          appended directly (timestamped line; needs --yes)
  facts / lessons  ALWAYS routed to MEMORY/inbox.md as a proposal and the
                   command exits 1 — agents may not write long-term memory,
                   and --yes does not change that (that is the gate).

Examples:
  wsh persona memory add smoke --section journal --text "完毕" --yes
  wsh persona memory add smoke --section lessons --text "..." --from-session this`,
	Args: cobra.ExactArgs(1),
	RunE: personaMemoryAddRun,
}

func init() {
	personaCreateCmd.Flags().BoolVar(&personaDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	personaCreateCmd.Flags().StringVar(&personaName, "name", "", "display name (the id is derived from it)")
	personaCreateCmd.Flags().StringVar(&personaEmoji, "emoji", "", "emoji shown in the roster line")
	personaCreateCmd.Flags().StringVar(&personaRole, "role", "", "one-line duty, rendered into the roster L0 line")
	personaCreateCmd.Flags().StringVar(&personaProvider, "provider", "", "default agent provider")
	personaCreateCmd.Flags().StringVar(&personaModel, "model", "", "default model")
	personaCreateCmd.Flags().StringVar(&personaFromSession, "from-session", "", "agent session key (or 'this' to resolve the calling block); makes the caller an agent")
	personaCreateCmd.Flags().StringVar(&personaAgentName, "agent-name", "", "agent name when no session key is available; makes the caller an agent")
	personaCreateCmd.Flags().StringVar(&personaCharterFile, "charter-file", "", "use this file's text as the CHARTER.md draft (written on scaffold, stored in the proposal)")
	personaCreateCmd.Flags().BoolVar(&personaMemoryFromSession, "memory-from-session", false, "use the calling session's note/tags as a MEMORY/inbox.md draft")
	personaCreateCmd.Flags().StringVar(&personaBlockFlag, "block", "", "block id for --from-session this (defaults to WAVETERM_BLOCKID)")
	personaCmd.PersistentFlags().BoolVar(&personaJSON, "json", false, "output as JSON")
	personaCmd.PersistentFlags().BoolVar(&personaYes, "yes", false, "apply writes (default is dry-run)")
	personaCmd.PersistentFlags().StringVar(&personaRoot, "root", "", "persona root dir (default ~/.snorkeling/personas, override with PERSONA_ROOT)")
	personaRenameCmd.Flags().BoolVar(&personaDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	personaMemoryAddCmd.Flags().StringVar(&personaSection, "section", "", "memory section: facts | lessons | journal")
	personaMemoryAddCmd.Flags().StringVar(&personaText, "text", "", "the memory text")
	personaMemoryAddCmd.Flags().StringVar(&personaFromSession, "from-session", "", "record this agent session as the source (or 'this')")
	personaMemoryAddCmd.Flags().StringVar(&personaAgentName, "agent-name", "", "record this agent name as the source")
	personaMemoryAddCmd.Flags().StringVar(&personaBlockFlag, "block", "", "block id for --from-session this (defaults to WAVETERM_BLOCKID)")
	personaMemoryAddCmd.Flags().BoolVar(&personaDryRun, "dry-run", false, "explicitly force a preview and write nothing")
	personaProposeCmd.AddCommand(personaProposeListCmd)
	personaMemoryCmd.AddCommand(personaMemoryAddCmd)
	personaCmd.AddCommand(personaCreateCmd, personaListCmd, personaGetCmd, personaRenameCmd,
		personaProposeCmd, personaApproveCmd, personaRejectCmd, personaMemoryCmd, personaSyncCmd)
	personaSyncCmd.AddCommand(personaSyncInitCmd, personaSyncStatusCmd, personaSyncPullCmd,
		personaSyncPushCmd, personaSyncRebuildCmd, personaSyncModeCmd)
	rootCmd.AddCommand(personaCmd)
}

// personaResolveAgent turns the CLI identity flags into an agent provenance.
// It returns (nil, nil) for a pure human caller. `--from-session this` needs
// the app (RPC); every other value is used literally.
func personaResolveAgent() (*persona.Provenance, error) {
	from := strings.TrimSpace(personaFromSession)
	name := strings.TrimSpace(personaAgentName)
	if from == "" {
		if name == "" {
			return nil, nil // human path: A1 behaviour unchanged
		}
		return &persona.Provenance{Kind: "agent", Name: name}, nil
	}
	sessionID := from
	if from == "this" {
		res, err := personaGetSessionCard("this")
		if err != nil {
			return nil, fmt.Errorf("resolving --from-session this: %w\n(retry with a literal session key from `wsh session list`, or run inside a Snorkeling block)", err)
		}
		sessionID = strings.TrimSpace(res.SessionId)
		if sessionID == "" {
			sessionID = strings.TrimSpace(res.SessionKey)
		}
		if name == "" {
			name = strings.TrimSpace(res.Provider)
		}
	}
	if name == "" {
		name = "agent"
	}
	return &persona.Provenance{Kind: "agent", Name: name, SessionID: sessionID}, nil
}

func personaBlockArg() string {
	if strings.TrimSpace(personaBlockFlag) != "" {
		return strings.TrimSpace(personaBlockFlag)
	}
	return strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID"))
}

// personaGetSessionCard is the `this`/session-key resolution shared by
// --from-session and --memory-from-session. It sets up the RPC client lazily:
// pure local persona commands never need the app.
func personaGetSessionCard(identifier string) (*wshrpc.AgentCardResult, error) {
	if err := preRunSetupRpcClient(nil, nil); err != nil {
		return nil, err
	}
	res, err := wshclient.AgentCardGetCommand(RpcClient, wshrpc.AgentCardGetRequest{
		Identifier: identifier,
		BlockId:    personaBlockArg(),
	}, &wshrpc.RpcOpts{Timeout: 15000})
	if err != nil {
		return nil, err
	}
	return res, nil
}

// personaMemoryDraft builds the --memory-from-session draft (design §3: text
// only, the session identity is not copied). It lands in MEMORY/inbox.md.
func personaMemoryDraft() (string, error) {
	identifier := strings.TrimSpace(personaFromSession)
	if identifier == "" {
		identifier = "this"
	}
	res, err := personaGetSessionCard(identifier)
	if err != nil {
		return "", fmt.Errorf("reading the session note for --memory-from-session: %w", err)
	}
	var parts []string
	if res.Summary != nil {
		if note := strings.TrimSpace(res.Summary.Note); note != "" {
			parts = append(parts, "会话备注："+note)
		}
		if len(res.Summary.Tags) > 0 {
			parts = append(parts, "会话标签："+strings.Join(res.Summary.Tags, ", "))
		}
	}
	if title := strings.TrimSpace(res.Title); title != "" {
		parts = append(parts, "会话标题："+title)
	}
	return strings.Join(parts, "\n"), nil
}

func personaCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona create", rtnErr == nil)
	}()
	agent, err := personaResolveAgent()
	if err != nil {
		return err
	}
	opts := persona.Options{
		Root:     personaRoot,
		Name:     personaName,
		Emoji:    personaEmoji,
		Role:     personaRole,
		Provider: personaProvider,
		Model:    personaModel,
		DryRun:   !personaYes || personaDryRun,
		Agent:    agent,
	}
	if personaCharterFile != "" {
		data, err := os.ReadFile(personaCharterFile)
		if err != nil {
			return fmt.Errorf("reading --charter-file: %w", err)
		}
		opts.Charter = string(data)
	}
	if personaMemoryFromSession {
		draft, err := personaMemoryDraft()
		if err != nil {
			return err
		}
		opts.MemoryDraft = draft
	}
	res, err := persona.Create(opts)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(res)
	}
	if res.Proposal != nil {
		path := personaProposalPath(res.Proposal.Slug)
		if res.ProposalReused {
			WriteStdout("proposal %s is already pending at %s (nothing written)\n", res.Proposal.Slug, path)
			return nil
		}
		WriteStdout("proposed %s -> %s (pending human approval)\n", res.Proposal.Slug, path)
		WriteStdout("no persona home base was created; approve with:\n  wsh persona approve %s --yes\n", res.Proposal.Slug)
		return nil
	}
	if !res.Created {
		WriteStdout("persona %q already exists at %s (nothing written)\n", res.Persona.ID, res.Dir)
		return nil
	}
	if res.Applied {
		WriteStdout("created %s\n", res.Dir)
		if res.Persona.CreatedBy != nil && res.Persona.CreatedBy.Kind == "agent" {
			WriteStdout("  createdBy: agent %s (agent self-creation was confirmed with --yes)\n", res.Persona.CreatedBy.Name)
		}
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

func personaProposalPath(slug string) string {
	dir, err := persona.ProposalsPath(personaRoot)
	if err != nil {
		return "<proposals>/" + slug + ".json"
	}
	return dir + string(os.PathSeparator) + slug + ".json"
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

func personaProposeListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona propose list", rtnErr == nil)
	}()
	root, err := persona.ResolveRoot(personaRoot)
	if err != nil {
		return err
	}
	props, err := persona.ListProposals(personaRoot)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"root": root, "proposals": props})
	}
	if len(props) == 0 {
		WriteStdout("no pending persona proposals under %s\n", root)
		return nil
	}
	for _, p := range props {
		by := "unknown"
		if p.ProposedBy != nil {
			by = p.ProposedBy.Name
			if p.ProposedBy.SessionID != "" {
				by += " (" + p.ProposedBy.SessionID + ")"
			}
		}
		WriteStdout("⚡ %s | %s | proposed by %s at %s\n", p.Slug, orDash(p.Options.Role), by, p.ProposedAt)
	}
	WriteStdout("approve: wsh persona approve <slug> --yes   reject: wsh persona reject <slug> --yes\n")
	return nil
}

func personaApproveRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona approve", rtnErr == nil)
	}()
	slug := args[0]
	if !personaYes {
		return fmt.Errorf("approval is a human decision: re-run with --yes to scaffold %q", slug)
	}
	res, err := persona.Approve(personaRoot, slug, nil)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(res)
	}
	if res.Applied {
		WriteStdout("approved %s -> %s\n", slug, res.Dir)
		return nil
	}
	WriteStdout("approved %s (persona %q already existed; proposal removed)\n", slug, res.Persona.ID)
	return nil
}

func personaRejectRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona reject", rtnErr == nil)
	}()
	slug := args[0]
	if !personaYes {
		return fmt.Errorf("rejection deletes a pending proposal: re-run with --yes to reject %q", slug)
	}
	if err := persona.Reject(personaRoot, slug, nil); err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"rejected": slug})
	}
	WriteStdout("rejected %s (no persona was created)\n", slug)
	return nil
}

func personaMemoryAddRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona memory add", rtnErr == nil)
	}()
	id := args[0]
	agent, err := personaResolveAgent()
	if err != nil {
		return err
	}
	section := strings.ToLower(strings.TrimSpace(personaSection))
	// Journal is a real write (needs --yes). facts/lessons always route to
	// inbox: that is the gate, so --yes is irrelevant there.
	dryRun := personaDryRun || (section == persona.MemorySectionJournal && !personaYes)
	res, err := persona.AddMemory(personaRoot, id, section, personaText, agent, dryRun)
	if personaJSON && res != nil {
		if werr := writeJSONObj(res); werr != nil {
			return werr
		}
	} else if res != nil {
		switch {
		case res.Written:
			WriteStdout("appended to %s\n", res.Path)
		case res.Inboxed:
			WriteStdout("proposal written to %s\n", res.Path)
		case res.DryRun:
			if res.Section == persona.MemorySectionJournal {
				WriteStdout("dry-run: would append to %s\nre-run with --yes to write\n", res.Path)
			} else {
				WriteStdout("dry-run: would propose %s into %s\n", res.Section, res.Path)
			}
		}
	}
	if err != nil {
		return err
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

// ---- A5 sync runners -------------------------------------------------------

func personaSyncRoot() (string, error) {
	return persona.ResolveRoot(personaRoot)
}

func personaSyncInitRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona sync init", rtnErr == nil)
	}()
	root, err := personaSyncRoot()
	if err != nil {
		return err
	}
	status, err := persona.SyncInit(root)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"verb": "init", "status": status})
	}
	WriteStdout("persona sync repo ready: %s (clean=%v, branch=%s)\n", root, status.Clean, status.Branch)
	return nil
}

func personaSyncStatusRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona sync status", rtnErr == nil)
	}()
	root, err := personaSyncRoot()
	if err != nil {
		return err
	}
	status, err := persona.SyncStatusOf(root)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"verb": "status", "status": status})
	}
	if !status.Initialized {
		WriteStdout("not a git repo yet: %s (run `wsh persona sync init`)\n", root)
		return nil
	}
	state := "clean"
	if !status.Clean {
		state = fmt.Sprintf("%d pending change(s)", len(status.Changes))
	}
	WriteStdout("%s · %s · branch=%s remote=%s\n", root, state, orDash(status.Branch), orDash(status.Remote))
	for _, change := range status.Changes {
		WriteStdout("  %s\n", change)
	}
	for _, path := range status.Unmerged {
		WriteStdout("  ! unmerged: %s (merge journal with `wsh persona sync rebuild` after resolving)\n", path)
	}
	return nil
}

func personaSyncPullRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona sync pull", rtnErr == nil)
	}()
	root, err := personaSyncRoot()
	if err != nil {
		return err
	}
	out, err := persona.SyncPull(root)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"verb": "pull", "output": out})
	}
	WriteStdout("%s", out)
	return nil
}

func personaSyncPushRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona sync push", rtnErr == nil)
	}()
	root, err := personaSyncRoot()
	if err != nil {
		return err
	}
	out, err := persona.SyncPush(root)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"verb": "push", "output": out})
	}
	WriteStdout("%s", out)
	return nil
}

func personaSyncRebuildRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona sync rebuild", rtnErr == nil)
	}()
	root, err := personaSyncRoot()
	if err != nil {
		return err
	}
	result, err := persona.RebuildGenerated(root)
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"verb": "rebuild", "result": result})
	}
	WriteStdout("rebuilt %d generated file(s) for %d persona(s); roster: %s\n", result.Files, result.Personas, result.Roster)
	return nil
}

func personaSyncModeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("persona sync mode", rtnErr == nil)
	}()
	root, err := personaSyncRoot()
	if err != nil {
		return err
	}
	path, err := persona.SetSyncMode(root, args[0], args[1])
	if err != nil {
		return err
	}
	mode, err := persona.NormalizeSyncMode(args[1])
	if err != nil {
		return err
	}
	if personaJSON {
		return writeJSONObj(map[string]any{"verb": "mode", "id": args[0], "mode": mode, "path": path})
	}
	WriteStdout("%s sync.mode = %s (%s)\n", args[0], mode, path)
	return nil
}
