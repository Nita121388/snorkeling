// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteIndexEmojiRecommendationsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	// One external injection replaces wholesale; duplicates removed; emoji
	// validated + canonicalized (trimmed); reason preserved.
	err = idx.SetEmojiRecommendations(ctx, "codex:rec:/tmp/a.jsonl", "hero:watchdog",
		[]EmojiRecommendationCandidate{
			{Emoji: "  🛡️  ", Reason: "在修 wavesrv OOM"},
			{Emoji: "🐛", Reason: "recent bug mentions"},
			{Emoji: "🛡️", Reason: "duplicate must drop"},
		}, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	payload, found, err := idx.EmojiRecommendationsFor(ctx, "codex:rec:/tmp/a.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("recommendation payload missing after injection")
	}
	if payload.InjectedBy != "hero:watchdog" {
		t.Errorf("injectedBy = %q", payload.InjectedBy)
	}
	if len(payload.Candidates) != 2 {
		t.Fatalf("candidates = %#v, want 2 (deduped)", payload.Candidates)
	}
	if payload.Candidates[0].Emoji != "🛡️" || payload.Candidates[0].Reason != "在修 wavesrv OOM" {
		t.Errorf("first candidate = %#v", payload.Candidates[0])
	}

	// A second injection from another agent replaces the first wholesale.
	err = idx.SetEmojiRecommendations(ctx, "codex:rec:/tmp/a.jsonl", "hero:other",
		[]EmojiRecommendationCandidate{{Emoji: "🚀", Reason: "shipping"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	payload, found, err = idx.EmojiRecommendationsFor(ctx, "codex:rec:/tmp/a.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if !found || len(payload.Candidates) != 1 || payload.Candidates[0].Emoji != "🚀" || payload.InjectedBy != "hero:other" {
		t.Fatalf("replaced payload = %#v", payload)
	}
	if payload.Expired(time.Now()) {
		t.Fatal("ttl=0 payload must never expire")
	}

	// One invalid candidate rejects the whole injection (no partial writes).
	if err := idx.SetEmojiRecommendations(ctx, "codex:rec:/tmp/a.jsonl", "hero:watchdog",
		[]EmojiRecommendationCandidate{{Emoji: "🦊"}, {Emoji: "42"}}, time.Minute); !errors.Is(err, ErrInvalidEmoji) {
		t.Fatalf("invalid candidate error = %v, want ErrInvalidEmoji", err)
	}
	if payload, found, _ = idx.EmojiRecommendationsFor(ctx, "codex:rec:/tmp/a.jsonl"); !found || payload.Candidates[0].Emoji != "🚀" {
		t.Fatalf("rejected injection must leave the previous payload intact, got %#v", payload)
	}

	// An empty candidate list is the clear channel: row deleted, read not-found.
	if err := idx.SetEmojiRecommendations(ctx, "codex:rec:/tmp/a.jsonl", "hero:watchdog", nil, time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, found, err = idx.EmojiRecommendationsFor(ctx, "codex:rec:/tmp/a.jsonl"); err != nil || found {
		t.Fatalf("after clear: found=%v err=%v, want found=false", found, err)
	}
}

func TestSQLiteIndexEmojiRecommendationsCapped(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	// 20 distinct valid emojis (all Emoji_Presentation), more than the cap.
	candidates := []EmojiRecommendationCandidate{
		{Emoji: "🦊"}, {Emoji: "🐙"}, {Emoji: "🦄"}, {Emoji: "🛡️"}, {Emoji: "🐛"},
		{Emoji: "🚀"}, {Emoji: "🧪"}, {Emoji: "⚡"}, {Emoji: "📝"}, {Emoji: "🎨"},
		{Emoji: "😀"}, {Emoji: "😅"}, {Emoji: "😂"}, {Emoji: "🤣"}, {Emoji: "😊"},
		{Emoji: "😍"}, {Emoji: "🤔"}, {Emoji: "😴"}, {Emoji: "🤖"}, {Emoji: "👻"},
	}
	if len(candidates) <= EmojiRecommendationMaxCandidates {
		t.Fatal("test setup: need more candidates than the cap")
	}
	if err := idx.SetEmojiRecommendations(ctx, "k", "hero:watchdog", candidates, 0); err != nil {
		t.Fatal(err)
	}
	payload, found, err := idx.EmojiRecommendationsFor(ctx, "k")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if len(payload.Candidates) != EmojiRecommendationMaxCandidates {
		t.Fatalf("candidates = %d, want cap %d", len(payload.Candidates), EmojiRecommendationMaxCandidates)
	}
}

func TestSQLiteIndexEmojiRecommendationsTTLExpires(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	// A 1-nanosecond TTL is expired by the time the read runs: the picker then
	// hides the recommendation area entirely (found=false, no error).
	if err := idx.SetEmojiRecommendations(ctx, "k", "hero:watchdog",
		[]EmojiRecommendationCandidate{{Emoji: "🦊"}}, time.Nanosecond); err != nil {
		t.Fatal(err)
	}
	if _, found, err := idx.EmojiRecommendationsFor(ctx, "k"); err != nil {
		t.Fatal(err)
	} else if found {
		t.Fatal("expired payload must read as not-found")
	}

	// Missing sessions also read as not-found without error.
	if _, found, err := idx.EmojiRecommendationsFor(ctx, "nope"); err != nil || found {
		t.Fatalf("missing session: found=%v err=%v, want found=false", found, err)
	}
}
