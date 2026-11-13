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
	"github.com/wavetermdev/waveterm/pkg/hero"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// wsh hero is the data foundation of the Hero system (design/plans/
// hero-system.md §3.1). It is deliberately a local, pure-filesystem
// command group: no RPC, no app dependency — the home bases must be
// inspectable even when the app is not running.
//
// Write discipline (same as wsh agent card / wsh data):
//   - dry-run by default; --yes is required for any disk write
//   - idempotent: an existing slug is returned, never overwritten
//   - --json emits one structured object, no human prose mixed in
//
// A2.5 (agent self-creation, task design §2): an agent caller — identified by
// --from-session or --agent-name — does not scaffold heroes. Without --yes
// it writes .index/proposals/<slug>.json and stops; a human approves with
// `wsh hero approve <slug> --yes`. A human caller keeps the A1 behaviour
// (dry-run preview / --yes apply).

var (
	heroJSON     bool
	heroYes      bool
	heroRoot     string
	heroDryRun   bool
	heroName     string
	heroEmoji    string
	heroRole     string
	heroProvider string
	heroModel    string

	heroFromSession       string
	heroAgentName         string
	heroBlockFlag         string
	heroCharterFile       string
	heroMemoryFromSession bool

	heroSection string
	heroText    string

	heroJournalState     string
	heroDistillUndo      bool
	heroDistillThreshold int

	heroRelocateExclude     string
	heroRelocateCopyNotMove bool
)

var heroCmd = &cobra.Command{
	Use:   "hero",
	Short: "Manage hero home bases (create/list/get/rename/propose/memory)",
	Long: `Manage hero home bases: identity, CHARTER and MEMORY on disk.

Layout (design §3.1): <rootdir>/<id>/.hero/{hero.json, CHARTER.md,
MEMORY/…, agents/} plus a root AGENTS.md pointer and a work/ area.
The roster is derived at <rootdir>/.index/HEROES.md.

Writes are dry-run unless --yes is passed. Creates are idempotent: an
existing slug is reported and left untouched.

Agents never scaffold directly: pass --from-session <key>|this (or
--agent-name <n>) and the create becomes a proposal under
.index/proposals/, pending a human ` + "`wsh hero approve <slug> --yes`" + `.`,
}

var heroCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Scaffold a hero home base (dry-run unless --yes; agent = propose)",
	Long: `Scaffold a hero home base.

The id (directory name) is derived from --name; the display name lives in
hero.json and can be changed freely. A non-ASCII name gets a deterministic
hash suffix so distinct names never collapse onto one slug.

Caller identity decides the gate (design §2):
  human (no --from-session/--agent-name)  dry-run preview; --yes applies
  agent (--from-session/--agent-name)     proposal written; --yes applies

Examples:
  wsh hero create --name "Backup Guard" --role "备份归档" --dry-run
  wsh hero create --name "Backup Guard" --emoji 🎭 --provider pi --model deepseek --yes
  wsh hero create --name "Backup Guard" --from-session this
  wsh hero create --name smoke --json --yes`,
	Args: cobra.NoArgs,
	RunE: heroCreateRun,
}

var heroListCmd = &cobra.Command{
	Use:   "list",
	Short: "List heroes from a directory scan",
	Args:  cobra.NoArgs,
	RunE:  heroListRun,
}

var heroGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Show one hero identity card and CHARTER",
	Args:  cobra.ExactArgs(1),
	RunE:  heroGetRun,
}

var heroRenameCmd = &cobra.Command{
	Use:   "rename <oldId> <newId>",
	Short: "Rename a hero id (the only legal id-change path)",
	Long: `Rename a hero id: move the directory, rewrite hero.json.id and
regenerate the roster. The display name is not touched (design §3.1:
directory name == id; display name lives in hero.json).

Dry-run by default; --yes applies the move. Refuses to overwrite an
existing target id.`,
	Args: cobra.ExactArgs(2),
	RunE: heroRenameRun,
}

var heroProposeCmd = &cobra.Command{
	Use:   "propose",
	Short: "Inspect agent proposals (pending hero creates)",
}

