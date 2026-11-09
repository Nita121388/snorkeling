// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
	_ "modernc.org/sqlite"
)

// ErrBaseRevMismatch signals that the client's baseRev is behind the server head, so the push
// must be reconciled rather than applied.
var ErrBaseRevMismatch = errors.New("base revision mismatch")

// Store is the server-side snapshot database.
//
// Two tables only: items and a one-row meta table for the head revision. The item columns mirror
// Common Text's own columns so the desktop client can map a row straight onto its model; the
// server never interprets item content, it only stores and merges by revision.
type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, fmt.Errorf("opening sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite + WAL: one writer keeps the merge logic simple.
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_items (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    body          TEXT,
    shortcut      TEXT,
    tags          TEXT,
    pinned        INTEGER NOT NULL DEFAULT 0,
    createdat     REAL,
    updatedat     REAL,
    lastusedat    REAL,
    usagecount    REAL,
    emoji         TEXT,
    createdby_kind TEXT,
    createdby_name TEXT,
    origin_deviceid   TEXT,
    origin_devicename TEXT,
    origin_platform   TEXT,
    rev           REAL NOT NULL DEFAULT 0,
    deletedat     REAL
);
CREATE INDEX IF NOT EXISTS idx_sync_items_rev ON sync_items(rev);
INSERT OR IGNORE INTO sync_meta(key, value) VALUES ('rev', 0);
`)
	return err
}

func (s *Store) headRev() (float64, error) {
	var rev float64
	err := s.db.QueryRow(`SELECT value FROM sync_meta WHERE key = 'rev'`).Scan(&rev)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return rev, err
}

func (s *Store) setHeadRev(rev float64) error {
	_, err := s.db.Exec(`UPDATE sync_meta SET value = ? WHERE key = 'rev'`, rev)
	return err
}

// Stats returns item count (including tombstones, because a client needs to know they exist)
// and the head revision.
func (s *Store) Stats() (int, float64, error) {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sync_items`).Scan(&count); err != nil {
		return 0, 0, err
	}
	rev, err := s.headRev()
	return count, rev, err
}

