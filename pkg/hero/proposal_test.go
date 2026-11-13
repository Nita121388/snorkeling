// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func agentProvenance(name, session string) *Provenance {
	return &Provenance{Kind: "agent", Name: name, SessionID: session}
}

func fixedNow() time.Time {
	return time.Date(2026, 11, 12, 8, 0, 0, 0, time.UTC)
}

func proposalFileFor(tb testing.TB, root, slug string) string {
	tb.Helper()
	dir, err := ProposalsPath(root)
	if err != nil {
		tb.Fatal(err)
	}
	return filepath.Join(dir, slug+".json")
}

// TestProposeRoutingMatrix covers the design §2 table: human without --yes is
// a zero-write dry-run; agent without --yes writes a proposal and no home
// base; agent with --yes applies directly with agent provenance.
func TestProposeRoutingMatrix(t *testing.T) {
	// human, no --yes: A1 dry-run, zero writes, no proposal
	humanOpts := Options{Root: t.TempDir(), Name: "p1", DryRun: true}
	res, err := Create(humanOpts)
	if err != nil {
		t.Fatal(err)
	}
	if res.Proposal != nil || res.Applied || !res.Created {
		t.Fatalf("human dry-run must stay pure A1 preview, got %+v", res)
	}
	if _, err := os.Stat(proposalFileFor(t, humanOpts.Root, "p1")); !os.IsNotExist(err) {
		t.Fatal("human dry-run must not write a proposal")
	}
	if _, err := os.Stat(filepath.Join(humanOpts.Root, "p1")); !os.IsNotExist(err) {
		t.Fatal("human dry-run must not create the hero dir")
	}

	// agent, no --yes: proposal written, no home base
	agentOpts := Options{Root: t.TempDir(), Name: "p1", DryRun: true, Agent: agentProvenance("pi", "sess-1"), Now: fixedNow}
	res, err = Create(agentOpts)
	if err != nil {
		t.Fatal(err)
	}
	if res.Proposal == nil || res.Applied || !res.Created {
		t.Fatalf("agent without --yes must produce a proposal and no scaffold, got %+v", res)
	}
	propBytes, err := os.ReadFile(proposalFileFor(t, agentOpts.Root, "p1"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(propBytes), `"kind": "hero.proposal"`) {
		t.Fatalf("proposal file must carry the kind discriminator:\n%s", propBytes)
	}
	if !strings.Contains(string(propBytes), `"sessionId": "sess-1"`) {
		t.Fatalf("proposal must carry the agent session id:\n%s", propBytes)
	}
	if _, err := os.Stat(filepath.Join(agentOpts.Root, "p1")); !os.IsNotExist(err) {
		t.Fatal("agent propose must not scaffold the hero dir")
	}

	// agent, --yes: direct apply with agent provenance
	autoOpts := Options{Root: t.TempDir(), Name: "p2", DryRun: false, Agent: agentProvenance("pi", "sess-2"), Now: fixedNow}
	res, err = Create(autoOpts)
	if err != nil {
		t.Fatal(err)
	}
	if res.Proposal != nil || !res.Applied {
		t.Fatalf("agent --yes must apply directly, got %+v", res)
	}
	if res.Hero.CreatedBy == nil || res.Hero.CreatedBy.Kind != "agent" || res.Hero.CreatedBy.SessionID != "sess-2" {
		t.Fatalf("applied hero must keep agent provenance, got %+v", res.Hero.CreatedBy)
	}
	if _, err := os.Stat(proposalFileFor(t, autoOpts.Root, "p2")); !os.IsNotExist(err) {
		t.Fatal("agent --yes must not leave a proposal")
	}
}

// TestProposeIdempotency covers both reuse paths: an existing hero is
// never re-proposed, and a pending identical-slug proposal is read back.
func TestProposeIdempotency(t *testing.T) {
	root := t.TempDir()
	// existing hero -> no proposal, idempotent hit
	if _, err := Create(Options{Root: root, Name: "smoke", Now: fixedNow}); err != nil {
		t.Fatal(err)
	}
	res, err := Create(Options{Root: root, Name: "smoke", DryRun: true, Agent: agentProvenance("pi", "sess-1"), Now: fixedNow})
	if err != nil {
		t.Fatal(err)
	}
	if res.Proposal != nil || res.Created {
		t.Fatalf("proposing an existing hero must reuse it, got %+v", res)
	}
	if _, err := os.Stat(proposalFileFor(t, root, "smoke")); !os.IsNotExist(err) {
		t.Fatal("proposing an existing hero must not write a proposal")
	}

	// same-slug proposal -> read back unchanged
	opts := Options{Root: root, Name: "Backup Guard", DryRun: true, Agent: agentProvenance("pi", "sess-1"), Now: fixedNow}
	res, err = Create(opts)
	if err != nil {
		t.Fatal(err)
	}
	if res.Proposal == nil || res.ProposalReused {
		t.Fatalf("first propose must write, got %+v", res)
	}
	first, err := os.ReadFile(proposalFileFor(t, root, "backup-guard"))
	if err != nil {
		t.Fatal(err)
	}
	res, err = Create(opts)
	if err != nil {
		t.Fatal(err)
	}
	if res.Proposal == nil || !res.ProposalReused {
		t.Fatalf("second propose must reuse, got %+v", res)
	}
	second, err := os.ReadFile(proposalFileFor(t, root, "backup-guard"))
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatal("reused proposal must not be rewritten")
	}
}