var heroProposeListCmd = &cobra.Command{
	Use:   "list",
	Short: "List pending hero proposals",
	Args:  cobra.NoArgs,
	RunE:  heroProposeListRun,
}

var heroApproveCmd = &cobra.Command{
	Use:   "approve <slug>",
	Short: "Approve a proposal: scaffold it and delete the proposal",
	Long: `Approve a pending agent proposal.

The scaffold keeps the agent provenance (createdBy.kind=agent) and stamps
approvedBy with the approving human. --yes is required: approval is a human
decision and must be typed out.`,
	Args: cobra.ExactArgs(1),
	RunE: heroApproveRun,
}

var heroRejectCmd = &cobra.Command{
	Use:   "reject <slug>",
	Short: "Reject a proposal: delete it, leave one journal line",
	Args:  cobra.ExactArgs(1),
	RunE:  heroRejectRun,
}

var heroMemoryCmd = &cobra.Command{
	Use:   "memory",
	Short: "Read/write hero memory (journal direct; facts/lessons via inbox)",
}

// A5 sync: the rootdir itself is the git repo. init/status/pull/push are thin
// git wrappers; rebuild regenerates the derived artifacts after a clone.
var heroSyncCmd = &cobra.Command{
	Use:   "sync",
	Short: "Cross-machine sync (rootdir git repo + generated-artifact rebuild)",
}

var heroSyncInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize the rootdir git repo and its §3.2 .gitignore",
	Args:  cobra.NoArgs,
	RunE:  heroSyncInitRun,
}

var heroSyncStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show repo state (clean / branch / remote / unmerged paths)",
	Args:  cobra.NoArgs,
	RunE:  heroSyncStatusRun,
}

var heroSyncPullCmd = &cobra.Command{
	Use:   "pull",
	Short: "git pull the rootdir repo",
	Args:  cobra.NoArgs,
	RunE:  heroSyncPullRun,
}

var heroSyncPushCmd = &cobra.Command{
	Use:   "push",
	Short: "git push the rootdir repo",
	Args:  cobra.NoArgs,
	RunE:  heroSyncPushRun,
}

var heroSyncRebuildCmd = &cobra.Command{
	Use:   "rebuild",
	Short: "Rebuild HEROES.md + generated provider contracts after a clone",
	Args:  cobra.NoArgs,
	RunE:  heroSyncRebuildRun,
}

var heroSyncModeCmd = &cobra.Command{
	Use:   "mode <id> <shared|own>",
	Short: "Set a hero's sync.mode in its (ignored) hero.local.json",
	Args:  cobra.ExactArgs(2),
	RunE:  heroSyncModeRun,
}

// A5.5: move the hero home to another disk, account for storage and rotate
// the journal by month.
var heroRelocateCmd = &cobra.Command{
	Use:   "relocate <new-root>",
	Short: "Move every hero home to a new root (dry-run unless --yes)",
	Args:  cobra.ExactArgs(1),
	RunE:  heroRelocateRun,
}

var heroStatsCmd = &cobra.Command{
	Use:   "stats [id]",
	Short: "Storage accounting: archive / history / work buckets",
	Args:  cobra.MaximumNArgs(1),
	RunE:  heroStatsRun,
}

var heroJournalRotateCmd = &cobra.Command{
	Use:   "rotate <id>",
	Short: "Rotate journal lines from earlier months into MEMORY/archive/YYYY-MM.md",
	Args:  cobra.ExactArgs(1),
	RunE:  heroJournalRotateRun,
}

// A6: shift journal, human-gated inbox decisions and memory distillation.
var heroJournalCmd = &cobra.Command{
	Use:   "journal",
	Short: "Shift journal (append-only, machine-owned)",
}

var heroJournalAppendCmd = &cobra.Command{
	Use:   "append <id>",
	Short: "Append one shift-journal line (needs --yes)",
	Args:  cobra.ExactArgs(1),
	RunE:  heroJournalAppendRun,
}

var heroMemoryInboxCmd = &cobra.Command{
	Use:   "inbox <id>",
	Short: "List pending / approved / dismissed memory proposals",
	Args:  cobra.ExactArgs(1),
	RunE:  heroMemoryInboxRun,
}

