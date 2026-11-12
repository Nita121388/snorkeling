// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package persona

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// A2.5 propose gate (design/plans/persona-system.md §4.5, task design §4-§5):
// an agent that wants to create a persona does not scaffold it — it writes a
// proposal file under <root>/.index/proposals/ and a human approves it.
// Everything here is plain JSON on the filesystem (same rule as the rest of
// the package: no DB, no RPC, standard library only).

const (
	// ProposalSchemaVersion tracks the shape of a proposal file.
	ProposalSchemaVersion = 1
	// ProposalKind is the discriminator of proposal files.
	ProposalKind = "persona.proposal"
	// ProposalStatusPending is the only status in v1.
	ProposalStatusPending = "pending"
	// ProposeQuotaPerSessionDay is design §5: at most 2 proposals per agent
	// session per UTC day. The third is refused with zero writes.
	ProposeQuotaPerSessionDay = 2
	// proposalsDirName is the directory under .index/ holding proposals.
	proposalsDirName = "proposals"
)

// ErrQuotaExceeded is returned when a session already used its daily propose
// quota. The caller turns it into a non-zero exit with zero disk writes.
var ErrQuotaExceeded = errors.New("persona propose quota exceeded")

// ErrProposalNotFound is returned by Approve/Reject for an unknown slug.
var ErrProposalNotFound = errors.New("persona proposal not found")

// Proposal is the pending-create record (design §4). It carries the full
// scaffold options so Approve can reproduce them without a second round trip.
type Proposal struct {
	SchemaVersion int             `json:"schemaVersion"`
	Kind          string          `json:"kind"`
	Slug          string          `json:"slug"`
	ProposedAt    string          `json:"proposedAt"`
	ProposedBy    *Provenance     `json:"proposedBy"`
	Options       ProposalOptions `json:"options"`
	Status        string          `json:"status"`
}

