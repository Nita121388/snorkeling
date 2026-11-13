// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentguide is the single source of truth for the external control
// surface: which commands exist, which scope each one needs, and what each is
// for.
//
// Two renderings come out of the same table — `wsh agent guide` (terminal /
// JSON) and the skill document shipped to agents. If they were written by hand
// in two places they would drift the first time a flag changed, and the agent
// reading the skill would call a command that no longer exists. The test in
// pkg/agentskill fails when the shipped skill stops matching this table.
package agentguide

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Version tracks the shape of this guide, not the app version.
const Version = 1

// Command describes one control-surface command.
type Command struct {
	// Cmd is the CLI invocation without the leading "wsh".
	Cmd string `json:"cmd"`
	// Scope is the minimum scope that permits it (observe < navigate < data).
	Scope string `json:"scope"`
	// Summary is one line, imperative, describing what it answers or does.
	Summary string `json:"summary"`
	// Flags are the flags that matter for agents (not exhaustive help output).
	Flags []string `json:"flags,omitempty"`
	// Notes carries the honest caveats (what a result does NOT mean).
	Notes []string `json:"notes,omitempty"`
}

// Commands is the authoritative list, in teaching order: observe first, then
// navigate, then data, then administration.
func Commands() []Command {
	return []Command{
		{
			Cmd:     "ui active",
			Scope:   "observe",
			Summary: "Where the calling block is versus where the user is looking.",
			Flags:   []string{"--json"},
			Notes: []string{
				"Returns two objects: self (you) and active (the user). They usually differ.",
				"Prefer this over `ui state` for polling: it is a few hundred bytes.",
			},
		},
		{
			Cmd:     "ui state",
			Scope:   "observe",
			Summary: "Backend snapshot of windows, tabs, blocks and their runtime state.",
			Flags:   []string{"--json"},
			Notes:   []string{"Large. Do not poll it; use `ui active`."},
		},
		{
			Cmd:     "block read",
			Scope:   "observe",
			Summary: "Bounded content of one block, by view type.",
			Flags:   []string{"<block|this>", "--tail N", "--max-bytes N", "--json"},
			Notes: []string{
				"A missing source is null, not an absent key.",
				"Check payload.warning: term-route-unavailable and remote-file-unsupported mean the read degraded.",
				"truncated: true means you hit --max-bytes.",
			},
		},
		{
			Cmd:     "session live",
			Scope:   "observe",
			Summary: "Every running agent session (TUI and GUI chat).",
			Flags:   []string{"--include-idle", "--max-rows N", "--json"},
			Notes:   []string{"issue.freshness == \"stale\" means the state is old, not that it is running now."},
		},
		{
			Cmd:     "session get",
			Scope:   "observe",
			Summary: "One session: live state plus card summary and hash.",
			Flags:   []string{"<key|id|this>", "--json"},
		},
		{
			Cmd:     "session list",
			Scope:   "observe",
			Summary: "Indexed sessions with filters.",
			Flags:   []string{"--source", "--query", "--tag", "--project", "--limit", "--json"},
		},
		{
			Cmd:     "session for-block",
			Scope:   "observe",
			Summary: "Which session a block is bound to.",
			Flags:   []string{"[<blockid|this>]", "--json"},
		},
		{
			Cmd:     "tab list",
			Scope:   "observe",
			Summary: "Tabs in a workspace, marking the active one.",
			Flags:   []string{"--workspace", "--json"},
		},
		{
			Cmd:     "agent card get",
			Scope:   "observe",
			Summary: "Title, note, tags and props of a session card, plus its hash.",
			Flags:   []string{"<key|id|this>", "--json"},
			Notes:   []string{"The hash is required to write: pass it back as --expected-hash."},
		},
		{
			Cmd:     "hero list",
			Scope:   "observe",
			Summary: "Every hero home base on this machine, from a directory scan.",
			Flags:   []string{"--json"},
			Notes:   []string{"Reads plain files; works even when the app is not running."},
		},
		{
			Cmd:     "hero get",
			Scope:   "observe",
			Summary: "One hero identity card (hero.json) and its CHARTER.",
			Flags:   []string{"<id>", "--json"},
		},
		{
			Cmd:     "hero memory inbox",
			Scope:   "observe",
			Summary: "List pending / approved / dismissed long-term-memory proposals.",
			Flags:   []string{"<id>", "--json"},
			Notes:   []string{"Old proposal blocks without a 状态 line are parsed as pending."},
		},
		{
			Cmd:     "hero sync status",
			Scope:   "observe",
			Summary: "Rootdir git state: clean, branch, remote and unmerged paths.",
			Flags:   []string{"--json"},
			Notes:   []string{"A bare rootdir reports initialized=false; it is a valid state, not an error."},
		},
		{
			Cmd:     "block open",
			Scope:   "navigate",
			Summary: "Open a block: file, url, terminal, preview or agent view.",
			Flags: []string{
				"--view <term|web|preview|edit|agent>", "--tab active|new|<id>",
				"--split right|down|left|up", "--replace <blockid>", "--dedupe",
				"--magnified", "--no-focus", "--wait", "--file", "--url", "--cwd", "--conn", "--meta k=v", "--json",
			},
			Notes: []string{
				"--split and --replace are mutually exclusive.",
				"syncState: db-only = written; layout-queued = written but NOT drawn yet; layout-applied = on screen.",
				"Never report a block as open on layout-queued.",
			},
		},
		{
			Cmd:     "tab create",
			Scope:   "navigate",
			Summary: "Create a tab (optionally activate it).",
			Flags:   []string{"--name", "--activate", "--wait", "--json"},
		},
		{
			Cmd:     "tab activate",
			Scope:   "navigate",
			Summary: "Switch to a tab and confirm the backend agrees.",
			Flags:   []string{"<tabid>", "--wait", "--json"},
		},
		{
			Cmd:     "agent card set",
			Scope:   "data",
			Summary: "Update a session card: title, note, tags, props.",
			Flags: []string{
				"--note", "--title", "--tags-add", "--tags-set", "--tags-remove",
				"--prop k=type:v", "--force", "--dry-run", "--yes", "--expected-hash <h>",
			},
			Notes: []string{
				"Dry-run unless --yes, and a real write needs --expected-hash from a fresh get.",
				"E_CONFLICT means someone else edited: re-read, do not pass --force.",
				"titleSource=user is refused without --force.",
			},
		},
		{
			Cmd:     "hero create",
			Scope:   "data",
			Summary: "Propose a new hero home base (agents never scaffold directly).",
			Flags: []string{
				"--name", "--emoji", "--role", "--provider", "--model",
				"--from-session <key|this>", "--agent-name", "--charter-file",
				"--memory-from-session", "--dry-run", "--yes", "--json",
			},
			Notes: []string{
				"With --from-session/--agent-name and no --yes this writes .index/proposals/<slug>.json, not a hero: a human must run `hero approve <slug> --yes`.",
				"Idempotent: an existing slug is reused; a pending identical proposal is read back.",
				"Quota: 2 proposals per agent session per UTC day; the 3rd fails with zero writes.",
			},
		},
		{
			Cmd:     "hero memory add",
			Scope:   "data",
			Summary: "Append hero memory: journal directly, facts/lessons as inbox proposals.",
			Flags:   []string{"<id>", "--section facts|lessons|journal", "--text", "--from-session <key|this>", "--agent-name", "--yes", "--json"},
			Notes: []string{
				"journal needs --yes; facts/lessons always land in MEMORY/inbox.md and exit 1 — --yes does not override that.",
				"Never write facts.md/lessons.md/CHARTER.md directly; propose through inbox.md.",
			},
		},
		{
			Cmd:     "hero journal append",
			Scope:   "data",
			Summary: "Append one shift-journal line (timestamp + state + summary + source).",
			Flags:   []string{"<id>", "--text", "--state working|blocked|done|stale", "--from-session <key|this>", "--agent-name", "--yes", "--json"},
			Notes:   []string{"Dry-run unless --yes; the journal is the last-active proxy for the 💤 dormant marker."},
		},
		{
			Cmd:     "hero memory approve",
			Scope:   "data",
			Summary: "Human gate: append a pending proposal to facts/lessons/CHARTER and audit it in the journal.",
			Flags:   []string{"<id>", "<stamp>", "--yes", "--json"},
			Notes:   []string{"--yes is mandatory: agents may propose, never approve.", "Idempotent: approving twice never duplicates the fact.", "hero memory reject keeps the proposal marked dismissed for audit."},
		},
		{
			Cmd:     "hero distill",
			Scope:   "data",
			Summary: "De-duplicate facts/lessons, refresh the ≤5-entry TL;DR, and back up for --undo.",
			Flags:   []string{"<id>", "--threshold", "--dry-run", "--yes", "--undo", "--json"},
			Notes:   []string{"Below the threshold with no duplicates it is a byte-for-byte no-op.", "--undo restores the exact previous bytes from MEMORY/archive/.distill-backup-*.json."},
		},
		{
			Cmd:     "hero sync init",
			Scope:   "data",
			Summary: "Initialize the rootdir git repo with the §3.2 .gitignore and an initial archive commit.",
			Flags:   []string{"--json"},
			Notes:   []string{"Only the first init commits; later calls never commit in-flight user edits."},
		},
		{
			Cmd:     "hero sync rebuild",
			Scope:   "data",
			Summary: "After a clone, rebuild HEROES.md and generated provider contracts.",
			Flags:   []string{"--json"},
			Notes:   []string{"Writes only GENERATED files; CHARTER / MEMORY / hero.json are never touched."},
		},
		{
			Cmd:     "hero sync pull|push",
			Scope:   "data",
			Summary: "git pull / git push the rootdir repo (remote must be configured by a human).",
			Flags:   []string{"--json"},
			Notes:   []string{"A missing remote surfaces git's own error; it is never swallowed.", "work/, *.local.json, agents/, AGENTS.md and .index/ are ignored and never leave the machine."},
		},
		{
			Cmd:     "hero approve",
			Scope:   "data",
			Summary: "Approve a pending hero proposal and scaffold it.",
			Flags:   []string{"<slug>", "--yes", "--json"},
			Notes: []string{
				"--yes is mandatory: approval is a human decision.",
				"createdBy keeps the agent identity; approvedBy records the human.",
			},
		},
		{
			Cmd:     "auth grant",
			Scope:   "in-app only",
			Summary: "Mint a short-lived scoped token for a process outside the app.",
			Flags:   []string{"--name", "--scope observe,navigate,data", "--ttl 30m", "--out <file>"},
			Notes: []string{
				"Run inside a Snorkeling block: the app embeds your socket, so the token can only point back here.",
				"The file is written 0600 and the token is never printed.",
				"Default TTL 30m, maximum 24h. destructive is never granted.",
			},
		},
		{
			Cmd:     "auth list",
			Scope:   "in-app only",
			Summary: "List granted tokens (never the token itself).",
			Flags:   []string{"--all", "--json"},
		},
		{
			Cmd:     "auth revoke",
			Scope:   "in-app only",
			Summary: "Revoke by name, jti prefix, or everything.",
			Flags:   []string{"--name", "--jti", "--all"},
			Notes:   []string{"Takes effect on the token's next call."},
		},
		{
			Cmd:     "mcp serve",
			Scope:   "in-app only",
			Summary: "Serve the surface as MCP tools over stdio.",
			Flags:   []string{"--stdio", "--token-file <file>"},
			Notes:   []string{"stdio only: no listener is opened."},
		},
		{
			Cmd:     "agent install-skill",
			Scope:   "in-app only",
			Summary: "Install the bundled skill into local agent directories.",
			Flags:   []string{"--root <dir>", "--dry-run", "--json"},
		},
		{
			Cmd:     "agent mcp-config",
			Scope:   "in-app only",
			Summary: "Print the MCP server entry for a host.",
			Flags:   []string{"--host claude|cursor|codex", "--out <file>"},
			Notes:   []string{"The token goes in env, never in args."},
		},
	}
}

