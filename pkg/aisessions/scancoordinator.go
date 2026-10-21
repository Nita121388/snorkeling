// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A full summary scan reads every session file's head/tail window. On machines
// with thousands of sessions (~/.pi can hold >1GB of JSONL) running that scan
// once per RPC used to exhaust the Windows commit limit and kill wavesrv with
// "fatal error: out of memory". Everything here exists to make a full scan:
//
//  1. single-flight — at most one scan per index path is in flight process-wide,
//     so N concurrent RPCs share one scan instead of racing N of them;
//  2. budget-bound — a scan stops when its budget expires and reports Partial;
//  3. newest-first — files are visited by descending mtime, so the sessions a
//     user is most likely to open land in the index first;
//  4. observable — progress is reported through a callback so the service layer
//     can drive a skeleton/progress UI without pkg/aisessions importing wps.

const (
	defaultSummaryScanBudget = 8 * time.Second
	maxSummaryScanBudget     = 2 * time.Minute

	// backgroundScanBudget is the budget for a scan kicked off by the list RPC.
	// It runs off the request path, so it may take longer than the synchronous
	// budget; if it is still cut short the next list call resumes the scan.
	backgroundScanBudget = 60 * time.Second

	// scanProgressEvery is how many files are parsed between progress callbacks.
	scanProgressEvery = 25
)

// backgroundScans ensures at most one background scan per index path.
var backgroundScans summaryRefreshTracker

// scanProgressState keeps the last progress tick per scan key so a list RPC can
// report scan state without joining the scan.
var scanProgressState = struct {
	mu sync.Mutex
	m  map[string]ScanProgress
}{m: map[string]ScanProgress{}}

func recordScanProgress(key string, progress ScanProgress) {
	scanProgressState.mu.Lock()
	defer scanProgressState.mu.Unlock()
	scanProgressState.m[key] = progress
}

// scanProgressSnapshot reports (scanned, total, scanning) for the UI. A partial
// scan still counts as scanning: the background pass will continue it.
func scanProgressSnapshot(key string) (int, int, bool) {
	scanProgressState.mu.Lock()
	defer scanProgressState.mu.Unlock()
	progress, ok := scanProgressState.m[key]
	if !ok || progress.Total == 0 {
		return 0, 0, false
	}
	scanning := progress.Running || (progress.Done && progress.Partial)
	return progress.Scanned, progress.Total, scanning
}

// ScanProgress is one progress tick of a summary scan.
type ScanProgress struct {
	Total   int
	Scanned int
	Running bool
	Done    bool
	Partial bool
}

// ScanOptions tunes a ScanAllSummaries call.
type ScanOptions struct {
	// Budget caps how long the scan runs. Zero uses the env/default budget.
	Budget time.Duration
	// Progress is called from the scanning goroutine; it must not block.
	Progress func(ScanProgress)
}

// summaryScanBudget resolves the scan budget from the environment.
func summaryScanBudget() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SNORKELING_AISESSIONS_SCAN_BUDGET_MS"))
	if raw == "" {
		return defaultSummaryScanBudget
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return defaultSummaryScanBudget
	}
	budget := time.Duration(ms) * time.Millisecond
	if budget > maxSummaryScanBudget {
		return maxSummaryScanBudget
	}
	return budget
}

// blockingSummaryScanEnabled is the escape hatch that restores the pre-fix
// behaviour (synchronous, possibly concurrent full scans).
func blockingSummaryScanEnabled() bool {
	value := strings.TrimSpace(os.Getenv("SNORKELING_AISESSIONS_BLOCKING_SCAN"))
	return value != "" && value != "0" && !strings.EqualFold(value, "false")
}

// summaryParseMaxFileBytes gates expensive per-file parsing (full-file title
// scan). Files above the gate still get a head/tail summary.
var defaultSummaryParseMaxFileBytes int64 = 32 * 1024 * 1024

func summaryParseMaxFileBytes() int64 {
	return envInt64("SNORKELING_AISESSIONS_SCAN_MAX_FILE_BYTES", defaultSummaryParseMaxFileBytes)
}

// titleScanMaxBytes caps how much of a session file scanTitle may read.
var defaultTitleScanMaxBytes int64 = 1024 * 1024

func titleScanMaxBytes() int64 {
	return envInt64("SNORKELING_AISESSIONS_TITLE_SCAN_MAX_BYTES", defaultTitleScanMaxBytes)
}

// defaultMessageCountBudgetBytes caps how much message text populateMessageCounts
// may parse in one call. Sessions past the budget keep their stored count.
var defaultMessageCountBudgetBytes int64 = 128 * 1024 * 1024

// defaultMessageCountBudgetDuration caps how long one List call may spend
// parsing message bodies. The web service timeout is 21s by default
// (web:servicetimeoutms, max 60s); overshooting it makes the browser report
// `net::ERR_EMPTY_RESPONSE` with no backend error at all. The default keeps the
// whole RPC (scan + parse + serialize) inside that window.
var defaultMessageCountBudgetDuration = 5 * time.Second

func messageCountBudgetBytes() int64 {
	return envInt64("SNORKELING_AISESSIONS_MSG_BUDGET_BYTES", defaultMessageCountBudgetBytes)
}

func messageCountBudgetDuration() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SNORKELING_AISESSIONS_MSG_BUDGET_MS"))
	if raw == "" {
		return defaultMessageCountBudgetDuration
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return defaultMessageCountBudgetDuration
	}
	return time.Duration(ms) * time.Millisecond
}