var heroMemoryApproveCmd = &cobra.Command{
	Use:   "approve <id> <stamp>",
	Short: "Human approval: append the proposal to long-term memory (needs --yes)",
	Args:  cobra.ExactArgs(2),
	RunE:  heroMemoryApproveRun,
}

var heroMemoryRejectCmd = &cobra.Command{
	Use:   "reject <id> <stamp>",
	Short: "Dismiss a proposal but keep it for audit (needs --yes)",
	Args:  cobra.ExactArgs(2),
	RunE:  heroMemoryRejectRun,
}

var heroDistillCmd = &cobra.Command{
	Use:   "distill <id>",
	Short: "De-duplicate long-term memory and refresh the TL;DR (--dry-run|--yes|--undo)",
	Args:  cobra.ExactArgs(1),
	RunE:  heroDistillRun,
}

var heroMemoryAddCmd = &cobra.Command{
	Use:   "add <id>",
	Short: "Append memory (journal direct; facts/lessons become inbox proposals)",
	Long: `Append one memory entry to a hero.

Memory discipline (design §4.5 / §6):
  journal          appended directly (timestamped line; needs --yes)
  facts / lessons  ALWAYS routed to MEMORY/inbox.md as a proposal and the
                   command exits 1 — agents may not write long-term memory,
                   and --yes does not change that (that is the gate).

Examples:
  wsh hero memory add smoke --section journal --text "完毕" --yes
  wsh hero memory add smoke --section lessons --text "..." --from-session this`,
	Args: cobra.ExactArgs(1),
	RunE: heroMemoryAddRun,
}

