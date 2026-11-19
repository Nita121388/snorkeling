// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// EmojiPropKey is the ai_session_props key that stores the session emoji
// (design.md §2.1). Shared by the control surface (agentcontrol) and the
// property-generate exclusion so the key stays in one place.
const EmojiPropKey = "emoji"

// Preference dimensions (design.md §2.2). The dim value set is fixed to these
// three (拍板 #4: no provider dimension).
const (
	// EmojiPrefDimProject counts picks for the session's project.
	EmojiPrefDimProject = "project"
	// EmojiPrefDimPersona counts picks for the session's persona: the hero id,
	// or "provider:<name>" when no hero is attached (拍板 #1, design.md §8.1).
	EmojiPrefDimPersona = "persona"
	// EmojiPrefDimGlobal counts picks across all sessions (one "" bucket).
	EmojiPrefDimGlobal = "global"
)

// emojiPrefVersionKey tracks the global preference version in ai_schema_meta.
// Every BumpEmojiPref increments it in the same transaction, so the per-session
// recommend cache (ai_emoji_recommend_cache.pref_version) can be invalidated
// cheaply (design.md §2.3).
const emojiPrefVersionKey = "emoji_pref_version"

// ErrInvalidEmojiPrefDim is returned when dim is outside project|persona|global.
// The P2 CLI layer maps it to error code E_INVALID_DIM (design.md §3.4).
var ErrInvalidEmojiPrefDim = errors.New("invalid emoji preference dimension; want project|persona|global")

// IsValidEmojiPrefDim reports whether dim is one of the three supported
// preference dimensions.
func IsValidEmojiPrefDim(dim string) bool {
	switch dim {
	case EmojiPrefDimProject, EmojiPrefDimPersona, EmojiPrefDimGlobal:
		return true
	}
	return false
}