// SnapshotSince returns items with rev > since (all items when since is 0).
func (s *Store) SnapshotSince(since float64) (syncproto.Snapshot, error) {
	rows, err := s.db.Query(`
SELECT id, title, body, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount,
       emoji, createdby_kind, createdby_name, origin_deviceid, origin_devicename, origin_platform,
       rev, deletedat
FROM sync_items WHERE rev > ? ORDER BY rev ASC`, since)
	if err != nil {
		return syncproto.Snapshot{}, err
	}
	defer rows.Close()

	var items []syncproto.SnapshotItem
	for rows.Next() {
		var it syncproto.SnapshotItem
		var title, body, shortcut, tags, emoji sql.NullString
		var cbKind, cbName, origId, origName, origPlatform sql.NullString
		var createdAt, updatedAt, lastUsedAt, usageCount, rev, deletedAt sql.NullFloat64
		var pinned sql.NullBool
		if err := rows.Scan(&it.Id, &title, &body, &shortcut, &tags, &pinned, &createdAt, &updatedAt,
			&lastUsedAt, &usageCount, &emoji, &cbKind, &cbName, &origId, &origName, &origPlatform,
			&rev, &deletedAt); err != nil {
			return syncproto.Snapshot{}, err
		}
		it.Title = title.String
		it.Text = body.String
		it.Shortcut = shortcut.String
		it.Pinned = pinned.Bool
		it.CreatedAt = createdAt.Float64
		it.UpdatedAt = updatedAt.Float64
		it.LastUsedAt = lastUsedAt.Float64
		it.UsageCount = usageCount.Float64
		it.Emoji = emoji.String
		it.Rev = rev.Float64
		it.DeletedAt = deletedAt.Float64
		it.Tags = splitTags(tags.String)
		if cbKind.Valid || cbName.Valid {
			it.CreatedBy = &syncproto.Author{Kind: cbKind.String, Name: cbName.String}
		}
		if origId.Valid || origName.Valid || origPlatform.Valid {
			it.Origin = &syncproto.Origin{
				DeviceId: origId.String, DeviceName: origName.String, Platform: origPlatform.String,
			}
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return syncproto.Snapshot{}, err
	}
	rev, err := s.headRev()
	if err != nil {
		return syncproto.Snapshot{}, err
	}
	return syncproto.Snapshot{Rev: rev, Items: items}, nil
}

// Apply merges a push.
//
// The merge rule follows the client's row-merge policy so both sides agree on outcomes:
//
//   - an item the server has not seen        → insert
//   - a newer item (higher updatedat)        → overwrite
//   - an older or equal item                 → keep server copy, report a conflict
//   - a tombstone with rev >= server's rev    → delete wins (deleting must not be resurrected)
//
// baseRev is compared with the server head before anything is applied: a mismatch means another
// device wrote in between and the client must reconcile first, so we refuse the whole batch
// instead of applying a partial, out-of-order set.
func (s *Store) Apply(req syncproto.PushRequest) (syncproto.PushResponse, error) {
	head, err := s.headRev()
	if err != nil {
		return syncproto.PushResponse{}, err
	}
	if req.BaseRev != head {
		return syncproto.PushResponse{}, ErrBaseRevMismatch
	}

	tx, err := s.db.Begin()
	if err != nil {
		return syncproto.PushResponse{}, err
	}
	defer tx.Rollback()

	resp := syncproto.PushResponse{Rev: head, Conflicts: []syncproto.Conflict{}}
	newRev := head
	baseById := make(map[string]*syncproto.SnapshotItem, len(req.Base))
	for idx := range req.Base {
		if req.Base[idx].Id != "" {
			baseById[req.Base[idx].Id] = &req.Base[idx]
		}
	}
	for _, it := range req.Items {
		if it.Id == "" {
			continue
		}
		nextRev := newRev + 1
		if it.Rev > nextRev {
			nextRev = it.Rev
		}

		existing, found, err := itemByIDTx(tx, it.Id)
		if err != nil {
			return syncproto.PushResponse{}, err
		}
		if !found {
			if err := upsertItem(tx, it, nextRev); err != nil {
				return syncproto.PushResponse{}, err
			}
			resp.Applied++
			resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: nextRev, Status: syncproto.PushStatusApplied})
			newRev = nextRev
			continue
		}

		// Tombstone wins over a live copy with an older revision: a delete must not be resurrected
		// by a device that simply missed it.
		if it.DeletedAt > 0 && it.Rev >= existing.Rev {
			if err := upsertItem(tx, it, nextRev); err != nil {
				return syncproto.PushResponse{}, err
			}
			resp.Applied++
			resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: nextRev, Status: syncproto.PushStatusApplied})
			newRev = nextRev
			continue
		}

		// No base means this is the first sync of an item that already exists on both sides: there
		// is no common ancestor, so field-level attribution is impossible. Fall back to the only
		// signal available (updatedat, whole item) instead of reporting every first-sync difference
		// as a conflict — that would bury the user in noise on day one.
		base := baseById[it.Id]
		if base == nil {
			if it.UpdatedAt > existing.UpdatedAt {
				if err := upsertItem(tx, it, nextRev); err != nil {
					return syncproto.PushResponse{}, err
				}
				resp.Applied++
				resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: nextRev, Status: syncproto.PushStatusApplied})
				newRev = nextRev
			} else {
				resp.Unchanged++
				resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: existing.Rev, Status: syncproto.PushStatusUnchanged})
			}
			continue
		}

		// Three-way merge: compare local (pushed) and remote (stored) against the base the client
		// last synced. Only fields BOTH sides changed differently are a conflict; everything else
		// merges automatically.
		conflictFields := syncproto.DetectConflictFields(base, &it, existing)
		if len(conflictFields) == 0 {
			merged, changed := mergeItems(base, &it, existing)
			if changed {
				if err := upsertItem(tx, merged, nextRev); err != nil {
					return syncproto.PushResponse{}, err
				}
				resp.Applied++
				resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: nextRev, Status: syncproto.PushStatusApplied})
				newRev = nextRev
			} else {
				resp.Unchanged++
				resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: existing.Rev, Status: syncproto.PushStatusUnchanged})
			}
			continue
		}

		// Real conflict: keep the server copy and hand BOTH versions back so the client can show
		// a diff and let a human (or an agent) merge it.
		localCopy := it
		remoteCopy := *existing
		resp.Items = append(resp.Items, syncproto.PushItemResult{Id: it.Id, Rev: existing.Rev, Status: syncproto.PushStatusConflict})
		resp.Conflicts = append(resp.Conflicts, syncproto.Conflict{
			Id:     it.Id,
			Fields: conflictFields,
			Local:  &localCopy,
			Remote: &remoteCopy,
			Reason: "both sides changed " + joinFields(conflictFields),
		})
	}
	if err := setHeadRevTx(tx, newRev); err != nil {
		return syncproto.PushResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return syncproto.PushResponse{}, err
	}
	resp.Rev = newRev
	return resp, nil
}

