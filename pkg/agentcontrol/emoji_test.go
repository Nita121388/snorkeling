// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func emojiTestSessionID(t *testing.T) (string, *aisessions.Manager) {
	t.Helper()
	id, manager := setupCardSession(t)
	return id, manager
}

func TestSessionEmojiGetSetEndToEnd(t *testing.T) {
	sessionID, _ := emojiTestSessionID(t)
	ctx := context.Background()

	// Empty slot initially.
	get, err := SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if get.Emoji != "" || get.Source != "" {
		t.Fatalf("expected empty slot, got %#v", get)
	}

	// --if-absent acts as the precondition for a real write (拍板 #2) and lands.
	set, err := SessionEmojiSet(ctx, wshrpc.SessionEmojiSetRequest{
		Identifier: sessionID,
		Emoji:      "🛡️",
		IfAbsent:   true,
		Yes:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !set.Changed {
		t.Fatalf("expected the empty-slot write to land: %#v", set)
	}
	get, err = SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if get.Emoji != "🛡️" || get.Source != "ai" || get.UpdatedAt == 0 {
		t.Fatalf("get after set = %#v, want {emoji:🛡️ source:ai updatedAt>0}", get)
	}

	// Repeat --if-absent is an idempotent no-op (skipped, not an error).
	set, err = SessionEmojiSet(ctx, wshrpc.SessionEmojiSetRequest{
		Identifier: sessionID,
		Emoji:      "🐛",
		IfAbsent:   true,
		Yes:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if set.Changed {
		t.Fatalf("expected idempotent skip: %#v", set)
	}
	if len(set.Skipped) != 1 || !strings.Contains(set.Skipped[0], "emoji: exists (--if-absent)") {
		t.Fatalf("unexpected skipped: %#v", set.Skipped)
	}
	get, _ = SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if get.Emoji != "🛡️" {
		t.Fatalf("existing value must be untouched: %#v", get)
	}

	// A write without --if-absent and without a hash is refused (E_USAGE).
	_, err = SessionEmojiSet(ctx, wshrpc.SessionEmojiSetRequest{Identifier: sessionID, Emoji: "🦊", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "E_USAGE") {
		t.Fatalf("expected E_USAGE without precondition, got %v", err)
	}

	// Invalid emoji is rejected with E_INVALID_EMOJI.
	_, err = SessionEmojiSet(ctx, wshrpc.SessionEmojiSetRequest{Identifier: sessionID, Emoji: "42", IfAbsent: true, Yes: true})
	if err == nil || !strings.Contains(err.Error(), CodeInvalidEmoji) {
		t.Fatalf("expected E_INVALID_EMOJI, got %v", err)
	}
}

func TestSessionEmojiInjectRecommendationsEndToEnd(t *testing.T) {
	sessionID, manager := emojiTestSessionID(t)
	ctx := context.Background()

	// Not found before any injection.
	recs, err := SessionEmojiRecommendations(ctx, wshrpc.SessionEmojiRecommendationsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if recs.Found || len(recs.Candidates) != 0 {
		t.Fatalf("expected not-found before injection: %#v", recs)
	}

	// Inject two candidates; read them back.
	inject, err := SessionEmojiInject(ctx, wshrpc.SessionEmojiInjectRequest{
		Identifier: sessionID,
		InjectedBy: "hero:watchdog",
		Candidates: []wshrpc.SessionEmojiRecommendation{
			{Emoji: "🛡️", Reason: "在修 wavesrv OOM"},
			{Emoji: "🐛", Reason: "bug mentions"},
		},
		TTLSeconds: 3600,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inject.Candidates != 2 {
		t.Fatalf("injected candidates = %d, want 2", inject.Candidates)
	}
	recs, err = SessionEmojiRecommendations(ctx, wshrpc.SessionEmojiRecommendationsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if !recs.Found || recs.InjectedBy != "hero:watchdog" || len(recs.Candidates) != 2 {
		t.Fatalf("recommendations = %#v", recs)
	}
	if recs.Candidates[0].Emoji != "🛡️" || !strings.Contains(recs.Candidates[0].Reason, "OOM") {
		t.Fatalf("candidate[0] = %#v", recs.Candidates[0])
	}

	// A 1-nanosecond TTL expires by read time → not-found (picker hides).
	if err := manager.SetEmojiRecommendations(ctx, func() string {
		s, err := manager.Summary(ctx, sessionID, false)
		if err != nil {
			t.Fatal(err)
		}
		return s.Key
	}(), "hero:watchdog", []aisessions.EmojiRecommendationCandidate{{Emoji: "🦊"}}, time.Nanosecond); err != nil {
		t.Fatal(err)
	}
	recs, err = SessionEmojiRecommendations(ctx, wshrpc.SessionEmojiRecommendationsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if recs.Found {
		t.Fatalf("expired injection must read as not-found: %#v", recs)
	}

	// Empty candidates clears the section.
	_, err = SessionEmojiInject(ctx, wshrpc.SessionEmojiInjectRequest{Identifier: sessionID, InjectedBy: "hero:watchdog"})
	if err != nil {
		t.Fatal(err)
	}
	recs, err = SessionEmojiRecommendations(ctx, wshrpc.SessionEmojiRecommendationsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if recs.Found {
		t.Fatalf("cleared injection must read as not-found: %#v", recs)
	}

	// An invalid candidate rejects the whole injection with E_INVALID_EMOJI.
	_, err = SessionEmojiInject(ctx, wshrpc.SessionEmojiInjectRequest{
		Identifier: sessionID,
		InjectedBy: "hero:watchdog",
		Candidates: []wshrpc.SessionEmojiRecommendation{{Emoji: "🦊"}, {Emoji: "not-an-emoji"}},
	})
	if err == nil || !strings.Contains(err.Error(), CodeInvalidEmoji) {
		t.Fatalf("expected E_INVALID_EMOJI, got %v", err)
	}
}

func TestSessionEmojiPrefsBuckets(t *testing.T) {
	sessionID, manager := emojiTestSessionID(t)
	ctx := context.Background()

	summary, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate recorded picks (user hand-picks): project 2x 🦊, persona 1x 🛡️,
	// global 1x 🦊 — the RecordEmojiPick path uses these same bumps (P3).
	if err := manager.BumpEmojiPref(ctx, aisessions.EmojiPrefDimProject, summary.ProjectPath, "🦊", 2); err != nil {
		t.Fatal(err)
	}
	if err := manager.BumpEmojiPref(ctx, aisessions.EmojiPrefDimPersona, "provider:codex", "🛡️", 1); err != nil {
		t.Fatal(err)
	}
	if err := manager.BumpEmojiPref(ctx, aisessions.EmojiPrefDimGlobal, "", "🦊", 1); err != nil {
		t.Fatal(err)
	}

	prefs, err := SessionEmojiPrefs(ctx, wshrpc.SessionEmojiPrefsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Project["🦊"] != 2 {
		t.Fatalf("project bucket = %#v", prefs.Project)
	}
	if prefs.Persona["🛡️"] != 1 {
		t.Fatalf("persona bucket = %#v", prefs.Persona)
	}
	if prefs.Global["🦊"] != 1 {
		t.Fatalf("global bucket = %#v", prefs.Global)
	}
	if prefs.PrefVersion < 3 {
		t.Fatalf("prefVersion = %d, want >= 3", prefs.PrefVersion)
	}
	// The persona dim key follows 拍板 #1: no props.hero → provider:<source>.
	if got := personaDimKey(summary); got != "provider:codex" {
		t.Fatalf("personaDimKey = %q, want provider:codex", got)
	}
}

// TestRecordEmojiPickEndToEnd covers the UI channel: the pick writes the prop
// as source=user and bumps the three preference counters in one transaction;
// clearing deletes the prop and decrements the counters (floor 0).
func TestRecordEmojiPickEndToEnd(t *testing.T) {
	sessionID, _ := emojiTestSessionID(t)
	ctx := context.Background()

	pick, err := RecordEmojiPick(ctx, wshrpc.SessionEmojiRecordPickRequest{Identifier: sessionID, Emoji: "🦊"})
	if err != nil {
		t.Fatal(err)
	}
	if pick.Emoji != "🦊" || pick.Cleared || pick.SessionKey == "" {
		t.Fatalf("pick result = %#v", pick)
	}
	get, err := SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if get.Emoji != "🦊" || get.Source != "user" {
		t.Fatalf("emoji after UI pick = %#v, want source=user", get)
	}
	prefs, err := SessionEmojiPrefs(ctx, wshrpc.SessionEmojiPrefsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Project["🦊"] != 1 || prefs.Persona["🦊"] != 1 || prefs.Global["🦊"] != 1 {
		t.Fatalf("prefs after first pick = %#v, want each dim +1", prefs)
	}
	versionAfterPick := prefs.PrefVersion

	// Clear: prop deleted, counters decremented (floor 0 → rows omitted).
	clear, err := RecordEmojiPick(ctx, wshrpc.SessionEmojiRecordPickRequest{Identifier: sessionID, Emoji: ""})
	if err != nil {
		t.Fatal(err)
	}
	if !clear.Cleared {
		t.Fatalf("expected cleared, got %#v", clear)
	}
	get, err = SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if get.Emoji != "" {
		t.Fatalf("emoji after clear = %#v, want empty", get)
	}
	prefs, err = SessionEmojiPrefs(ctx, wshrpc.SessionEmojiPrefsRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	for label, bucket := range map[string]map[string]int{"project": prefs.Project, "persona": prefs.Persona, "global": prefs.Global} {
		if count := bucket["🦊"]; count != 0 {
			t.Fatalf("%s bucket after clear = %d, want 0 (omitted)", label, count)
		}
	}
	if prefs.PrefVersion <= versionAfterPick {
		t.Fatalf("prefVersion must advance on clear: %d -> %d", versionAfterPick, prefs.PrefVersion)
	}

	// Invalid emoji rejects with E_INVALID_EMOJI (no partial writes).
	if _, err := RecordEmojiPick(ctx, wshrpc.SessionEmojiRecordPickRequest{Identifier: sessionID, Emoji: "42"}); err == nil ||
		!strings.Contains(err.Error(), CodeInvalidEmoji) {
		t.Fatalf("expected E_INVALID_EMOJI, got %v", err)
	}
	get, _ = SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if get.Emoji != "" {
		t.Fatalf("rejected pick must not write: %#v", get)
	}
}

// TestRecordEmojiPickDoesNotOverwriteAIlet replays the R10 contract: a UI pick
// overwrites any value (the user owns the slot); that is the pick's purpose.
func TestRecordEmojiPickOverwritesPriorValue(t *testing.T) {
	sessionID, _ := emojiTestSessionID(t)
	ctx := context.Background()
	// Agent set the emoji first (source=ai), then the user picks something else.
	if _, err := SessionEmojiSet(ctx, wshrpc.SessionEmojiSetRequest{Identifier: sessionID, Emoji: "🛡️", IfAbsent: true, Yes: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordEmojiPick(ctx, wshrpc.SessionEmojiRecordPickRequest{Identifier: sessionID, Emoji: "🐙"}); err != nil {
		t.Fatal(err)
	}
	get, err := SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if get.Emoji != "🐙" || get.Source != "user" {
		t.Fatalf("user pick must own the slot: %#v", get)
	}
}

// TestMigrateSessionEmojis covers the legacy localStorage replay: unknown
// sessions skip, already-set slots skip (idempotent, no double record), valid
// entries land as source=user with preferences counters.
func TestMigrateSessionEmojis(t *testing.T) {
	sessionID, _ := emojiTestSessionID(t)
	ctx := context.Background()

	// First run migrates the entry.
	res, err := MigrateSessionEmojis(ctx, wshrpc.SessionEmojiMigrateRequest{Entries: []wshrpc.SessionEmojiMigrationEntry{
		{Identifier: sessionID, Emoji: "🦊"},
		{Identifier: "does-not-exist", Emoji: "🐙"},
		{Identifier: sessionID, Emoji: "42"}, // invalid emoji
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Migrated) != 1 || res.Migrated[0].Emoji != "🦊" {
		t.Fatalf("migrated = %#v, want exactly [🦊]", res.Migrated)
	}
	reasons := map[string]string{}
	for _, skip := range res.Skipped {
		reasons[skip.Identifier] = skip.Reason
	}
	if _, ok := reasons["does-not-exist"]; !ok {
		t.Fatalf("unknown session must be skipped: %#v", res.Skipped)
	}
	if _, ok := reasons[sessionID]; !ok {
		t.Fatalf("invalid emoji must be skipped: %#v", res.Skipped)
	}

	get, err := SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if get.Emoji != "🦊" || get.Source != "user" {
		t.Fatalf("migrated emoji = %#v, want source=user", get)
	}
	prefs, _ := SessionEmojiPrefs(ctx, wshrpc.SessionEmojiPrefsRequest{Identifier: sessionID})
	if prefs.Project["🦊"] != 1 {
		t.Fatalf("migration must record the preference once: %#v", prefs.Project)
	}

	// Second run: slot already set → skipped, counters unchanged (idempotent).
	res, err = MigrateSessionEmojis(ctx, wshrpc.SessionEmojiMigrateRequest{Entries: []wshrpc.SessionEmojiMigrationEntry{
		{Identifier: sessionID, Emoji: "🐛"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Migrated) != 0 || len(res.Skipped) != 1 {
		t.Fatalf("repeat migration must skip, got migrated=%v skipped=%v", res.Migrated, res.Skipped)
	}
	prefs, _ = SessionEmojiPrefs(ctx, wshrpc.SessionEmojiPrefsRequest{Identifier: sessionID})
	if prefs.Project["🦊"] != 1 || prefs.Project["🐛"] != 0 {
		t.Fatalf("repeat run must not double-record: %#v", prefs.Project)
	}
	get, _ = SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: sessionID})
	if get.Emoji != "🦊" {
		t.Fatalf("repeat run must not overwrite: %#v", get)
	}
}