// NormalizeEmojiPrefDimKey normalizes a dim key before it is stored:
//
//   - project: filepath.Clean + backslash→forward slash on every OS (so the
//     stored key does not depend on the writer's platform), lowercased on
//     Windows where the filesystem is case-insensitive ("C:\Work" must collapse
//     with "c:\work").
//   - persona: trimmed as-is (hero id or "provider:<name>").
//   - global: always "" — the global dimension is a single bucket.
func NormalizeEmojiPrefDimKey(dim string, dimKey string) string {
	dimKey = strings.TrimSpace(dimKey)
	switch dim {
	case EmojiPrefDimProject:
		if dimKey == "" {
			return ""
		}
		cleaned := strings.TrimRight(strings.ReplaceAll(filepath.Clean(dimKey), `\`, `/`), "/")
		if cleaned == "" {
			cleaned = "/"
		}
		if runtime.GOOS == "windows" {
			cleaned = strings.ToLower(cleaned)
		}
		return cleaned
	case EmojiPrefDimGlobal:
		return ""
	default: // persona (and unknown dims): trim only
		return dimKey
	}
}

// BumpEmojiPref upserts one preference row: count = max(count + delta, 0).
// A negative delta is the "clear" negative signal — the row is kept at count 0,
// never deleted (prd.md R3). The global pref version is incremented in the same
// transaction so any cached recommendation is invalidated exactly once per pref
// change.
func (idx *SQLiteIndex) BumpEmojiPref(ctx context.Context, dim string, dimKey string, emoji string, delta int) error {
	if !IsValidEmojiPrefDim(dim) {
		return fmt.Errorf("%w: %q", ErrInvalidEmojiPrefDim, dim)
	}
	normalized, err := NormalizeEmoji(emoji)
	if err != nil {
		return fmt.Errorf("bump %s pref: %w", dim, err)
	}
	dimKey = NormalizeEmojiPrefDimKey(dim, dimKey)
	now := time.Now().UnixMilli()
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_emoji_prefs(dim, dim_key, emoji, count, updated_at)
		VALUES(?, ?, ?, max(?, 0), ?)
		ON CONFLICT(dim, dim_key, emoji) DO UPDATE SET
			count = max(ai_emoji_prefs.count + ?, 0),
			updated_at = excluded.updated_at`,
		dim, dimKey, normalized, delta, now, delta); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, '1')
		ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(ai_schema_meta.value AS INTEGER) + 1 AS TEXT)`,
		emojiPrefVersionKey); err != nil {
		return err
	}
	return tx.Commit()
}

// EmojiPrefsForDim returns the current counts (emoji → count) for one dimension
// bucket; rows with count 0 (negative-signal leftovers) are omitted.
func (idx *SQLiteIndex) EmojiPrefsForDim(ctx context.Context, dim string, dimKey string) (map[string]int, error) {
	if !IsValidEmojiPrefDim(dim) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidEmojiPrefDim, dim)
	}
	dimKey = NormalizeEmojiPrefDimKey(dim, dimKey)
	type prefRow struct {
		Emoji string `db:"emoji"`
		Count int    `db:"count"`
	}
	var rows []prefRow
	if err := idx.db.SelectContext(ctx, &rows, `SELECT emoji, count FROM ai_emoji_prefs WHERE dim = ? AND dim_key = ? AND count > 0 ORDER BY count DESC, emoji`,
		dim, dimKey); err != nil {
		return nil, err
	}
	out := make(map[string]int, len(rows))
	for _, row := range rows {
		out[row.Emoji] = row.Count
	}
	return out, nil
}

// EmojiPrefVersion returns the current global preference version (0 when no
// pick has ever been recorded).
func (idx *SQLiteIndex) EmojiPrefVersion(ctx context.Context) (int64, error) {
	var value string
	err := idx.db.GetContext(ctx, &value, `SELECT value FROM ai_schema_meta WHERE key = ?`, emojiPrefVersionKey)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("decode %s %q: %w", emojiPrefVersionKey, value, err)
	}
	return n, nil
}

// ---- Manager-level wrappers (open the shared index per call, like SetProps) ----

// BumpEmojiPref upserts one preference counter via the shared index.
func (m *Manager) BumpEmojiPref(ctx context.Context, dim string, dimKey string, emoji string, delta int) error {
	idx, err := m.openSQLiteIndex()
	if err != nil {
		return fmt.Errorf("bump emoji pref: %w", err)
	}
	defer func() {
		_ = idx.Close()
	}()
	return idx.BumpEmojiPref(ctx, dim, dimKey, emoji, delta)
}

// EmojiPrefsForDim reads one preference bucket via the shared index.
func (m *Manager) EmojiPrefsForDim(ctx context.Context, dim string, dimKey string) (map[string]int, error) {
	idx, err := m.openSQLiteIndex()
	if err != nil {
		return nil, fmt.Errorf("read emoji prefs: %w", err)
	}
	defer func() {
		_ = idx.Close()
	}()
	return idx.EmojiPrefsForDim(ctx, dim, dimKey)
}

// EmojiPrefVersion reads the global preference version via the shared index.
func (m *Manager) EmojiPrefVersion(ctx context.Context) (int64, error) {
	idx, err := m.openSQLiteIndex()
	if err != nil {
		return 0, fmt.Errorf("read emoji pref version: %w", err)
	}
	defer func() {
		_ = idx.Close()
	}()
	return idx.EmojiPrefVersion(ctx)
}

// EmojiPickDims carries the resolved dim keys for one session's pick record.
// The caller (agentcontrol.RecordEmojiPick) resolves persona per 拍板 #1.
type EmojiPickDims struct {
	ProjectKey string
	PersonaKey string
}

// RecordEmojiPick records one UI pick in a single transaction: the emoji prop
// is written as source=user (or deleted when Emoji is empty — the "clear"
// action), the three preference counters are bumped (+1 on pick, -1 on clear,
// floored at 0), and the global pref version incremented so any cache is
// invalidated exactly once (design.md §2.2/§2.3). Agent-channel writes
// (SessionEmojiSet) deliberately do NOT go through this path — they record no
// preference (design §3: agent writes don't count as user preferences).
func (idx *SQLiteIndex) RecordEmojiPick(ctx context.Context, key string, emoji string, dims EmojiPickDims) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("session key is required")
	}
	normalized := ""
	if strings.TrimSpace(emoji) != "" {
		var err error
		normalized, err = NormalizeEmoji(emoji)
		if err != nil {
			return fmt.Errorf("record emoji pick: %w", err)
		}
	}
	now := time.Now().UnixMilli()
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	// A clear decrements the counters of the emoji being cleared (read inside
	// the same transaction, BEFORE the prop row goes away), not the empty
	// string. When nothing was set the clear is a pure no-op for the counters.
	bumpEmoji := normalized
	if bumpEmoji == "" {
		var prevJSON string
		if err := tx.GetContext(ctx, &prevJSON, `SELECT value_json FROM ai_session_props WHERE session_key = ? AND prop_key = 'emoji'`, key); err == nil {
			var prev string
			if json.Unmarshal([]byte(prevJSON), &prev) == nil {
				if clean, nErr := NormalizeEmoji(prev); nErr == nil {
					bumpEmoji = clean
				}
			}
		}
	}
	if normalized == "" {
		if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_props WHERE session_key = ? AND prop_key = 'emoji'`, key); err != nil {
			return err
		}
	} else {
		valueJSON, err := json.Marshal(normalized)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_session_props(session_key, prop_key, value_json, prop_type, source, updated_at, prop_name, prop_order)
			VALUES(?, 'emoji', ?, 'text', ?, ?, '', 0)
			ON CONFLICT(session_key, prop_key) DO UPDATE SET
				value_json = excluded.value_json,
				prop_type = excluded.prop_type,
				source = excluded.source,
				updated_at = excluded.updated_at`,
			key, string(valueJSON), PropertySourceUser, now); err != nil {
			return err
		}
	}
	// Prop row written/deleted above; now bump the counters for bumpEmoji.
	delta := 1
	if normalized == "" {
		delta = -1
	}
	prefs := []struct {
		dim    string
		dimKey string
	}{
		{EmojiPrefDimProject, NormalizeEmojiPrefDimKey(EmojiPrefDimProject, dims.ProjectKey)},
		{EmojiPrefDimPersona, NormalizeEmojiPrefDimKey(EmojiPrefDimPersona, dims.PersonaKey)},
		{EmojiPrefDimGlobal, ""},
	}
	for _, pref := range prefs {
		// Skipped on a clear when the preferred emoji was never picked is fine:
		// the negative signal descends the counter that the pick raised.
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_emoji_prefs(dim, dim_key, emoji, count, updated_at)
			VALUES(?, ?, ?, max(?, 0), ?)
			ON CONFLICT(dim, dim_key, emoji) DO UPDATE SET
				count = max(ai_emoji_prefs.count + ?, 0),
				updated_at = excluded.updated_at`,
			pref.dim, pref.dimKey, bumpEmoji, delta, now, delta); err != nil {
			return err
		}
	}
	if bumpEmoji == "" {
		// Nothing to record (a no-op clear of an empty slot): commit the prop
		// state only, without advancing the version for a preference that
		// could not have moved.
		if _, err := tx.ExecContext(ctx, `UPDATE ai_session_meta SET updated_at = ? WHERE session_key = ?`, now, key); err != nil {
			return err
		}
		return tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, '1')
		ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(ai_schema_meta.value AS INTEGER) + 1 AS TEXT)`,
		emojiPrefVersionKey); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE ai_session_meta SET updated_at = ? WHERE session_key = ?`, now, key); err != nil {
		return err
	}
	return tx.Commit()
}

// OpenSQLiteIndex opens the shared AI-session sqlite index (caller closes).
// Exported so control-surface packages can run index-level transactions while
// keeping the manager's open/close bookkeeping in one place.
func (m *Manager) OpenSQLiteIndex() (*SQLiteIndex, error) {
	return m.openSQLiteIndex()
}