// Errors are the stable codes an agent should branch on.
func Errors() []struct{ Code, Meaning string } {
	return []struct{ Code, Meaning string }{
		{"E_USAGE", "bad arguments"},
		{"E_NOT_FOUND", "no such block / session / token"},
		{"E_CONFLICT", "someone else changed it; re-read"},
		{"E_FORBIDDEN", "scope too low, or rate limited (60/min per token)"},
		{"E_UNSUPPORTED", "this view cannot do that"},
		{"E_NO_ROUTE", "no backend route; usually not inside the app"},
		{"E_TIMEOUT", "the app did not answer in time"},
		{"E_INTERNAL", "bug; report it"},
		{"E_UNAUTHORIZED", "token revoked or expired; ask for a new one"},
	}
}

// RedLines are the behaviours that must not happen. They are stated in the
// guide and in the skill from this one list.
func RedLines() []string {
	return []string{
		"Never write a token into a skill file, script, repo, or commit.",
		"Dangerous operations go dry-run → ask → apply.",
		"Do not poll. Prefer `ui active`; a token is rate limited to 60 calls/minute.",
		"If the token is missing, stop and ask. Never look for WAVETERM_AUTH_KEY.",
		"Assume the UI moved: read `ui active` first, and pass --expected-hash when writing.",
	}
}

