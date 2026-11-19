// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// EmojiRecommendationMaxCandidates caps one injection payload so an external
// agent can never flood the picker's recommendation row.
const EmojiRecommendationMaxCandidates = 8

// EmojiRecommendationCandidate is one externally injected recommendation.
// Emoji must pass NormalizeEmoji; Reason is optional human-facing copy shown
// as the cell tooltip.
type EmojiRecommendationCandidate struct {
	Emoji  string `json:"emoji"`
	Reason string `json:"reason,omitempty"`
}

// EmojiRecommendationPayload is one external agent's injection for a session.
// The whole payload is replaced wholesale on every injection (last writer
// wins; there is no merging between agents).
type EmojiRecommendationPayload struct {
	Candidates []EmojiRecommendationCandidate `json:"candidates"`
	InjectedBy string                         `json:"injectedBy,omitempty"` // external agent identity, e.g. "hero:xxx"
	InjectedAt int64                          `json:"injectedAt"`           // UnixMilli
	ExpiresAt  int64                          `json:"expiresAt,omitempty"`  // UnixMilli; 0 = never expires
}

// Expired reports whether the payload has passed its TTL at the given time.
func (p EmojiRecommendationPayload) Expired(now time.Time) bool {
	return p.ExpiresAt > 0 && now.UnixMilli() >= p.ExpiresAt
}

// SetEmojiRecommendations stores one external injection for the session,
// replacing any previous injection wholesale. Every candidate emoji is
// validated with NormalizeEmoji (one invalid candidate rejects the whole
// injection), duplicates are removed, and the list is capped at
// EmojiRecommendationMaxCandidates. ttl <= 0 means the payload never expires.
// An empty candidate list deletes the session's row (the picker then hides the
// recommendation area entirely — that is also the "clear" channel).
func (idx *SQLiteIndex) SetEmojiRecommendations(ctx context.Context, sessionKey string, injectedBy string, candidates []EmojiRecommendationCandidate, ttl time.Duration) error {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return fmt.Errorf("session key is required")
	}
	normalized := make([]EmojiRecommendationCandidate, 0, len(candidates))
	seen := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		emoji, err := NormalizeEmoji(candidate.Emoji)
		if err != nil {
			return fmt.Errorf("emoji recommendation candidate: %w", err)
		}
		if seen[emoji] {
			continue
		}
		seen[emoji] = true
		normalized = append(normalized, EmojiRecommendationCandidate{Emoji: emoji, Reason: strings.TrimSpace(candidate.Reason)})
		if len(normalized) == EmojiRecommendationMaxCandidates {
			break
		}
	}
	if len(normalized) == 0 {
		_, err := idx.db.ExecContext(ctx, `DELETE FROM ai_emoji_recommendations WHERE session_key = ?`, sessionKey)
		return err
	}
	now := time.Now()
	payload := EmojiRecommendationPayload{
		Candidates: normalized,
		InjectedBy: strings.TrimSpace(injectedBy),
		InjectedAt: now.UnixMilli(),
	}
	if ttl > 0 {
		payload.ExpiresAt = now.Add(ttl).UnixMilli()
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode emoji recommendations: %w", err)
	}
	_, err = idx.db.ExecContext(ctx, `INSERT INTO ai_emoji_recommendations(session_key, payload_json, injected_by, injected_at)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(session_key) DO UPDATE SET
			payload_json = excluded.payload_json,
			injected_by = excluded.injected_by,
			injected_at = excluded.injected_at`,
		sessionKey, string(payloadJSON), payload.InjectedBy, payload.InjectedAt)
	return err
}

// EmojiRecommendationsFor returns the current injected recommendation payload
// for a session. A missing, expired, or corrupt-free-but-empty payload all
// return found=false, so the picker can uniformly hide the recommendation
// area (design: 有就显示，没有就不显示).
func (idx *SQLiteIndex) EmojiRecommendationsFor(ctx context.Context, sessionKey string) (EmojiRecommendationPayload, bool, error) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return EmojiRecommendationPayload{}, false, nil
	}
	var payloadJSON string
	err := idx.db.GetContext(ctx, &payloadJSON, `SELECT payload_json FROM ai_emoji_recommendations WHERE session_key = ?`, sessionKey)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return EmojiRecommendationPayload{}, false, nil
		}
		return EmojiRecommendationPayload{}, false, err
	}
	var payload EmojiRecommendationPayload
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return EmojiRecommendationPayload{}, false, fmt.Errorf("decode emoji recommendations for %q: %w", sessionKey, err)
	}
	if payload.Expired(time.Now()) {
		return EmojiRecommendationPayload{}, false, nil
	}
	return payload, true, nil
}

// ---- Manager-level wrappers (open the shared index per call) ----

// SetEmojiRecommendations stores one external injection via the shared index.
func (m *Manager) SetEmojiRecommendations(ctx context.Context, sessionKey string, injectedBy string, candidates []EmojiRecommendationCandidate, ttl time.Duration) error {
	idx, err := m.openSQLiteIndex()
	if err != nil {
		return fmt.Errorf("set emoji recommendations: %w", err)
	}
	defer func() {
		_ = idx.Close()
	}()
	return idx.SetEmojiRecommendations(ctx, sessionKey, injectedBy, candidates, ttl)
}

// EmojiRecommendationsFor reads a session's injected payload via the shared
// index. An empty sessionKey reads as not-found.
func (m *Manager) EmojiRecommendationsFor(ctx context.Context, sessionKey string) (EmojiRecommendationPayload, bool, error) {
	idx, err := m.openSQLiteIndex()
	if err != nil {
		return EmojiRecommendationPayload{}, false, fmt.Errorf("read emoji recommendations: %w", err)
	}
	defer func() {
		_ = idx.Close()
	}()
	return idx.EmojiRecommendationsFor(ctx, sessionKey)
}