// TestProposeQuota covers design §5: two same-session proposals per UTC day
// pass, the third is refused with zero writes, other sessions are unaffected,
// sessions without attribution are not counted, and the window resets the
// next day.
func TestProposeQuota(t *testing.T) {
	root := t.TempDir()
	mk := func(name string, day time.Time) Options {
		return Options{Root: root, Name: name, DryRun: true, Agent: agentProvenance("pi", "sess-1"),
			Now: func() time.Time { return day }}
	}
	day1 := time.Date(2026, 11, 12, 8, 0, 0, 0, time.UTC)
	for _, name := range []string{"a", "b"} {
		if _, err := Create(mk(name, day1)); err != nil {
			t.Fatal(err)
		}
	}
	// third same-day proposal: refused, zero writes
	_, err := Create(mk("c", day1))
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("third same-session proposal must hit ErrQuotaExceeded, got %v", err)
	}
	if _, statErr := os.Stat(proposalFileFor(t, root, "c")); !os.IsNotExist(statErr) {
		t.Fatal("quota refusal must leave zero writes")
	}
	// other session: unaffected
	other := Options{Root: root, Name: "d", DryRun: true, Agent: agentProvenance("codex", "sess-2"),
		Now: func() time.Time { return day1 }}
	if _, err := Create(other); err != nil {
		t.Fatalf("a different session must not be blocked: %v", err)
	}
	// no session id: honest degradation, not counted
	noSess := Options{Root: root, Name: "e", DryRun: true, Agent: agentProvenance("pi", ""),
		Now: func() time.Time { return day1 }}
	if _, err := Create(noSess); err != nil {
		t.Fatalf("unattributed agent must not be quota-counted: %v", err)
	}
	if _, err := Create(Options{Root: root, Name: "f", DryRun: true, Agent: agentProvenance("pi", ""),
		Now: func() time.Time { return day1 }}); err != nil {
		t.Fatalf("unattributed agent must not be quota-counted: %v", err)
	}
	// next day: window reset
	day2 := day1.Add(24 * time.Hour)
	if _, err := Create(mk("g", day2)); err != nil {
		t.Fatalf("quota must reset the next UTC day: %v", err)
	}
	// and a fresh temp root has no carryover
	fresh := Options{Root: t.TempDir(), Name: "h", DryRun: true, Agent: agentProvenance("pi", "sess-1"),
		Now: func() time.Time { return day1 }}
	if _, err := Create(fresh); err != nil {
		t.Fatal(err)
	}
}

func TestListProposalsApproveAndReject(t *testing.T) {
	root := t.TempDir()
	day := fixedNow()
	mk := func(name string) Options {
		return Options{Root: root, Name: name, DryRun: true, Agent: agentProvenance("pi", "sess-1"),
			Role: "duty", Now: func() time.Time { return day }}
	}
	if _, err := Create(mk("alpha")); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(Options{Root: root, Name: "Beta Guard", DryRun: true,
		Agent: agentProvenance("codex", "sess-2"), Now: func() time.Time { return day.Add(time.Hour) }}); err != nil {
		t.Fatal(err)
	}
	props, err := ListProposals(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(props) != 2 || props[0].Slug != "alpha" || props[1].Slug != "beta-guard" {
		t.Fatalf("ListProposals must return time-sorted pending proposals, got %+v", props)
	}

	// reject: proposal gone, no hero, journal line left
	if err := Reject(root, "beta-guard", func() time.Time { return day.Add(2 * time.Hour) }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(proposalFileFor(t, root, "beta-guard")); !os.IsNotExist(err) {
		t.Fatal("reject must delete the proposal file")
	}
	if _, err := os.Stat(filepath.Join(root, "beta-guard")); !os.IsNotExist(err) {
		t.Fatal("reject must not create a hero")
	}
	dir, _ := ProposalsPath(root)
	journal, err := os.ReadFile(filepath.Join(dir, "journal.md"))
	if err != nil || !strings.Contains(string(journal), "beta-guard") {
		t.Fatalf("reject must leave a journal line, got %v %q", err, journal)
	}
	if err := Reject(root, "beta-guard", func() time.Time { return day }); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("rejecting an unknown slug must return ErrProposalNotFound, got %v", err)
	}

	// approve: scaffold with agent provenance kept + human approver, roster rescanned
	res, err := Approve(root, "alpha", func() time.Time { return day.Add(3 * time.Hour) })
	if err != nil {
		t.Fatal(err)
	}
	if !res.Applied {
		t.Fatalf("approve must land the scaffold, got %+v", res)
	}
	if res.Hero.CreatedBy == nil || res.Hero.CreatedBy.Kind != "agent" || res.Hero.CreatedBy.SessionID != "sess-1" {
		t.Fatalf("approve must keep the agent provenance, got %+v", res.Hero.CreatedBy)
	}
	if res.Hero.ApprovedBy == nil || res.Hero.ApprovedBy.Kind != "human" {
		t.Fatalf("approve must stamp approvedBy.kind=human, got %+v", res.Hero.ApprovedBy)
	}
	if res.Hero.Role != "duty" {
		t.Fatalf("approve must replay the proposed options, got %+v", res.Hero)
	}
	if _, err := os.Stat(proposalFileFor(t, root, "alpha")); !os.IsNotExist(err) {
		t.Fatal("approve must delete the proposal file")
	}
	rosterPath, _ := RosterPath(root)
	roster, err := os.ReadFile(rosterPath)
	if err != nil || !strings.Contains(string(roster), "alpha") {
		t.Fatalf("roster must list the approved hero, got %v %q", err, roster)
	}
	if _, err := Approve(root, "alpha", func() time.Time { return day }); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("approving a consumed slug must return ErrProposalNotFound, got %v", err)
	}
}