func setHeadRevTx(tx *sql.Tx, rev float64) error {
	_, err := tx.Exec(`UPDATE sync_meta SET value = ? WHERE key = 'rev'`, rev)
	return err
}

func upsertItem(tx *sql.Tx, it syncproto.SnapshotItem, rev float64) error {
	var cbKind, cbName, origId, origName, origPlatform any
	if it.CreatedBy != nil {
		cbKind, cbName = it.CreatedBy.Kind, it.CreatedBy.Name
	}
	if it.Origin != nil {
		origId, origName, origPlatform = it.Origin.DeviceId, it.Origin.DeviceName, it.Origin.Platform
	}
	var deletedAt any
	if it.DeletedAt > 0 {
		deletedAt = it.DeletedAt
	}
	_, err := tx.Exec(`
INSERT INTO sync_items (
    id, title, body, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount,
    emoji, createdby_kind, createdby_name, origin_deviceid, origin_devicename, origin_platform,
    rev, deletedat
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, body=excluded.body, shortcut=excluded.shortcut, tags=excluded.tags,
    pinned=excluded.pinned, createdat=excluded.createdat, updatedat=excluded.updatedat,
    lastusedat=excluded.lastusedat, usagecount=excluded.usagecount, emoji=excluded.emoji,
    createdby_kind=excluded.createdby_kind, createdby_name=excluded.createdby_name,
    origin_deviceid=excluded.origin_deviceid, origin_devicename=excluded.origin_devicename,
    origin_platform=excluded.origin_platform, rev=excluded.rev, deletedat=excluded.deletedat`,
		it.Id, it.Title, it.Text, it.Shortcut, joinTags(it.Tags), it.Pinned,
		it.CreatedAt, it.UpdatedAt, it.UpdatedAt, it.UsageCount, it.Emoji,
		cbKind, cbName, origId, origName, origPlatform, rev, deletedAt)
	return err
}

// Tags are stored as a newline-joined string: Common Text tags cannot contain newlines, so this
// needs no escaping and stays readable in a sqlite dump.
func joinTags(tags []string) string {
	out := ""
	for i, t := range tags {
		if i > 0 {
			out += "\n"
		}
		out += t
	}
	return out
}

func splitTags(raw string) []string {
	if raw == "" {
		return nil
	}
	var out []string
	start := 0
	for i := 0; i <= len(raw); i++ {
		if i == len(raw) || raw[i] == '\n' {
			if i > start {
				out = append(out, raw[start:i])
			}
			start = i + 1
		}
	}
	return out
}

var _ = time.Now