// ProposalOptions is the scaffold request minus the agent identity.
// Charter/MemoryDraft are optional drafts (--charter-file / --memory-from-session);
// they are additive to the design §4 shape and empty for plain proposals.
type ProposalOptions struct {
	Name        string `json:"name"`
	Emoji       string `json:"emoji,omitempty"`
	Role        string `json:"role,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Model       string `json:"model,omitempty"`
	Charter     string `json:"charter,omitempty"`
	MemoryDraft string `json:"memoryDraft,omitempty"`
}

// ProposalsPath returns <root>/.index/proposals (derived, gitignored).
func ProposalsPath(root string) (string, error) {
	rootResolved, err := ResolveRoot(root)
	if err != nil {
		return "", err
	}
	return filepath.Join(rootResolved, ".index", proposalsDirName), nil
}

func proposalPath(root, slug string) (string, error) {
	rootResolved, err := ResolveRoot(root)
	if err != nil {
		return "", err
	}
	if err := ValidateID(slug); err != nil {
		return "", err
	}
	return filepath.Join(rootResolved, ".index", proposalsDirName, slug+".json"), nil
}

func readProposal(path string) (*Proposal, error) {
	barr, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var prop Proposal
	if err := json.Unmarshal(barr, &prop); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return &prop, nil
}

// ListProposals scans <root>/.index/proposals/*.json, sorted by ProposedAt
// then slug. Unparseable files are skipped (same tolerance as List: the
// proposal store is a derived surface, a bad neighbor must not brick reads).
func ListProposals(root string) ([]Proposal, error) {
	dir, err := ProposalsPath(root)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var out []Proposal
	for _, ent := range entries {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".json") || strings.HasPrefix(ent.Name(), ".") {
			continue
		}
		prop, err := readProposal(filepath.Join(dir, ent.Name()))
		if err != nil {
			continue
		}
		out = append(out, *prop)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ProposedAt != out[j].ProposedAt {
			return out[i].ProposedAt < out[j].ProposedAt
		}
		return out[i].Slug < out[j].Slug
	})
	return out, nil
}

// countProposalsToday counts proposals by the same session in the same UTC
// natural day (design §5). The proposal files themselves are the source of
// truth: no separate state file can drift.
func countProposalsToday(root, sessionID string, now time.Time) (int, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return 0, nil // honest degradation: no attribution, no counting
	}
	props, err := ListProposals(root)
	if err != nil {
		return 0, err
	}
	day := now.UTC().Format("2006-01-02")
	n := 0
	for _, p := range props {
		if p.ProposedBy == nil || strings.TrimSpace(p.ProposedBy.SessionID) != sessionID {
			continue
		}
		t, err := time.Parse(time.RFC3339, p.ProposedAt)
		if err != nil {
			continue
		}
		if t.UTC().Format("2006-01-02") == day {
			n++
		}
	}
	return n, nil
}

// Propose writes .index/proposals/<slug>.json for an agent caller. It never
// scaffolds a home base. Idempotency: if the persona already exists, the
// proposal is skipped and (nil, false, nil) is returned so the caller can fall
// back to the A1 reuse path; if an identical-slug proposal is pending, it is
// read back untouched and reused=true.
func Propose(opts Options) (*Proposal, bool, error) {
	if strings.TrimSpace(opts.Name) == "" {
		return nil, false, errors.New("persona name must not be empty")
	}
	if opts.Agent == nil {
		return nil, false, errors.New("propose requires an agent identity (Options.Agent)")
	}
	root, err := ResolveRoot(opts.Root)
	if err != nil {
		return nil, false, err
	}
	id := Slugify(opts.Name)
	// A1 semantics: an existing slug is reused, never re-proposed.
	if _, err := readPersonaFile(filepath.Join(personaDir(root, id), ".persona", "persona.json")); err == nil {
		return nil, false, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, false, fmt.Errorf("checking existing persona %q: %w", id, err)
	}
	// Same-slug proposal pending: read back, zero writes.
	path, err := proposalPath(root, id)
	if err != nil {
		return nil, false, err
	}
	if prop, err := readProposal(path); err == nil {
		return prop, true, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, false, fmt.Errorf("checking existing proposal %q: %w", id, err)
	}
	now := time.Now()
	if opts.Now != nil {
		now = opts.Now()
	}
	// Quota (design §5): refuse the 3rd same-session proposal of the day,
	// before any write happens.
	count, err := countProposalsToday(root, opts.Agent.SessionID, now)
	if err != nil {
		return nil, false, err
	}
	if count >= ProposeQuotaPerSessionDay {
		return nil, false, fmt.Errorf(
			"%w: session %s already proposed %d persona(s) today (limit %d); wait for a human to approve or reject them",
			ErrQuotaExceeded, opts.Agent.SessionID, count, ProposeQuotaPerSessionDay)
	}
	by := *opts.Agent
	if by.Kind == "" {
		by.Kind = "agent"
	}
	by.SessionID = strings.TrimSpace(by.SessionID)
	if by.Ts == "" {
		by.Ts = now.UTC().Format(time.RFC3339)
	}
	prop := &Proposal{
		SchemaVersion: ProposalSchemaVersion,
		Kind:          ProposalKind,
		Slug:          id,
		ProposedAt:    now.UTC().Format(time.RFC3339),
		ProposedBy:    &by,
		Options: ProposalOptions{
			Name:        strings.TrimSpace(opts.Name),
			Emoji:       strings.TrimSpace(opts.Emoji),
			Role:        strings.TrimSpace(opts.Role),
			Provider:    strings.TrimSpace(opts.Provider),
			Model:       strings.TrimSpace(opts.Model),
			Charter:     opts.Charter,
			MemoryDraft: opts.MemoryDraft,
		},
		Status: ProposalStatusPending,
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, false, fmt.Errorf("creating proposals dir: %w", err)
	}
	if err := writeJSON(path, prop); err != nil {
		return nil, false, err
	}
	return prop, false, nil
}

// Approve lands a pending proposal: scaffold with the original agent
// provenance preserved, stamp approvedBy as the human, delete the proposal
// file, rescan the roster.
func Approve(root, slug string, now func() time.Time) (*CreateResult, error) {
	rootResolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(slug); err != nil {
		return nil, err
	}
	path := filepath.Join(rootResolved, ".index", proposalsDirName, slug+".json")
	prop, err := readProposal(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s (see `wsh persona propose list`)", ErrProposalNotFound, slug)
		}
		return nil, err
	}
	if now == nil {
		now = time.Now
	}
	agent := &Provenance{Kind: "agent", Name: "unknown"}
	if prop.ProposedBy != nil {
		agentCopy := *prop.ProposedBy
		agent = &agentCopy
	}
	if agent.Kind == "" {
		agent.Kind = "agent"
	}
	if agent.Ts == "" {
		agent.Ts = prop.ProposedAt
	}
	ts := now().UTC().Format(time.RFC3339)
	res, err := Create(Options{
		Root:        rootResolved,
		Name:        prop.Options.Name,
		Emoji:       prop.Options.Emoji,
		Role:        prop.Options.Role,
		Provider:    prop.Options.Provider,
		Model:       prop.Options.Model,
		DryRun:      false, // approval IS the confirmation
		Agent:       agent,
		ApprovedBy:  &Provenance{Kind: "human", Name: currentUser(), Ts: ts},
		Charter:     prop.Options.Charter,
		MemoryDraft: prop.Options.MemoryDraft,
		Now:         now,
	})
	if err != nil {
		return nil, err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("removing proposal %s: %w", path, err)
	}
	return res, nil
}

// Reject deletes a pending proposal without touching any persona. It leaves
// one line in the proposals journal (.index/proposals/journal.md): the
// rejected persona has no home base, so the trace lives next to the
// proposals themselves (task design §4, decision D3).
func Reject(root, slug string, now func() time.Time) error {
	rootResolved, err := ResolveRoot(root)
	if err != nil {
		return err
	}
	if err := ValidateID(slug); err != nil {
		return err
	}
	path := filepath.Join(rootResolved, ".index", proposalsDirName, slug+".json")
	prop, err := readProposal(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("%w: %s (see `wsh persona propose list`)", ErrProposalNotFound, slug)
		}
		return err
	}
	if now == nil {
		now = time.Now
	}
	by := "unknown"
	if prop.ProposedBy != nil && prop.ProposedBy.Name != "" {
		by = prop.ProposedBy.Name
	}
	journalPath := filepath.Join(rootResolved, ".index", proposalsDirName, "journal.md")
	line := fmt.Sprintf("- %s rejected %s (proposed %s by %s)\n",
		now().UTC().Format(time.RFC3339), slug, prop.ProposedAt, by)
	f, err := os.OpenFile(journalPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("appending proposals journal: %w", err)
	}
	defer f.Close()
	if _, err := f.WriteString(line); err != nil {
		return fmt.Errorf("appending proposals journal: %w", err)
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("removing proposal %s: %w", path, err)
	}
	return nil
}
