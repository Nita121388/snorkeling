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

	resp := syncproto.PushResponse{Rev: head}
	newRev := head
	for _, it := range req.Items {
		if it.Id == "" {
			continue
		}
		nextRev := newRev + 1
		if it.Rev > nextRev {
			nextRev = it.Rev
		}

		var existingUpdated, existingRev sql.NullFloat64
		err := tx.QueryRow(`SELECT updatedat, rev FROM sync_items WHERE id = ?`, it.Id).
			Scan(&existingUpdated, &existingRev)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			if err := upsertItem(tx, it, nextRev); err != nil {
				return syncproto.PushResponse{}, err
			}
			resp.Applied++
			newRev = nextRev
		case err != nil:
			return syncproto.PushResponse{}, err
		default:
			// Tombstone wins over a live copy with an older revision.
			if it.DeletedAt > 0 && it.Rev >= existingRev.Float64 {
				if err := upsertItem(tx, it, nextRev); err != nil {
					return syncproto.PushResponse{}, err
				}
				resp.Applied++
				newRev = nextRev
				continue
			}
			if it.UpdatedAt > existingUpdated.Float64 {
				if err := upsertItem(tx, it, nextRev); err != nil {
					return syncproto.PushResponse{}, err
				}
				resp.Applied++
				newRev = nextRev
				continue
			}
			resp.Conflicts = append(resp.Conflicts, syncproto.Conflict{
				Id:     it.Id,
				Reason: "server has a newer or equal updatedat; keeping server copy",
			})
		}
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
