// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"strings"
	"sync"
	"time"
)

const (
	// summariesBatchConcurrency bounds parallel live-registry resolution.
	summariesBatchConcurrency = 4
	// summariesBatchTimeout bounds the whole batch so a slow index open cannot
	// stall a caller that only wants "whatever the index already knows".
	summariesBatchTimeout = 2 * time.Second
)

// ResolveSummaries resolves many session identifiers against the index in one
// pass, honouring the scan contract in
// .trellis/spec/snorkeling-docs/backend/aisessions-scan-contract.md.
//
// Why this exists: calling Manager.Summary once per live session looks harmless
// but is not. Summary -> resolveSession -> refreshAllSummaries, so a cache miss
// on N identifiers can fan out into N full scans. This function does:
//
//  1. live-registry lookup (in-memory, free) for every identifier,
//  2. one SQLite GetSession per unresolved identifier (primary-key lookup,
//     single row, no file IO),
//  3. bounded-concurrency Summary for whatever is still unresolved.
//
// Unresolved identifiers are reported in missing rather than as an error: a
// live session that has not been indexed yet is normal, not a failure.
func (m *Manager) ResolveSummaries(ctx context.Context, identifiers []string) (resolved map[string]SessionSummary, missing []string) {
	resolved = make(map[string]SessionSummary, len(identifiers))
	if len(identifiers) == 0 {
		return resolved, nil
	}

	remaining := make([]string, 0, len(identifiers))
	seen := make(map[string]bool, len(identifiers))
	for _, identifier := range identifiers {
		identifier = strings.TrimSpace(identifier)
		if identifier == "" || seen[identifier] {
			continue
		}
		seen[identifier] = true
		if summary, ok := m.resolveLiveSummary(ctx, identifier); ok {
			resolved[identifier] = summary
			continue
		}
		remaining = append(remaining, identifier)
	}

	remaining = m.resolveSummariesFromIndex(ctx, remaining, resolved)

	var wg sync.WaitGroup
	var mu sync.Mutex
	sem := make(chan struct{}, summariesBatchConcurrency)
	for _, identifier := range remaining {
		wg.Add(1)
		sem <- struct{}{}
		go func(identifier string) {
			defer wg.Done()
			defer func() { <-sem }()
			sumCtx, cancel := context.WithTimeout(ctx, summariesBatchTimeout)
			defer cancel()
			summary, err := m.Summary(sumCtx, identifier, false)
			if err != nil {
				mu.Lock()
				missing = append(missing, identifier)
				mu.Unlock()
				return
			}
			mu.Lock()
			resolved[identifier] = summary
			mu.Unlock()
		}(identifier)
	}
	wg.Wait()
	return resolved, missing
}

// resolveLiveSummary returns the in-process summary for a session the GUI chat
// registry knows about, so a brand-new session resolves without touching disk.
func (m *Manager) resolveLiveSummary(ctx context.Context, identifier string) (SessionSummary, bool) {
	if m.remoteOnly() {
		return SessionSummary{}, false
	}
	registered, ok := lookupLiveSession(identifier)
	if !ok {
		return SessionSummary{}, false
	}
	m.applySessionMeta(ctx, &registered)
	return registered, true
}

// resolveSummariesFromIndex does one SQLite open and N primary-key lookups,
// which is the cheap path. It returns the identifiers that the index did not
// have (or that failed to load) for the caller to escalate.
func (m *Manager) resolveSummariesFromIndex(ctx context.Context, identifiers []string, resolved map[string]SessionSummary) []string {
	if len(identifiers) == 0 {
		return nil
	}
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil || sqliteIdx == nil {
		return identifiers
	}
	defer sqliteIdx.Close()

	unresolved := make([]string, 0, len(identifiers))
	for _, identifier := range identifiers {
		if ctx.Err() != nil {
			unresolved = append(unresolved, identifier)
			continue
		}
		summary, getErr := sqliteIdx.GetSession(ctx, identifier)
		if getErr != nil || strings.TrimSpace(summary.Key) == "" {
			unresolved = append(unresolved, identifier)
			continue
		}
		resolved[identifier] = summary
	}
	return unresolved
}