func init() {
	heroCreateCmd.Flags().BoolVar(&heroDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	heroCreateCmd.Flags().StringVar(&heroName, "name", "", "display name (the id is derived from it)")
	heroCreateCmd.Flags().StringVar(&heroEmoji, "emoji", "", "emoji shown in the roster line")
	heroCreateCmd.Flags().StringVar(&heroRole, "role", "", "one-line duty, rendered into the roster L0 line")
	heroCreateCmd.Flags().StringVar(&heroProvider, "provider", "", "default agent provider")
	heroCreateCmd.Flags().StringVar(&heroModel, "model", "", "default model")
	heroCreateCmd.Flags().StringVar(&heroFromSession, "from-session", "", "agent session key (or 'this' to resolve the calling block); makes the caller an agent")
	heroCreateCmd.Flags().StringVar(&heroAgentName, "agent-name", "", "agent name when no session key is available; makes the caller an agent")
	heroCreateCmd.Flags().StringVar(&heroCharterFile, "charter-file", "", "use this file's text as the CHARTER.md draft (written on scaffold, stored in the proposal)")
	heroCreateCmd.Flags().BoolVar(&heroMemoryFromSession, "memory-from-session", false, "use the calling session's note/tags as a MEMORY/inbox.md draft")
	heroCreateCmd.Flags().StringVar(&heroBlockFlag, "block", "", "block id for --from-session this (defaults to WAVETERM_BLOCKID)")
	heroCmd.PersistentPreRunE = func(cmd *cobra.Command, args []string) error {
		if strings.TrimSpace(heroRoot) == "" && strings.TrimSpace(os.Getenv(hero.EnvRoot)) == "" {
			heroRoot = heroRootFromSettings()
		}
		return nil
	}
	heroCmd.PersistentFlags().BoolVar(&heroJSON, "json", false, "output as JSON")
	heroCmd.PersistentFlags().BoolVar(&heroYes, "yes", false, "apply writes (default is dry-run)")
	heroCmd.PersistentFlags().StringVar(&heroRoot, "root", "", "hero root dir (default ~/.snorkeling/heroes, override with HERO_ROOT)")
	heroRenameCmd.Flags().BoolVar(&heroDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	heroMemoryAddCmd.Flags().StringVar(&heroSection, "section", "", "memory section: facts | lessons | journal")
	heroMemoryAddCmd.Flags().StringVar(&heroText, "text", "", "the memory text")
	heroMemoryAddCmd.Flags().StringVar(&heroFromSession, "from-session", "", "record this agent session as the source (or 'this')")
	heroMemoryAddCmd.Flags().StringVar(&heroAgentName, "agent-name", "", "record this agent name as the source")
	heroMemoryAddCmd.Flags().StringVar(&heroBlockFlag, "block", "", "block id for --from-session this (defaults to WAVETERM_BLOCKID)")
	heroMemoryAddCmd.Flags().BoolVar(&heroDryRun, "dry-run", false, "explicitly force a preview and write nothing")
	heroJournalAppendCmd.Flags().StringVar(&heroJournalState, "state", "done", "shift state: working|blocked|done|stale")
	heroJournalAppendCmd.Flags().StringVar(&heroText, "text", "", "one-line shift summary")
	heroJournalAppendCmd.Flags().StringVar(&heroFromSession, "from-session", "", "record this agent session as the source (or 'this')")
	heroJournalAppendCmd.Flags().StringVar(&heroAgentName, "agent-name", "", "record this agent name as the source")
	heroJournalAppendCmd.Flags().StringVar(&heroBlockFlag, "block", "", "block id for --from-session this")
	heroDistillCmd.Flags().BoolVar(&heroDryRun, "dry-run", false, "preview the diff without writing")
	heroDistillCmd.Flags().BoolVar(&heroDistillUndo, "undo", false, "restore the most recent distill backup")
	heroDistillCmd.Flags().IntVar(&heroDistillThreshold, "threshold", 0, "entry count that triggers distillation (default 20)")
	heroRelocateCmd.Flags().StringVar(&heroRelocateExclude, "exclude", "", "comma-separated hero ids that stay behind")
	heroRelocateCmd.Flags().BoolVar(&heroRelocateCopyNotMove, "copy-not-move", false, "keep a copy at the old root (insurance)")
	heroRelocateCmd.Flags().BoolVar(&heroDryRun, "dry-run", false, "explicitly force a preview (writes already default to dry-run)")
	heroProposeCmd.AddCommand(heroProposeListCmd)
	heroCmd.AddCommand(heroCreateCmd, heroListCmd, heroGetCmd, heroRenameCmd,
		heroProposeCmd, heroApproveCmd, heroRejectCmd, heroMemoryCmd, heroSyncCmd)
	heroSyncCmd.AddCommand(heroSyncInitCmd, heroSyncStatusCmd, heroSyncPullCmd,
		heroSyncPushCmd, heroSyncRebuildCmd, heroSyncModeCmd)
	heroJournalCmd.AddCommand(heroJournalAppendCmd, heroJournalRotateCmd)
	heroMemoryCmd.AddCommand(heroMemoryAddCmd, heroMemoryInboxCmd, heroMemoryApproveCmd, heroMemoryRejectCmd)
	heroCmd.AddCommand(heroJournalCmd, heroDistillCmd, heroRelocateCmd, heroStatsCmd)
	rootCmd.AddCommand(heroCmd)
}

// heroResolveAgent turns the CLI identity flags into an agent provenance.
// It returns (nil, nil) for a pure human caller. `--from-session this` needs
// the app (RPC); every other value is used literally.
func heroResolveAgent() (*hero.Provenance, error) {
	from := strings.TrimSpace(heroFromSession)
	name := strings.TrimSpace(heroAgentName)
	if from == "" {
		if name == "" {
			return nil, nil // human path: A1 behaviour unchanged
		}
		return &hero.Provenance{Kind: "agent", Name: name}, nil
	}
	sessionID := from
	if from == "this" {
		res, err := heroGetSessionCard("this")
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
	return &hero.Provenance{Kind: "agent", Name: name, SessionID: sessionID}, nil
}

func heroBlockArg() string {
	if strings.TrimSpace(heroBlockFlag) != "" {
		return strings.TrimSpace(heroBlockFlag)
	}
	return strings.TrimSpace(os.Getenv("WAVETERM_BLOCKID"))
}

// heroGetSessionCard is the `this`/session-key resolution shared by
// --from-session and --memory-from-session. It sets up the RPC client lazily:
// pure local hero commands never need the app.
func heroGetSessionCard(identifier string) (*wshrpc.AgentCardResult, error) {
	if err := preRunSetupRpcClient(nil, nil); err != nil {
		return nil, err
	}
	res, err := wshclient.AgentCardGetCommand(RpcClient, wshrpc.AgentCardGetRequest{
		Identifier: identifier,
		BlockId:    heroBlockArg(),
	}, &wshrpc.RpcOpts{Timeout: 15000})
	if err != nil {
		return nil, err
	}
	return res, nil
}

// heroMemoryDraft builds the --memory-from-session draft (design §3: text
// only, the session identity is not copied). It lands in MEMORY/inbox.md.
func heroMemoryDraft() (string, error) {
	identifier := strings.TrimSpace(heroFromSession)
	if identifier == "" {
		identifier = "this"
	}
	res, err := heroGetSessionCard(identifier)
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

func heroCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero create", rtnErr == nil)
	}()
	agent, err := heroResolveAgent()
	if err != nil {
		return err
	}
	opts := hero.Options{
		Root:     heroRoot,
		Name:     heroName,
		Emoji:    heroEmoji,
		Role:     heroRole,
		Provider: heroProvider,
		Model:    heroModel,
		DryRun:   !heroYes || heroDryRun,
		Agent:    agent,
	}
	if heroCharterFile != "" {
		data, err := os.ReadFile(heroCharterFile)
		if err != nil {
			return fmt.Errorf("reading --charter-file: %w", err)
		}
		opts.Charter = string(data)
	}
	if heroMemoryFromSession {
		draft, err := heroMemoryDraft()
		if err != nil {
			return err
		}
		opts.MemoryDraft = draft
	}
	res, err := hero.Create(opts)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(res)
	}
	if res.Proposal != nil {
		path := heroProposalPath(res.Proposal.Slug)
		if res.ProposalReused {
			WriteStdout("proposal %s is already pending at %s (nothing written)\n", res.Proposal.Slug, path)
			return nil
		}
		WriteStdout("proposed %s -> %s (pending human approval)\n", res.Proposal.Slug, path)
		WriteStdout("no hero home base was created; approve with:\n  wsh hero approve %s --yes\n", res.Proposal.Slug)
		return nil
	}
	if !res.Created {
		WriteStdout("hero %q already exists at %s (nothing written)\n", res.Hero.ID, res.Dir)
		return nil
	}
	if res.Applied {
		WriteStdout("created %s\n", res.Dir)
		if res.Hero.CreatedBy != nil && res.Hero.CreatedBy.Kind == "agent" {
			WriteStdout("  createdBy: agent %s (agent self-creation was confirmed with --yes)\n", res.Hero.CreatedBy.Name)
		}
	} else {
		WriteStdout("dry-run: would create %s\n", res.Dir)
	}
	WriteStdout("  %d files, e.g.:\n", len(res.Files))
	for _, f := range res.Files {
		WriteStdout("    %s\n", strings.TrimPrefix(f.Path, res.Dir+string(os.PathSeparator)))
	}
	if !heroYes {
		WriteStdout("re-run with --yes to write these files\n")
	}
	return nil
}

func heroProposalPath(slug string) string {
	dir, err := hero.ProposalsPath(heroRoot)
	if err != nil {
		return "<proposals>/" + slug + ".json"
	}
	return dir + string(os.PathSeparator) + slug + ".json"
}

func heroListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero list", rtnErr == nil)
	}()
	root, err := hero.ResolveRoot(heroRootFlagValue())
	if err != nil {
		return err
	}
	heroes, err := hero.List(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"root": root, "heroes": heroes})
	}
	if len(heroes) == 0 {
		WriteStdout("no heroes under %s\n", root)
		return nil
	}
	for _, p := range heroes {
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

func rosterIDCellCLI(p hero.Hero) string {
	if p.Emoji != "" {
		return p.Emoji + " " + p.ID
	}
	return p.ID
}

func heroGetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero get", rtnErr == nil)
	}()
	id := args[0]
	p, charter, err := hero.Get(heroRoot, id)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"hero": p, "charter": charter})
	}
	barr, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(barr))
	WriteStdout("--- CHARTER.md ---\n%s\n", charter)
	return nil
}

func heroRenameRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero rename", rtnErr == nil)
	}()
	oldID, newID := args[0], args[1]
	res, err := hero.Rename(heroRoot, oldID, newID, !heroYes || heroDryRun)
	if err != nil {
		if errors.Is(err, hero.ErrNotFound) {
			return fmt.Errorf("no hero %q (use `wsh hero list`)", oldID)
		}
		return err
	}
	if heroJSON {
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

func heroProposeListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero propose list", rtnErr == nil)
	}()
	root, err := hero.ResolveRoot(heroRootFlagValue())
	if err != nil {
		return err
	}
	props, err := hero.ListProposals(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"root": root, "proposals": props})
	}
	if len(props) == 0 {
		WriteStdout("no pending hero proposals under %s\n", root)
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
	WriteStdout("approve: wsh hero approve <slug> --yes   reject: wsh hero reject <slug> --yes\n")
	return nil
}

func heroApproveRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero approve", rtnErr == nil)
	}()
	slug := args[0]
	if !heroYes {
		return fmt.Errorf("approval is a human decision: re-run with --yes to scaffold %q", slug)
	}
	res, err := hero.Approve(heroRoot, slug, nil)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(res)
	}
	if res.Applied {
		WriteStdout("approved %s -> %s\n", slug, res.Dir)
		return nil
	}
	WriteStdout("approved %s (hero %q already existed; proposal removed)\n", slug, res.Hero.ID)
	return nil
}

func heroRejectRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero reject", rtnErr == nil)
	}()
	slug := args[0]
	if !heroYes {
		return fmt.Errorf("rejection deletes a pending proposal: re-run with --yes to reject %q", slug)
	}
	if err := hero.Reject(heroRoot, slug, nil); err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"rejected": slug})
	}
	WriteStdout("rejected %s (no hero was created)\n", slug)
	return nil
}

func heroMemoryAddRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero memory add", rtnErr == nil)
	}()
	id := args[0]
	agent, err := heroResolveAgent()
	if err != nil {
		return err
	}
	section := strings.ToLower(strings.TrimSpace(heroSection))
	// Journal is a real write (needs --yes). facts/lessons always route to
	// inbox: that is the gate, so --yes is irrelevant there.
	dryRun := heroDryRun || (section == hero.MemorySectionJournal && !heroYes)
	res, err := hero.AddMemory(heroRoot, id, section, heroText, agent, dryRun)
	if heroJSON && res != nil {
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
			if res.Section == hero.MemorySectionJournal {
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

// heroRootFromSettings reads settings.json's hero:rootdir without needing
// the app (A5.5). Empty means "fall through to the A1 default".
func heroRootFromSettings() string {
	m, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.SettingsFile)
	if len(cerrs) > 0 {
		return ""
	}
	raw, ok := m["hero:rootdir"]
	if !ok {
		return ""
	}
	str, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(str)
}

// heroRootFlagValue resolves the root for CLI calls: --root > HERO_ROOT >
// settings.json hero:rootdir > A1 default. The explicit value is returned so
// hero.ResolveRoot can apply its own expansion rules.
func heroRootFlagValue() string {
	if strings.TrimSpace(heroRoot) != "" {
		return heroRoot
	}
	if strings.TrimSpace(os.Getenv(hero.EnvRoot)) != "" {
		return ""
	}
	return heroRootFromSettings()
}

// writeHeroRootSetting merges hero:rootdir into settings.json through the
// validated config path (never a raw file rewrite).
func writeHeroRootSetting(root string) error {
	return wconfig.SetBaseConfigValue(waveobj.MetaMapType{"hero:rootdir": root})
}

// ---- A5 sync runners -------------------------------------------------------

func heroSyncRoot() (string, error) {
	return hero.ResolveRoot(heroRootFlagValue())
}

func heroSyncInitRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero sync init", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	status, err := hero.SyncInit(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"verb": "init", "status": status})
	}
	WriteStdout("hero sync repo ready: %s (clean=%v, branch=%s)\n", root, status.Clean, status.Branch)
	return nil
}

func heroSyncStatusRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero sync status", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	status, err := hero.SyncStatusOf(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"verb": "status", "status": status})
	}
	if !status.Initialized {
		WriteStdout("not a git repo yet: %s (run `wsh hero sync init`)\n", root)
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
		WriteStdout("  ! unmerged: %s (merge journal with `wsh hero sync rebuild` after resolving)\n", path)
	}
	return nil
}

func heroSyncPullRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero sync pull", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	out, err := hero.SyncPull(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"verb": "pull", "output": out})
	}
	WriteStdout("%s", out)
	return nil
}

func heroSyncPushRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero sync push", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	out, err := hero.SyncPush(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"verb": "push", "output": out})
	}
	WriteStdout("%s", out)
	return nil
}

func heroSyncRebuildRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero sync rebuild", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	result, err := hero.RebuildGenerated(root)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"verb": "rebuild", "result": result})
	}
	WriteStdout("rebuilt %d generated file(s) for %d hero(s); roster: %s\n", result.Files, result.Heroes, result.Roster)
	return nil
}

func heroSyncModeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero sync mode", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	path, err := hero.SetSyncMode(root, args[0], args[1])
	if err != nil {
		return err
	}
	mode, err := hero.NormalizeSyncMode(args[1])
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"verb": "mode", "id": args[0], "mode": mode, "path": path})
	}
	WriteStdout("%s sync.mode = %s (%s)\n", args[0], mode, path)
	return nil
}

// ---- A6 journal / inbox / distill runners ---------------------------------

func heroJournalAppendRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero journal append", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	agent, err := heroResolveAgent()
	if err != nil {
		return err
	}
	if strings.TrimSpace(heroText) == "" {
		return fmt.Errorf("--text is required")
	}
	entry := hero.JournalEntry{
		State:   heroJournalState,
		Summary: heroText,
		Source:  hero.SourceLabel(agent),
	}
	if !heroYes {
		if heroJSON {
			return writeJSONObj(map[string]any{"dryRun": true, "id": args[0], "state": entry.State, "text": entry.Summary, "source": entry.Source})
		}
		WriteStdout("dry-run: would append journal line for %s (--yes to write)\n", args[0])
		return nil
	}
	result, err := hero.AppendJournal(root, args[0], entry)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"result": result})
	}
	WriteStdout("appended: %s", result.Line)
	return nil
}

func heroMemoryInboxRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero memory inbox", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	items, err := hero.ListInbox(root, args[0])
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"id": args[0], "items": items})
	}
	if len(items) == 0 {
		WriteStdout("no memory proposals for %s\n", args[0])
		return nil
	}
	for _, item := range items {
		WriteStdout("%s [%s] %s → %s: %s\n", item.Stamp, item.Status, item.Section, item.Target, item.Content)
	}
	return nil
}

func heroMemoryApproveRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero memory approve", rtnErr == nil)
	}()
	if !heroYes {
		return fmt.Errorf("approval is a human decision: pass --yes to apply")
	}
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	result, err := hero.ApproveInbox(root, args[0], args[1], nil)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"result": result})
	}
	WriteStdout("%s: %s → %s (changed=%v)\n", result.Stamp, result.Status, result.Target, result.Changed)
	return nil
}

func heroMemoryRejectRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero memory reject", rtnErr == nil)
	}()
	if !heroYes {
		return fmt.Errorf("rejection is a human decision: pass --yes to apply")
	}
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	result, err := hero.DismissInbox(root, args[0], args[1])
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"result": result})
	}
	WriteStdout("%s: %s (changed=%v)\n", result.Stamp, result.Status, result.Changed)
	return nil
}

func heroDistillRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero distill", rtnErr == nil)
	}()
	root, err := heroSyncRoot()
	if err != nil {
		return err
	}
	if heroDistillUndo {
		if !heroYes {
			return fmt.Errorf("--undo writes files: pass --yes to apply")
		}
		path, err := hero.UndoDistill(root, args[0])
		if err != nil {
			return err
		}
		if heroJSON {
			return writeJSONObj(map[string]any{"undo": path})
		}
		WriteStdout("restored from %s\n", path)
		return nil
	}
	dryRun := !heroYes || heroDryRun
	result, err := hero.Distill(root, args[0], hero.DistillOptions{
		Threshold: heroDistillThreshold,
		DryRun:    dryRun,
	})
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"result": result})
	}
	WriteStdout("distill %s: %d → %d entries (removed %d, TL;DR %d) dryRun=%v backup=%s\n",
		result.ID, result.Before, result.After, result.Removed, result.TLDR, result.DryRun, orDash(result.Backup))
	return nil
}