// itemByIDTx loads one stored item in wire form (nil when absent).
func itemByIDTx(tx *sql.Tx, id string) (*syncproto.SnapshotItem, bool, error) {
	row := tx.QueryRow(`SELECT id, title, body, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount,
       emoji, createdby_kind, createdby_name, origin_deviceid, origin_devicename, origin_platform,
       rev, deletedat
FROM sync_items WHERE id = ?`, id)
	var it syncproto.SnapshotItem
	var title, body, shortcut, tags, emoji sql.NullString
	var cbKind, cbName, origId, origName, origPlatform sql.NullString
	var createdAt, updatedAt, lastUsedAt, usageCount, rev, deletedAt sql.NullFloat64
	var pinned sql.NullBool
	err := row.Scan(&it.Id, &title, &body, &shortcut, &tags, &pinned, &createdAt, &updatedAt,
		&lastUsedAt, &usageCount, &emoji, &cbKind, &cbName, &origId, &origName, &origPlatform,
		&rev, &deletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	it.Title = title.String
	it.Text = body.String
	it.Shortcut = shortcut.String
	it.Pinned = pinned.Bool
	it.CreatedAt = createdAt.Float64
	it.UpdatedAt = updatedAt.Float64
	it.LastUsedAt = lastUsedAt.Float64
	it.UsageCount = usageCount.Float64
	it.Emoji = emoji.String
	it.Rev = rev.Float64
	it.DeletedAt = deletedAt.Float64
	it.Tags = splitTags(tags.String)
	if cbKind.Valid || cbName.Valid {
		it.CreatedBy = &syncproto.Author{Kind: cbKind.String, Name: cbName.String}
	}
	if origId.Valid || origName.Valid || origPlatform.Valid {
		it.Origin = &syncproto.Origin{
			DeviceId: origId.String, DeviceName: origName.String, Platform: origPlatform.String,
		}
	}
	return &it, true, nil
}

// mergeItems combines non-conflicting changes: per field, take whichever side diverged from base.
//
// It reports whether anything actually changed, so an idempotent push (client re-sending the same
// row) does not bump the head revision forever.
func mergeItems(base, local, remote *syncproto.SnapshotItem) (syncproto.SnapshotItem, bool) {
	merged := *remote // start from the server copy; overwrite only the fields local changed
	changed := false

	pick := func(baseVal, localVal, remoteVal string) string {
		if localVal == remoteVal {
			return remoteVal
		}
		if localVal == baseVal {
			return remoteVal // only remote changed
		}
		return localVal // only local changed
	}

	text := pick(baseText(base), local.Text, remote.Text)
	if text != remote.Text {
		merged.Text = text
		changed = true
	}
	title := pick(baseTitle(base), local.Title, remote.Title)
	if title != remote.Title {
		merged.Title = title
		changed = true
	}
	shortcut := pick(baseShortcut(base), local.Shortcut, remote.Shortcut)
	if shortcut != remote.Shortcut {
		merged.Shortcut = shortcut
		changed = true
	}
	localTags := syncproto.JoinTags(local.Tags)
	remoteTags := syncproto.JoinTags(remote.Tags)
	tags := pick(syncproto.JoinTags(baseTags(base)), localTags, remoteTags)
	if tags != remoteTags {
		merged.Tags = syncproto.SplitTags(tags)
		changed = true
	}

	// Scalar metadata: the newer updatedat wins as a whole, but only when content merged cleanly.
	if local.UpdatedAt > remote.UpdatedAt {
		merged.UpdatedAt = local.UpdatedAt
		merged.LastUsedAt = local.LastUsedAt
		merged.UsageCount = local.UsageCount
		merged.Pinned = local.Pinned
		merged.Emoji = local.Emoji
		if remote.DeletedAt == 0 && local.DeletedAt > 0 {
			merged.DeletedAt = local.DeletedAt
		}
	}
	return merged, changed
}

func baseText(b *syncproto.SnapshotItem) string {
	if b == nil {
		return ""
	}
	return b.Text
}
func baseTitle(b *syncproto.SnapshotItem) string {
	if b == nil {
		return ""
	}
	return b.Title
}
func baseShortcut(b *syncproto.SnapshotItem) string {
	if b == nil {
		return ""
	}
	return b.Shortcut
}
func baseTags(b *syncproto.SnapshotItem) []string {
	if b == nil {
		return nil
	}
	return b.Tags
}

// joinFields renders ["text","title"] as "text, title" for a human-readable reason string.
func joinFields(fields []string) string {
	out := ""
	for i, f := range fields {
		if i > 0 {
			out += ", "
		}
		out += f
	}
	return out
}
