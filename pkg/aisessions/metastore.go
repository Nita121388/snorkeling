// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const metaVersion = 1

type metaData struct {
	Version  int                    `json:"version"`
	Sessions map[string]sessionMeta `json:"sessions"`
}

type sessionMeta struct {
	Marked    bool   `json:"marked,omitempty"`
	Note      string `json:"note,omitempty"`
	Title     string `json:"title,omitempty"`
	// TitleSource distinguishes a hand-written / user-applied title ("user")
	// from a background AI-generated one ("ai"). Empty on legacy rows, which
	// are treated as "user".
	TitleSource string `json:"titleSource,omitempty"`
	// AI title auto-generation idempotency markers: attempted>0 means a
	// generation was already tried (success or failure) and must not repeat.
	AITitleAttemptedAt         int64 `json:"aiTitleAttemptedAt,omitempty"`
	AITitleAttemptMessageCount int   `json:"aiTitleAttemptMessageCount,omitempty"`
	UpdatedAt                  int64 `json:"updatedAt,omitempty"`
	// NOTE: custom properties are intentionally NOT stored in this legacy JSON
	// meta store. They live only in sqlite (`ai_session_props`). Mirroring them
	// here once caused a data-loss hazard: the JSON->sqlite migration could
	// overwrite a real sqlite note with the empty note of a JSON entry that was
	// created by a props-only write. Keep props sqlite-only.
}

type MetaStore struct {
	path string
	data metaData
}

func OpenMeta(path string) (*MetaStore, error) {
	if path == "" {
		path = DefaultMetaPath()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	store := &MetaStore{
		path: path,
		data: metaData{
			Version:  metaVersion,
			Sessions: make(map[string]sessionMeta),
		},
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *MetaStore) Close() error {
	return nil
}

func (s *MetaStore) Marked(key string) bool {
	return s.data.Sessions[key].Marked
}

func (s *MetaStore) Note(key string) string {
	return s.data.Sessions[key].Note
}

func (s *MetaStore) Apply(summary *SessionSummary) {
	if summary == nil {
		return
	}
	meta := s.data.Sessions[summary.Key]
	summary.Marked = meta.Marked
	summary.Note = meta.Note
	if meta.Title != "" {
		summary.Title = meta.Title
		summary.TitleSource = normalizeTitleSource(meta.TitleSource)
	}
	summary.AITitleAttemptedAt = meta.AITitleAttemptedAt
	summary.AITitleAttemptMessageCount = meta.AITitleAttemptMessageCount
}

// normalizeTitleSource maps an empty legacy value to "user" (hand-written or
// user-applied AI title) so old rows keep their existing precedence.
func normalizeTitleSource(source string) string {
	if source == "" {
		return "user"
	}
	return source
}

func (s *MetaStore) SetMarked(ctx context.Context, key string, marked bool) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	meta := s.data.Sessions[key]
	meta.Marked = marked
	meta.UpdatedAt = time.Now().UnixMilli()
	s.data.Sessions[key] = meta
	return s.save()
}

func (s *MetaStore) SetNote(ctx context.Context, key string, note string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	meta := s.data.Sessions[key]
	meta.Note = note
	meta.UpdatedAt = time.Now().UnixMilli()
	s.data.Sessions[key] = meta
	return s.save()
}


func (s *MetaStore) SetTitle(ctx context.Context, key string, title string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	meta := s.data.Sessions[key]
	meta.Title = title
	meta.TitleSource = "user"
	meta.UpdatedAt = time.Now().UnixMilli()
	s.data.Sessions[key] = meta
	return s.save()
}

// SetAutoTitle writes an AI-generated title. The separate "ai" source keeps it
// distinguishable from a user title so a later user edit can upgrade it and so
// the auto worker never re-touches it.
func (s *MetaStore) SetAutoTitle(ctx context.Context, key string, title string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	meta := s.data.Sessions[key]
	meta.Title = title
	meta.TitleSource = "ai"
	meta.UpdatedAt = time.Now().UnixMilli()
	s.data.Sessions[key] = meta
	return s.save()
}

// MarkAITitleAttempt records that an auto-generation was attempted, regardless
// of success, so the worker never retries the same session.
func (s *MetaStore) MarkAITitleAttempt(ctx context.Context, key string, messageCount int) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	meta := s.data.Sessions[key]
	meta.AITitleAttemptedAt = time.Now().UnixMilli()
	meta.AITitleAttemptMessageCount = messageCount
	s.data.Sessions[key] = meta
	return s.save()
}

func (s *MetaStore) Delete(ctx context.Context, key string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	delete(s.data.Sessions, key)
	return s.save()
}

func (s *MetaStore) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, &s.data); err != nil {
		return err
	}
	if s.data.Version == 0 {
		s.data.Version = metaVersion
	}
	if s.data.Sessions == nil {
		s.data.Sessions = make(map[string]sessionMeta)
	}
	return nil
}

func (s *MetaStore) save() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.path)
}