// ---- A5.5 relocate / stats / rotation runners -----------------------------

func heroRelocateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero relocate", rtnErr == nil)
	}()
	root, err := hero.ResolveRoot(heroRootFlagValue())
	if err != nil {
		return err
	}
	exclude := []string{}
	for _, id := range strings.Split(heroRelocateExclude, ",") {
		if strings.TrimSpace(id) != "" {
			exclude = append(exclude, strings.TrimSpace(id))
		}
	}
	opts := hero.RelocateOptions{
		DryRun:      !heroYes || heroDryRun,
		Exclude:     exclude,
		CopyNotMove: heroRelocateCopyNotMove,
	}
	result, err := hero.Relocate(root, args[0], opts)
	if err != nil {
		return err
	}
	if !opts.DryRun {
		// The new root only becomes the configured home after a verified move;
		// a failed relocation leaves settings untouched. When HERO_ROOT is set
		// the caller is deliberately overriding the config (tests / sandboxes),
		// so settings.json is left alone.
		if strings.TrimSpace(os.Getenv(hero.EnvRoot)) == "" {
			if err := writeHeroRootSetting(result.Plan.To); err != nil {
				return fmt.Errorf("relocation succeeded but settings.json was not updated: %w", err)
			}
		}
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"result": result})
	}
	WriteStdout("relocate %s → %s: %d hero(s), %d file(s), %d byte(s)\n",
		result.Plan.From, result.Plan.To, len(result.Plan.Entries), result.Plan.Files, result.Plan.Bytes)
	if len(result.Plan.Excluded) > 0 {
		WriteStdout("  excluded: %s\n", strings.Join(result.Plan.Excluded, ", "))
	}
	if opts.DryRun {
		WriteStdout("dry-run: nothing moved (--yes to apply)\n")
		return nil
	}
	WriteStdout("moved and verified; settings hero:rootdir updated\n")
	return nil
}

func heroStatsRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero stats", rtnErr == nil)
	}()
	root, err := hero.ResolveRoot(heroRootFlagValue())
	if err != nil {
		return err
	}
	var ids []string
	if len(args) == 1 {
		ids = []string{args[0]}
	} else {
		heroes, err := hero.List(root)
		if err != nil {
			return err
		}
		for _, p := range heroes {
			ids = append(ids, p.ID)
		}
	}
	stats := make([]*hero.StorageStats, 0, len(ids))
	for _, id := range ids {
		one, err := hero.StorageOf(root, id)
		if err != nil {
			return err
		}
		stats = append(stats, one)
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"root": root, "heroes": stats})
	}
	for _, one := range stats {
		WriteStdout("%s: archive %d B / history %d B / work %d B (syncable %d B, total %d B)\n",
			one.ID, one.ArchiveBytes, one.HistoryBytes, one.WorkBytes, one.SyncableBytes, one.TotalBytes)
	}
	return nil
}

func heroJournalRotateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("hero journal rotate", rtnErr == nil)
	}()
	root, err := hero.ResolveRoot(heroRootFlagValue())
	if err != nil {
		return err
	}
	if !heroYes {
		rotated, _, err := hero.RotateJournal(root, args[0], nil)
		if err != nil {
			return err
		}
		if heroJSON {
			return writeJSONObj(map[string]any{"dryRun": true, "id": args[0], "rotated": rotated})
		}
		WriteStdout("dry-run: %d line(s) would rotate (--yes to apply)\n", rotated)
		return nil
	}
	rotated, archive, err := hero.RotateJournal(root, args[0], nil)
	if err != nil {
		return err
	}
	if heroJSON {
		return writeJSONObj(map[string]any{"id": args[0], "rotated": rotated, "archive": archive})
	}
	WriteStdout("rotated %d line(s) → %s\n", rotated, archive)
	return nil
}