// Guide is the machine-readable shape of `wsh agent guide --json`.
type Guide struct {
	Version  int                              `json:"version"`
	Commands []Command                        `json:"commands"`
	Errors   []struct{ Code, Meaning string } `json:"errors"`
	RedLines []string                         `json:"redlines"`
}

// JSON returns the machine-readable guide.
func JSON() (string, error) {
	g := Guide{Version: Version, Commands: Commands(), Errors: Errors(), RedLines: RedLines()}
	data, err := json.MarshalIndent(g, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

// Text returns the one-page human/agent-readable guide.
func Text() string {
	var b strings.Builder
	b.WriteString("Snorkeling control surface — what you can do from outside the app\n")
	b.WriteString("\n")
	b.WriteString("Outside the app there is no WAVETERM_JWT: get a scoped token first.\n")
	b.WriteString("  (inside a Snorkeling block) wsh auth grant --name <you> --scope observe --ttl 30m --out <file>\n")
	b.WriteString("  wsh --token-file <file> ui active --json\n")
	b.WriteString("\n")
	b.WriteString("Red lines\n")
	for i, line := range RedLines() {
		fmt.Fprintf(&b, "  %d. %s\n", i+1, line)
	}
	b.WriteString("\n")
	b.WriteString("Commands\n")
	for _, c := range Commands() {
		fmt.Fprintf(&b, "  wsh %-22s [%s]  %s\n", c.Cmd, c.Scope, c.Summary)
		for _, f := range c.Flags {
			fmt.Fprintf(&b, "      %s\n", f)
		}
		for _, n := range c.Notes {
			fmt.Fprintf(&b, "      ! %s\n", n)
		}
	}
	b.WriteString("\nErrors\n")
	for _, e := range Errors() {
		fmt.Fprintf(&b, "  %-15s %s\n", e.Code, e.Meaning)
	}
	return b.String()
}

// SkillMarkdown renders the command reference that ships inside the skill.
//
// The skill document is generated from this table, so an agent reading the skill
// and a human reading `wsh agent guide` cannot be told different things.
func SkillMarkdown() string {
	var b strings.Builder
	b.WriteString("# Command reference\n")
	b.WriteString("\n")
	b.WriteString("<!-- Generated from pkg/agentguide. Do not edit by hand: run `node scripts/run-task.mjs generate`. -->\n")
	b.WriteString("\n")
	b.WriteString("All commands accept `--json` and `--timeout <ms>`. Outside the app, add\n")
	b.WriteString("`--token-file <path>` (or set `SNORKELING_AGENT_TOKEN_FILE`).\n")

	// group by scope, keeping the teaching order inside each group
	groups := []struct{ scope, title string }{
		{"observe", "Observe"},
		{"navigate", "Navigate"},
		{"data", "Data"},
		{"in-app only", "Inside the app only"},
	}
	for _, g := range groups {
		var rows []Command
		for _, c := range Commands() {
			if c.Scope == g.scope {
				rows = append(rows, c)
			}
		}
		if len(rows) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n## %s\n\n", g.title)
		for _, c := range rows {
			fmt.Fprintf(&b, "### `wsh %s`\n\n", c.Cmd)
			fmt.Fprintf(&b, "%s\n\n", c.Summary)
			if len(c.Flags) > 0 {
				flags := make([]string, len(c.Flags))
				for i, f := range c.Flags {
					flags[i] = "`" + f + "`"
				}
				fmt.Fprintf(&b, "Flags: %s\n\n", strings.Join(flags, ", "))
			}
			for _, n := range c.Notes {
				fmt.Fprintf(&b, "- %s\n", n)
			}
			if len(c.Notes) > 0 {
				b.WriteString("\n")
			}
		}
	}

	b.WriteString("## Errors\n\n")
	b.WriteString("Stable codes; branch on them.\n\n")
	b.WriteString("| Code | Meaning |\n|---|---|\n")
	errs := Errors()
	sort.SliceStable(errs, func(i, j int) bool { return errs[i].Code < errs[j].Code })
	for _, e := range errs {
		fmt.Fprintf(&b, "| `%s` | %s |\n", e.Code, e.Meaning)
	}
	return b.String()
}
