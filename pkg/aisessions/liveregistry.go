// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"os"
	"strings"
	"sync"
)

// Live session registry: the in-process source of truth for GUI chat sessions
// that exist as an agent subprocess but may not exist on disk yet.
//
// Why this exists: pi deliberately defers creating the session JSONL until the
// first assistant message arrives (SessionManager._persist skips writing until
// an assistant entry exists). A file-scan-based resolver can therefore never
// see a brand-new session, which used to surface as "session not found" right
// after the chat stream handed the frontend a freshly assigned sessionId.
//
// The registry holds a provisional SessionSummary seeded by the chat service
// at session attach (id + planned file path from get_state, title from the
// first prompt line). Manager.resolveSession consults it before touching
// SQLite or scanning provider directories, and upgrades the entry with real
// disk data as soon as the file becomes parseable. Entries are process-local;
// after an app restart the pure file model takes over again.

type liveSessionRegistry struct {
	mu    sync.RWMutex
	byKey map[string]SessionSummary // key: StableKey(source, id, filePath)
}

var liveSessions = &liveSessionRegistry{byKey: make(map[string]SessionSummary)}

// liveSummaryReady reports whether the registry summary's file is readable on
// disk (i.e. the provider persisted at least the header).
func liveSummaryReady(summary SessionSummary) bool {
	if strings.TrimSpace(summary.FilePath) == "" {
		return false
	}
	info, err := os.Stat(summary.FilePath)
	return err == nil && info != nil
}

// RegisterLiveSession records a provisional summary for a live GUI chat
// session. Existing entries are merged: a non-empty title on the new entry
// replaces a placeholder, otherwise the previous title is kept so a GUI
// rename (stored in the meta store) is not clobbered by a later attach.
func RegisterLiveSession(summary SessionSummary) {
	if summary.ID == "" {
		return
	}
	liveSessions.mu.Lock()
	defer liveSessions.mu.Unlock()
	if existing, ok := liveSessions.byKey[summary.Key]; ok {
		if strings.TrimSpace(summary.Title) == "" {
			summary.Title = existing.Title
			summary.TitleSource = existing.TitleSource
		}
		if summary.FilePath == "" {
			summary.FilePath = existing.FilePath
		}
		if summary.ProjectPath == "" {
			summary.ProjectPath = existing.ProjectPath
		}
		if summary.CreatedAt == 0 {
			summary.CreatedAt = existing.CreatedAt
		}
	}
	summary.Live = true
	liveSessions.byKey[summary.Key] = summary
}

// RemoveLiveSession drops registry entries matching the identifier (Key, ID,
// or file path). Unknown identifiers are ignored.
func RemoveLiveSession(identifier string) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return
	}
	liveSessions.mu.Lock()
	defer liveSessions.mu.Unlock()
	for key, summary := range liveSessions.byKey {
		if summary.Key == identifier || summary.ID == identifier || summary.FilePath == identifier {
			delete(liveSessions.byKey, key)
		}
	}
}

// lookupLiveSession resolves an identifier to a registered live summary.
// Accepts exact Key or full session ID (no prefix matching: chat flows always
// hold the exact id from get_state).
func lookupLiveSession(identifier string) (SessionSummary, bool) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, false
	}
	liveSessions.mu.RLock()
	defer liveSessions.mu.RUnlock()
	if summary, ok := liveSessions.byKey[identifier]; ok {
		return summary, true
	}
	for _, summary := range liveSessions.byKey {
		if summary.ID == identifier {
			return summary, true
		}
	}
	return SessionSummary{}, false
}

// updateLiveSession replaces a registry entry (used when disk data upgrades
// the provisional summary).
func updateLiveSession(summary SessionSummary) {
	if summary.ID == "" {
		return
	}
	liveSessions.mu.Lock()
	defer liveSessions.mu.Unlock()
	summary.Live = true
	liveSessions.byKey[summary.Key] = summary
}

// LiveSessionCount returns how many live sessions are registered (diagnostics).
func LiveSessionCount() int {
	liveSessions.mu.RLock()
	defer liveSessions.mu.RUnlock()
	return len(liveSessions.byKey)
}
