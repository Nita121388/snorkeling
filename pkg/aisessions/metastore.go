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
	UpdatedAt int64  `json:"updatedAt,omitempty"`
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
		summary.TitleSource = "user"
	}
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
	meta.UpdatedAt = time.Now().UnixMilli()
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