// defaultListBudgetDuration bounds one List RPC end to end (scan + message
// counts + serialization). The web layer closes the HTTP connection when a
// handler outlives HttpWriteTimeout / web:servicetimeoutms (21s by default), and
// the browser then reports `net::ERR_EMPTY_RESPONSE` with no backend error --
// which is exactly the "AI sessions won't load" symptom. Staying well under that
// window turns a dead request into a partial (but useful) response.
var defaultListBudgetDuration = 10 * time.Second

func listBudgetDuration() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SNORKELING_AISESSIONS_LIST_BUDGET_MS"))
	if raw == "" {
		return defaultListBudgetDuration
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return defaultListBudgetDuration
	}
	return time.Duration(ms) * time.Millisecond
}

func envInt64(name string, fallback int64) int64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

// scanFlight is one in-flight (or just-finished) shared full scan.
type scanFlight struct {
	done      chan struct{}
	summaries []SessionSummary
	errs      []error
	partial   bool
}

var scanFlights = struct {
	mu sync.Mutex
	m  map[string]*scanFlight
}{m: map[string]*scanFlight{}}

// scanKey identifies the scan domain: one index file (one profile / one remote
// connection) plus the provider set behind it.
func (m *Manager) scanKey() string {
	sources := make([]string, 0, len(m.Providers))
	for _, provider := range m.Providers {
		sources = append(sources, provider.Source())
	}
	sort.Strings(sources)
	return m.SQLitePath + "\x00" + strings.Join(sources, ",")
}

// ScanAllSummaries scans every provider, sharing one scan across concurrent
// callers. The returned bool is true when the scan was cut short (budget
// expired or the caller's context ended) and the result set is therefore
// partial and must not be recorded as a complete scan.
func (m *Manager) ScanAllSummaries(ctx context.Context, opts ScanOptions) ([]SessionSummary, []error, bool) {
	if blockingSummaryScanEnabled() {
		summaries, errs := ScanSummaries(ctx, m.Providers)
		return summaries, errs, ctx.Err() != nil
	}

	budget := opts.Budget
	if budget <= 0 {
		budget = summaryScanBudget()
	}
	key := m.scanKey()

	scanFlights.mu.Lock()
	if flight, ok := scanFlights.m[key]; ok {
		scanFlights.mu.Unlock()
		select {
		case <-flight.done:
			return flight.summaries, flight.errs, flight.partial
		case <-ctx.Done():
			return nil, []error{ctx.Err()}, true
		}
	}
	flight := &scanFlight{done: make(chan struct{})}
	scanFlights.m[key] = flight
	scanFlights.mu.Unlock()

	summaries, errs, partial := m.runSummaryScan(key, budget, opts.Progress)

	flight.summaries = summaries
	flight.errs = errs
	flight.partial = partial
	scanFlights.mu.Lock()
	delete(scanFlights.m, key)
	scanFlights.mu.Unlock()
	close(flight.done)

	return summaries, errs, partial
}

// scanUnit is one session file queued for parsing, paired with its provider.
type scanUnit struct {
	provider Provider
	file     SessionFile
}

// runSummaryScan performs the actual scan. It deliberately runs on a background
// context so that one caller hanging up does not abort the shared scan; it is
// still bounded by the budget.
func (m *Manager) runSummaryScan(key string, budget time.Duration, onProgress func(ScanProgress)) ([]SessionSummary, []error, bool) {
	if budget <= 0 {
		budget = summaryScanBudget()
	}
	report := func(progress ScanProgress) {
		recordScanProgress(key, progress)
		if onProgress != nil {
			onProgress(progress)
		}
	}
	scanCtx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()

	units, errs := m.collectScanUnits(scanCtx)
	if units == nil {
		// Not every provider exposes summary files (e.g. remote providers).
		// Fall back to the plain scan; it is still single-flighted and budgeted.
		summaries, scanErrs := ScanSummaries(scanCtx, m.Providers)
		errs = append(errs, scanErrs...)
		partial := scanCtx.Err() != nil
		report(ScanProgress{
			Total:   len(summaries),
			Scanned: len(summaries),
			Running: false,
			Done:    true,
			Partial: partial,
		})
		return summaries, errs, partial
	}

	total := len(units)
	report(ScanProgress{Total: total, Running: true})

	summaries := make([]SessionSummary, 0, total)
	partial := false
	for i, unit := range units {
		if scanCtx.Err() != nil {
			partial = true
			break
		}
		fileProvider, ok := unit.provider.(SummaryFileProvider)
		if !ok {
			continue
		}
		if summary, ok := fileProvider.ParseSummary(scanCtx, unit.file); ok {
			summaries = append(summaries, summary)
		}
		if (i+1)%scanProgressEvery == 0 {
			report(ScanProgress{Total: total, Scanned: i + 1, Running: true})
		}
	}
	sortSummaries(summaries)
	report(ScanProgress{
		Total:   total,
		Scanned: len(summaries),
		Running: false,
		Done:    true,
		Partial: partial,
	})
	return summaries, errs, partial
}

// collectScanUnits lists every provider's session files and orders them newest
// first, so the most recently touched sessions are parsed (and therefore
// visible) first.
//
// It returns a nil slice when any provider does not expose summary files; the
// caller then falls back to ScanSummaries.
func (m *Manager) collectScanUnits(ctx context.Context) ([]scanUnit, []error) {
	var units []scanUnit
	var errs []error
	for _, provider := range m.Providers {
		fileProvider, ok := provider.(SummaryFileProvider)
		if !ok {
			return nil, append(errs, fmt.Errorf("provider %q does not expose summary files", provider.Source()))
		}
		files, err := fileProvider.ListFiles(ctx)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", provider.Source(), err))
			continue
		}
		for _, file := range files {
			units = append(units, scanUnit{provider: provider, file: file})
		}
	}
	sort.SliceStable(units, func(i, j int) bool {
		return units[i].file.MTime > units[j].file.MTime
	})
	return units, errs
}
