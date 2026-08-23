// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	Providers  []Provider
	IndexPath  string
	MetaPath   string
	SQLitePath string
}

type ManagerOptions struct {
	Providers  []Provider
	IndexPath  string
	MetaPath   string
	SQLitePath string
}

const (
	defaultMaxMessageIndexBytesForLoad int64 = 64 * 1024 * 1024
	backgroundSummaryRefreshTimeout          = 2 * time.Minute
)

var maxMessageIndexBytesForLoad = defaultMaxMessageIndexBytesForLoad
var summaryRefreshes summaryRefreshTracker

type summaryRefreshTracker struct {
	lock     sync.Mutex
	inflight map[string]bool
}

func debugEnabled() bool {
	value := strings.TrimSpace(os.Getenv("WAVETERM_AI_SESSIONS_DEBUG"))
	return value != "" && value != "0" && strings.ToLower(value) != "false"
}

func debugf(format string, args ...any) {
	if !debugEnabled() {
		return
	}
	log.Printf("[aisessions-debug] "+format, args...)
}

func NewManager(indexPath string, providers []Provider) *Manager {
	return NewManagerWithOptions(ManagerOptions{
		Providers: providers,
		IndexPath: indexPath,
	})
}

func NewManagerWithOptions(opts ManagerOptions) *Manager {
	providers := opts.Providers
	if len(opts.Providers) == 0 {
		providers = DefaultProviders()
	}
	indexPath := opts.IndexPath
	if opts.IndexPath == "" {
		indexPath = DefaultIndexPath()
	}
	metaPath := opts.MetaPath
	if opts.MetaPath == "" {
		metaPath = DefaultMetaPath()
	}
	sqlitePath := opts.SQLitePath
	if sqlitePath == "" {
		if opts.IndexPath != "" {
			sqlitePath = filepath.Join(filepath.Dir(indexPath), filepath.Base(DefaultSQLiteIndexPath()))
		} else {
			sqlitePath = DefaultSQLiteIndexPath()
		}
	}
	return &Manager{Providers: providers, IndexPath: indexPath, MetaPath: metaPath, SQLitePath: sqlitePath}
}

func (m *Manager) openIndex() (*Index, error) {
	return OpenIndex(m.IndexPath)
}

func sqliteIndexEnabled() bool {
	value := strings.TrimSpace(os.Getenv("WAVETERM_AI_SESSIONS_SQLITE"))
	return value == "" || (value != "0" && strings.ToLower(value) != "false")
}

func metaDualWriteEnabled() bool {
	value := strings.TrimSpace(os.Getenv("WAVETERM_AI_SESSIONS_META_DUAL_WRITE"))
	return value == "" || (value != "0" && strings.ToLower(value) != "false")
}

func (m *Manager) openSQLiteIndex() (*SQLiteIndex, error) {
	if !sqliteIndexEnabled() {
		return nil, fmt.Errorf("sqlite AI session index disabled")
	}
	return OpenSQLiteIndex(m.SQLitePath, m.MetaPath)
}

func (m *Manager) List(ctx context.Context, opts ListOptions) ([]SessionSummary, error) {
	return m.ScanList(ctx, opts, "")
}

func (m *Manager) ListCached(ctx context.Context, opts ListOptions) ([]SessionSummary, error) {
	return m.List(ctx, opts)
}

func (m *Manager) Search(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	if !opts.Refresh {
		sqliteIdx, sqliteErr := m.openSQLiteIndex()
		if sqliteErr == nil && sqliteIdx != nil {
			defer sqliteIdx.Close()
			hasScan, scanErr := sqliteIdx.HasSummaryScan(ctx)
			summaries, err := sqliteIdx.Search(ctx, opts)
			if err == nil && scanErr == nil && hasScan {
				return summaries, nil
			}
			if err == nil && scanErr == nil {
				debugf("Manager.Search sqlite has no complete summary scan path=%q; falling back to scan", m.SQLitePath)
			} else if err == nil {
				debugf("Manager.Search sqlite scan marker error path=%q err=%v; falling back to scan", m.SQLitePath, scanErr)
			} else {
				debugf("Manager.Search sqlite error path=%q err=%v", m.SQLitePath, err)
			}
		} else if sqliteErr != nil {
			debugf("Manager.Search sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
		}
	}
	return m.ScanList(ctx, ListOptions{
		Source:      opts.Source,
		Project:     opts.Project,
		Limit:       opts.Limit,
		Refresh:     opts.Refresh,
		Marked:      "",
		TagFilters:  opts.TagFilters,
		TagPresence: opts.TagPresence,
	}, opts.Query)
}

func (m *Manager) SearchCached(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	return m.Search(ctx, opts)
}

func (m *Manager) ScanList(ctx context.Context, opts ListOptions, query string) ([]SessionSummary, error) {
	sessions, _, err := m.ScanListWithDistribution(ctx, opts, query)
	return sessions, err
}

// ScanListWithDistribution is ScanList plus the full projectPath distribution
// (distinct projectPath counts over sessions passing the non-project filters),
// which the path-filter UI uses to navigate the directory tree with true counts.
func (m *Manager) ScanListWithDistribution(ctx context.Context, opts ListOptions, query string) ([]SessionSummary, []ProjectPathSummary, error) {
	if !opts.Refresh {
		if summaries, dist, ok, err := m.cachedScanListWithDistribution(ctx, opts, query); ok || err != nil {
			return summaries, dist, err
		}
	}
	summaries, errs := ScanSummaries(ctx, m.Providers)
	if len(errs) > 0 && len(summaries) == 0 {
		return nil, nil, errs[0]
	}
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr != nil {
		debugf("Manager.ScanList sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
	}
	if sqliteIdx != nil {
		defer sqliteIdx.Close()
		if _, saveErrs := sqliteIdx.SaveScannedSummaries(ctx, summaries, len(errs) == 0); len(saveErrs) > 0 {
			debugf("Manager.ScanList sqlite save scanned summaries path=%q errors=%d firstErr=%v", m.SQLitePath, len(saveErrs), saveErrs[0])
		}
	}
	meta, _ := m.openMeta()
	if meta != nil {
		defer meta.Close()
	}
	query = strings.ToLower(strings.TrimSpace(query))
	baseOpts := opts
	baseOpts.Project = ""
	var filtered []SessionSummary
	dist := make(map[string]int, 16)
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return filtered, summarizeProjectPathsFromMap(dist), ctx.Err()
		}
		if sqliteIdx != nil {
			if err := sqliteIdx.ApplyMeta(ctx, &summary); err != nil {
				debugf("Manager.ScanList sqlite meta apply error key=%q err=%v", summary.Key, err)
			}
		} else if meta != nil {
			meta.Apply(&summary)
		}
		// non-project filters decide the distribution (path selection must not
		// narrow the tree the UI can navigate to), then the project filter and
		// query narrow the session list itself.
		if !summaryMatchesList(summary, baseOpts) {
			continue
		}
		dist[summary.ProjectPath]++
		if opts.Project != "" && !projectPathMatches(summary.ProjectPath, opts.Project) {
			continue
		}
		if query != "" && !summaryMatchesQuery(summary, query) {
			continue
		}
		filtered = append(filtered, summary)
	}
	sortSummaries(filtered)
	limited := limitSummaries(filtered, opts.Limit)
	m.populateMessageCounts(ctx, limited, opts.Refresh)
	return limited, summarizeProjectPathsFromMap(dist), nil
}

func (m *Manager) cachedScanList(ctx context.Context, opts ListOptions, query string) ([]SessionSummary, bool, error) {
	summaries, _, ok, err := m.cachedScanListWithDistribution(ctx, opts, query)
	return summaries, ok, err
}

func (m *Manager) cachedScanListWithDistribution(ctx context.Context, opts ListOptions, query string) ([]SessionSummary, []ProjectPathSummary, bool, error) {
	if !m.summaryFileRefreshSupported() {
		return nil, nil, false, nil
	}
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr != nil {
		debugf("Manager.cachedScanList sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
		return nil, nil, false, nil
	}
	defer sqliteIdx.Close()
	hasScan, scanErr := sqliteIdx.HasSummaryScan(ctx)
	if scanErr != nil {
		debugf("Manager.cachedScanList sqlite scan marker error path=%q err=%v", m.SQLitePath, scanErr)
		return nil, nil, false, nil
	}
	if !hasScan {
		debugf("Manager.cachedScanList sqlite has no complete summary scan path=%q", m.SQLitePath)
		return nil, nil, false, nil
	}
	if errs := m.refreshChangedSummaries(ctx, sqliteIdx); len(errs) > 0 {
		debugf("Manager.cachedScanList changed summary refresh errors=%d firstErr=%v", len(errs), errs[0])
	}
	listOpts := opts
	if strings.TrimSpace(query) != "" {
		listOpts.Limit = 0
	}
	summaries, dist, err := sqliteIdx.ListWithDistribution(ctx, listOpts)
	if err != nil {
		debugf("Manager.cachedScanList sqlite list error path=%q err=%v", m.SQLitePath, err)
		return nil, nil, false, nil
	}
	query = strings.ToLower(strings.TrimSpace(query))
	if query != "" {
		filtered := summaries[:0]
		for _, summary := range summaries {
			if ctx.Err() != nil {
				return nil, dist, true, ctx.Err()
			}
			if summaryMatchesQuery(summary, query) {
				filtered = append(filtered, summary)
			}
		}
		summaries = limitSummaries(filtered, opts.Limit)
	}
	m.populateMessageCounts(ctx, summaries, false)
	return summaries, dist, true, nil
}

func (m *Manager) summaryFileRefreshSupported() bool {
	for _, provider := range m.Providers {
		if _, ok := provider.(SummaryFileProvider); !ok {
			return false
		}
	}
	return len(m.Providers) > 0
}

func (m *Manager) refreshChangedSummaries(ctx context.Context, sqliteIdx *SQLiteIndex) []error {
	var summaries []SessionSummary
	var errs []error
	for _, provider := range m.Providers {
		fileProvider, ok := provider.(SummaryFileProvider)
		if !ok {
			errs = append(errs, fmt.Errorf("provider %q does not support summary file refresh", provider.Source()))
			continue
		}
		files, err := fileProvider.ListFiles(ctx)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if err := sqliteIdx.MarkMissingSourceFiles(ctx, provider.Source(), files); err != nil {
			errs = append(errs, err)
			continue
		}
		changedFiles, err := sqliteIdx.ChangedFiles(ctx, files)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, file := range changedFiles {
			if ctx.Err() != nil {
				errs = append(errs, ctx.Err())
				break
			}
			summary, ok := fileProvider.ParseSummary(ctx, file)
			if ok {
				summaries = append(summaries, summary)
			}
		}
	}
	if len(summaries) == 0 {
		return errs
	}
	_, saveErrs := sqliteIdx.SaveScannedSummaries(ctx, summaries, false)
	return append(errs, saveErrs...)
}

func (m *Manager) ListTags(ctx context.Context, opts ListOptions) ([]SessionTagSummary, error) {
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		hasScan, scanErr := sqliteIdx.HasSummaryScan(ctx)
		tags, err := sqliteIdx.ListTags(ctx, opts)
		if err == nil && scanErr == nil && hasScan {
			return tags, nil
		}
		if err != nil {
			debugf("Manager.ListTags sqlite error path=%q err=%v", m.SQLitePath, err)
		}
	} else if sqliteErr != nil {
		debugf("Manager.ListTags sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
	}
	sessions, err := m.ScanList(ctx, ListOptions{
		Source:      opts.Source,
		Project:     opts.Project,
		Since:       opts.Since,
		Before:      opts.Before,
		Marked:      opts.Marked,
		TagFilters:  opts.TagFilters,
		TagPresence: opts.TagPresence,
		Refresh:     opts.Refresh,
		Limit:       0,
	}, "")
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	for _, session := range sessions {
		for _, tag := range NormalizeSessionTags(session.Tags) {
			counts[tag]++
		}
	}
	tags := make([]SessionTagSummary, 0, len(counts))
	for tag, count := range counts {
		tags = append(tags, SessionTagSummary{Tag: tag, Count: count})
	}
	sortSessionTagSummaries(tags)
	return tags, nil
}

func (m *Manager) populateMessageCounts(ctx context.Context, summaries []SessionSummary, refresh bool) {
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr != nil {
		debugf("Manager.populateMessageCounts sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
	}
	if sqliteIdx != nil {
		defer sqliteIdx.Close()
	}
	var idxStore *Index
	if sqliteIdx == nil && m.shouldUseMessageIndexCache() {
		idxStore, _ = m.openIndex()
	} else {
		debugf("Manager.populateMessageCounts index skipped path=%q maxBytes=%d", m.IndexPath, maxMessageIndexBytesForLoad)
	}
	if idxStore != nil {
		defer idxStore.Close()
	}
	cacheDirty := false
	for idx := range summaries {
		if ctx.Err() != nil {
			break
		}
		var messages []Message
		if !refresh && sqliteIdx != nil {
			cachedMessages, ok, err := sqliteIdx.GetMessages(ctx, summaries[idx])
			if err == nil && ok {
				messages = cachedMessages
			} else if err != nil {
				debugf("Manager.populateMessageCounts sqlite messages error key=%q err=%v", summaries[idx].Key, err)
			}
		}
		if messages == nil && !refresh && idxStore != nil {
			cachedMessages, ok, err := idxStore.GetMessages(ctx, summaries[idx])
			if err == nil && ok {
				messages = cachedMessages
			}
		}
		if messages == nil {
			provider := providerBySource(m.Providers, summaries[idx].Source)
			if provider == nil {
				continue
			}
			loadedMessages, err := provider.LoadMessages(ctx, summaries[idx].FilePath)
			if err != nil {
				continue
			}
			messages = loadedMessages
			if sqliteIdx != nil {
				if err := sqliteIdx.SaveMessages(ctx, summaries[idx], messages); err != nil {
					debugf("Manager.populateMessageCounts sqlite save messages error key=%q err=%v", summaries[idx].Key, err)
				}
			} else if idxStore != nil {
				idxStore.saveMessages(summaries[idx], messages)
				cacheDirty = true
			}
		}
		summaries[idx].MessageCount = readableMessageCount(messages)
	}
	if cacheDirty && idxStore != nil {
		_ = idxStore.save()
	}
}

func (m *Manager) Index(ctx context.Context) (IndexStats, []error) {
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		return sqliteIdx.IndexAll(ctx, m.Providers)
	}
	debugf("Manager.Index sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
	idx, err := m.openIndex()
	if err != nil {
		return IndexStats{}, []error{err}
	}
	defer idx.Close()
	return idx.IndexAll(ctx, m.Providers)
}

func (m *Manager) Refresh(ctx context.Context) (IndexStats, []error) {
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		return sqliteIdx.RefreshSummaries(ctx, m.Providers)
	}
	debugf("Manager.Refresh sqlite open skipped path=%q err=%v", m.SQLitePath, sqliteErr)
	idx, err := m.openIndex()
	if err != nil {
		return IndexStats{}, []error{err}
	}
	defer idx.Close()
	return idx.RefreshSummaries(ctx, m.Providers)
}

func (m *Manager) Load(ctx context.Context, identifier string, opts LoadOptions) (SessionDetail, error) {
	start := time.Now()
	debugf("Manager.Load start id=%q refresh=%v includeTools=%v", identifier, opts.Refresh, opts.IncludeTools)
	summary, err := m.resolveSession(ctx, identifier, opts.Refresh)
	if err != nil {
		debugf("Manager.Load resolve error id=%q duration=%s err=%v", identifier, time.Since(start), err)
		return SessionDetail{}, err
	}
	resolveDone := time.Now()
	debugf("Manager.Load resolved id=%q key=%q source=%q file=%q duration=%s", identifier, summary.Key, summary.Source, summary.FilePath, resolveDone.Sub(start))
	messages, err := m.loadMessages(ctx, summary, opts.Refresh)
	if err != nil {
		debugf("Manager.Load messages error id=%q key=%q duration=%s err=%v", identifier, summary.Key, time.Since(resolveDone), err)
		return SessionDetail{}, err
	}
	summary.MessageCount = readableMessageCount(messages)
	detail := SessionDetail{
		Summary:  summary,
		Messages: messages,
		Cursor: SessionMessageCursor{
			ByteOffset: summary.Size,
			FileSize:   summary.Size,
			MTime:      summary.MTime,
			LastSeq:    lastMessageSeq(messages),
		},
	}
	if opts.IncludeTools {
		provider := providerBySource(m.Providers, summary.Source)
		if provider == nil {
			return SessionDetail{}, fmt.Errorf("no provider for source %q", summary.Source)
		}
		toolProvider, ok := provider.(ToolCallProvider)
		if ok {
			toolCalls, err := toolProvider.LoadToolCalls(ctx, summary.FilePath)
			if err != nil {
				debugf("Manager.Load tool calls error id=%q key=%q duration=%s err=%v", identifier, summary.Key, time.Since(start), err)
				return SessionDetail{}, err
			}
			detail.ToolCalls = toolCalls
		}
	}
	debugf("Manager.Load success id=%q key=%q messages=%d readable=%d toolCalls=%d duration=%s", identifier, summary.Key, len(messages), summary.MessageCount, len(detail.ToolCalls), time.Since(start))
	return detail, nil
}

func (m *Manager) LoadDelta(ctx context.Context, identifier string, opts LoadDeltaOptions) (MessageDelta, error) {
	summary := opts.Summary
	var err error
	if strings.TrimSpace(summary.FilePath) == "" || strings.TrimSpace(summary.Source) == "" {
		summary, err = m.resolveSession(ctx, identifier, false)
		if err != nil {
			return MessageDelta{}, err
		}
	}
	provider := providerBySource(m.Providers, summary.Source)
	if provider == nil {
		return MessageDelta{}, fmt.Errorf("no provider for source %q", summary.Source)
	}
	deltaProvider, ok := provider.(MessageDeltaProvider)
	if !ok {
		return MessageDelta{}, fmt.Errorf("provider %q does not support message delta loading", summary.Source)
	}
	delta, err := deltaProvider.LoadMessageDelta(ctx, summary.FilePath, opts.Cursor, opts.MaxBytes)
	if err != nil {
		return MessageDelta{}, err
	}
	if delta.ResetRequired {
		return delta, nil
	}
	mergedSummary := summary
	mergedSummary.MTime = delta.Cursor.MTime
	mergedSummary.Size = delta.Cursor.FileSize
	baseCount := opts.BaseCount
	if baseCount <= 0 {
		baseCount = summary.MessageCount
	}
	mergedSummary.MessageCount = baseCount + readableMessageCount(delta.Messages)
	delta.Summary = mergedSummary
	return delta, nil
}

func (m *Manager) UserLines(ctx context.Context, identifier string, opts UserLinesOptions) (UserLinesResult, error) {
	summary, err := m.resolveSession(ctx, identifier, opts.Refresh)
	if err != nil {
		return UserLinesResult{}, err
	}
	messages, err := m.loadMessages(ctx, summary, opts.Refresh)
	if err != nil {
		return UserLinesResult{}, err
	}
	userMessages := filterUserMessages(messages, opts.Query)
	limit := normalizeUserLinesLimit(opts.Limit)
	window, hasMore := userLineWindow(userMessages, opts.BeforeSeq, limit)
	nextBeforeSeq := 0
	if len(window) > 0 && hasMore {
		nextBeforeSeq = window[0].Seq
	}
	summary.MessageCount = readableMessageCount(messages)
	return UserLinesResult{
		Summary:          summary,
		Messages:         window,
		UserMessageCount: len(userMessages),
		HasMore:          hasMore,
		NextBeforeSeq:    nextBeforeSeq,
	}, nil
}

func (m *Manager) Summary(ctx context.Context, identifier string, refresh bool) (SessionSummary, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, fmt.Errorf("session id is required")
	}
	if refresh {
		if summary, ok, err := m.resolveSessionFromSQLite(ctx, identifier, false); err == nil && ok {
			m.refreshSummariesInBackground(identifier)
			return summary, nil
		} else if err != nil {
			debugf("Manager.Summary stale sqlite skipped id=%q err=%v", identifier, err)
		}
	}
	return m.resolveSession(ctx, identifier, false)
}

func (m *Manager) Mark(ctx context.Context, identifier string, marked bool) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier, false)
	if err != nil {
		return SessionSummary{}, err
	}
	var writeErr error
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		if err := sqliteIdx.SetMarked(ctx, summary.Key, marked); err != nil {
			debugf("Manager.Mark sqlite write error key=%q err=%v", summary.Key, err)
			writeErr = err
		}
	} else if sqliteErr != nil {
		debugf("Manager.Mark sqlite open skipped key=%q err=%v", summary.Key, sqliteErr)
	}
	if metaDualWriteEnabled() || writeErr != nil || sqliteIdx == nil {
		meta, err := m.openMeta()
		if meta == nil {
			if sqliteIdx != nil && writeErr == nil {
				debugf("Manager.Mark meta json dual-write open error key=%q err=%v", summary.Key, err)
				summary.Marked = marked
				return summary, nil
			}
			return SessionSummary{}, err
		}
		defer meta.Close()
		if err := meta.SetMarked(ctx, summary.Key, marked); err != nil {
			if writeErr != nil {
				return SessionSummary{}, fmt.Errorf("cannot write AI session mark to sqlite (%v) or meta json (%w)", writeErr, err)
			}
			if sqliteIdx == nil {
				return SessionSummary{}, err
			}
			debugf("Manager.Mark meta json dual-write error key=%q err=%v", summary.Key, err)
		}
	}
	summary.Marked = marked
	return summary, nil
}

func (m *Manager) Note(ctx context.Context, identifier string, note string) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier, false)
	if err != nil {
		return SessionSummary{}, err
	}
	cleanNote, _ := ExtractSessionTagsFromNote(note)
	var writeErr error
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		if err := sqliteIdx.SetNote(ctx, summary.Key, note); err != nil {
			debugf("Manager.Note sqlite write error key=%q err=%v", summary.Key, err)
			writeErr = err
		}
	} else if sqliteErr != nil {
		debugf("Manager.Note sqlite open skipped key=%q err=%v", summary.Key, sqliteErr)
	}
	if metaDualWriteEnabled() || writeErr != nil || sqliteIdx == nil {
		meta, err := m.openMeta()
		if meta == nil {
			if sqliteIdx != nil && writeErr == nil {
				debugf("Manager.Note meta json dual-write open error key=%q err=%v", summary.Key, err)
				if applyErr := sqliteIdx.ApplyMeta(ctx, &summary); applyErr != nil {
					summary.Note = cleanNote
				}
				return summary, nil
			}
			return SessionSummary{}, err
		}
		defer meta.Close()
		if err := meta.SetNote(ctx, summary.Key, cleanNote); err != nil {
			if writeErr != nil {
				return SessionSummary{}, fmt.Errorf("cannot write AI session note to sqlite (%v) or meta json (%w)", writeErr, err)
			}
			if sqliteIdx == nil {
				return SessionSummary{}, err
			}
			debugf("Manager.Note meta json dual-write error key=%q err=%v", summary.Key, err)
		}
	}
	summary.Note = cleanNote
	if sqliteIdx != nil {
		_ = sqliteIdx.ApplyMeta(ctx, &summary)
	}
	return summary, nil
}

func (m *Manager) NoteAndTags(ctx context.Context, identifier string, note string, tags []string) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier, false)
	if err != nil {
		return SessionSummary{}, err
	}
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr != nil || sqliteIdx == nil {
		return SessionSummary{}, fmt.Errorf("session tags require sqlite AI session index: %w", sqliteErr)
	}
	defer sqliteIdx.Close()
	if err := sqliteIdx.SetNoteAndTags(ctx, summary.Key, note, tags); err != nil {
		return SessionSummary{}, err
	}
	if err := sqliteIdx.ApplyMeta(ctx, &summary); err != nil {
		return SessionSummary{}, err
	}
	return summary, nil
}

func (m *Manager) SetTitle(ctx context.Context, identifier string, title string) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier, false)
	if err != nil {
		return SessionSummary{}, err
	}
	cleanTitle := strings.TrimSpace(title)
	var writeErr error
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		if err := sqliteIdx.SetTitle(ctx, summary.Key, cleanTitle); err != nil {
			debugf("Manager.SetTitle sqlite write error key=%q err=%v", summary.Key, err)
			writeErr = err
		}
	} else if sqliteErr != nil {
		debugf("Manager.SetTitle sqlite open skipped key=%q err=%v", summary.Key, sqliteErr)
	}
	if metaDualWriteEnabled() || writeErr != nil || sqliteIdx == nil {
		meta, err := m.openMeta()
		if meta == nil {
			if sqliteIdx != nil && writeErr == nil {
				debugf("Manager.SetTitle meta json dual-write open error key=%q err=%v", summary.Key, err)
				summary.Title = cleanTitle
				summary.TitleSource = "user"
				return summary, nil
			}
			return SessionSummary{}, err
		}
		defer meta.Close()
		if err := meta.SetTitle(ctx, summary.Key, cleanTitle); err != nil {
			if writeErr != nil {
				return SessionSummary{}, fmt.Errorf("cannot write AI session title to sqlite (%v) or meta json (%w)", writeErr, err)
			}
			if sqliteIdx == nil {
				return SessionSummary{}, err
			}
			debugf("Manager.SetTitle meta json dual-write error key=%q err=%v", summary.Key, err)
		}
	}
	summary.Title = cleanTitle
	summary.TitleSource = "user"
	return summary, nil
}

func (m *Manager) RenameTag(ctx context.Context, from string, to string) (int, error) {
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr != nil || sqliteIdx == nil {
		return 0, fmt.Errorf("session tag rename requires sqlite AI session index: %w", sqliteErr)
	}
	defer sqliteIdx.Close()
	return sqliteIdx.RenameTag(ctx, from, to)
}

func (m *Manager) Delete(ctx context.Context, identifier string) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier, false)
	if err != nil {
		return SessionSummary{}, err
	}
	if strings.TrimSpace(summary.FilePath) == "" {
		return SessionSummary{}, fmt.Errorf("session file path is empty")
	}
	deletedPath, err := moveSessionFileToDeleted(ctx, summary)
	if err != nil {
		return SessionSummary{}, err
	}
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		if err := sqliteIdx.DeleteMeta(ctx, summary.Key); err != nil {
			debugf("Manager.Delete sqlite meta delete error key=%q err=%v", summary.Key, err)
		}
		if err := sqliteIdx.MarkSessionMissing(ctx, summary.Key); err != nil {
			debugf("Manager.Delete sqlite summary missing error key=%q err=%v", summary.Key, err)
		}
	}
	meta, _ := m.openMeta()
	if meta != nil {
		defer meta.Close()
		if err := meta.Delete(ctx, summary.Key); err != nil {
			return SessionSummary{}, err
		}
	}
	summary.FilePath = deletedPath
	return summary, nil
}

func (m *Manager) Path(ctx context.Context, identifier string, refresh bool) (string, error) {
	summary, err := m.resolveSession(ctx, identifier, refresh)
	if err != nil {
		return "", err
	}
	return summary.FilePath, nil
}

func (m *Manager) openMeta() (*MetaStore, error) {
	return OpenMeta(m.MetaPath)
}

func (m *Manager) shouldUseMessageIndexCache() bool {
	if maxMessageIndexBytesForLoad <= 0 {
		return true
	}
	info, err := os.Stat(m.IndexPath)
	if err != nil {
		if !os.IsNotExist(err) {
			debugf("Manager.messageIndex stat error path=%q err=%v", m.IndexPath, err)
		}
		return true
	}
	if info.Size() <= maxMessageIndexBytesForLoad {
		return true
	}
	debugf("Manager.messageIndex skipped path=%q size=%d maxBytes=%d", m.IndexPath, info.Size(), maxMessageIndexBytesForLoad)
	return false
}

func (m *Manager) loadMessages(ctx context.Context, summary SessionSummary, refresh bool) ([]Message, error) {
	start := time.Now()
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr != nil {
		debugf("Manager.loadMessages sqlite open skipped key=%q path=%q err=%v", summary.Key, m.SQLitePath, sqliteErr)
	}
	if sqliteIdx != nil {
		defer sqliteIdx.Close()
	}
	if !refresh && sqliteIdx != nil {
		messages, ok, err := sqliteIdx.GetMessages(ctx, summary)
		if err != nil {
			debugf("Manager.loadMessages sqlite error key=%q file=%q duration=%s err=%v", summary.Key, summary.FilePath, time.Since(start), err)
		} else if ok {
			debugf("Manager.loadMessages sqlite hit key=%q file=%q messages=%d duration=%s", summary.Key, summary.FilePath, len(messages), time.Since(start))
			return messages, nil
		} else {
			debugf("Manager.loadMessages sqlite miss key=%q file=%q duration=%s", summary.Key, summary.FilePath, time.Since(start))
		}
	}
	useMessageIndexCache := m.shouldUseMessageIndexCache()
	if sqliteIdx == nil && !refresh && useMessageIndexCache {
		idx, err := m.openIndex()
		if err == nil {
			defer idx.Close()
			messages, ok, err := idx.GetMessages(ctx, summary)
			if err != nil {
				debugf("Manager.loadMessages index error key=%q file=%q duration=%s err=%v", summary.Key, summary.FilePath, time.Since(start), err)
				return nil, err
			}
			if ok {
				debugf("Manager.loadMessages index hit key=%q file=%q messages=%d duration=%s", summary.Key, summary.FilePath, len(messages), time.Since(start))
				return messages, nil
			}
			debugf("Manager.loadMessages index miss key=%q file=%q duration=%s", summary.Key, summary.FilePath, time.Since(start))
		} else {
			debugf("Manager.loadMessages index open skipped key=%q file=%q err=%v", summary.Key, summary.FilePath, err)
		}
	} else if !useMessageIndexCache {
		debugf("Manager.loadMessages index read skipped key=%q file=%q", summary.Key, summary.FilePath)
	}
	provider := providerBySource(m.Providers, summary.Source)
	if provider == nil {
		debugf("Manager.loadMessages provider missing key=%q source=%q file=%q", summary.Key, summary.Source, summary.FilePath)
		return nil, fmt.Errorf("no provider for source %q", summary.Source)
	}
	providerStart := time.Now()
	debugf("Manager.loadMessages provider start key=%q source=%q file=%q refresh=%v", summary.Key, summary.Source, summary.FilePath, refresh)
	messages, err := provider.LoadMessages(ctx, summary.FilePath)
	if err != nil {
		debugf("Manager.loadMessages provider error key=%q source=%q file=%q duration=%s err=%v", summary.Key, summary.Source, summary.FilePath, time.Since(providerStart), err)
		return nil, err
	}
	debugf("Manager.loadMessages provider success key=%q source=%q file=%q messages=%d duration=%s", summary.Key, summary.Source, summary.FilePath, len(messages), time.Since(providerStart))
	if sqliteIdx != nil {
		if err := sqliteIdx.SaveMessages(ctx, summary, messages); err != nil {
			debugf("Manager.loadMessages sqlite save skipped key=%q err=%v", summary.Key, err)
		} else {
			debugf("Manager.loadMessages sqlite saved key=%q messages=%d totalDuration=%s", summary.Key, len(messages), time.Since(start))
		}
		return messages, nil
	}
	if !useMessageIndexCache {
		debugf("Manager.loadMessages index save skipped key=%q oversizedIndex=true", summary.Key)
		return messages, nil
	}
	idx, err := m.openIndex()
	if err == nil {
		defer idx.Close()
		idx.saveMessages(summary, messages)
		_ = idx.save()
		debugf("Manager.loadMessages index saved key=%q messages=%d totalDuration=%s", summary.Key, len(messages), time.Since(start))
	} else {
		debugf("Manager.loadMessages index save skipped key=%q err=%v", summary.Key, err)
	}
	return messages, nil
}

func (m *Manager) refreshSummariesInBackground(identifier string) {
	key := m.SQLitePath + "\x00" + m.MetaPath + "\x00" + m.IndexPath
	if !summaryRefreshes.start(key) {
		debugf("Manager.Summary background refresh already running id=%q path=%q", identifier, m.SQLitePath)
		return
	}
	providers := append([]Provider(nil), m.Providers...)
	indexPath := m.IndexPath
	sqlitePath := m.SQLitePath
	metaPath := m.MetaPath
	go func() {
		defer summaryRefreshes.done(key)
		ctx, cancel := context.WithTimeout(context.Background(), backgroundSummaryRefreshTimeout)
		defer cancel()
		manager := NewManagerWithOptions(ManagerOptions{
			Providers:  providers,
			IndexPath:  indexPath,
			SQLitePath: sqlitePath,
			MetaPath:   metaPath,
		})
		stats, errs := manager.Refresh(ctx)
		if len(errs) > 0 {
			debugf("Manager.Summary background refresh error id=%q path=%q summaries=%d errors=%d firstErr=%v", identifier, sqlitePath, stats.Summaries, len(errs), errs[0])
			return
		}
		debugf("Manager.Summary background refresh success id=%q path=%q summaries=%d", identifier, sqlitePath, stats.Summaries)
	}()
}

func (r *summaryRefreshTracker) start(key string) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	if r.inflight == nil {
		r.inflight = make(map[string]bool)
	}
	if r.inflight[key] {
		return false
	}
	r.inflight[key] = true
	return true
}

func (r *summaryRefreshTracker) done(key string) {
	r.lock.Lock()
	defer r.lock.Unlock()
	delete(r.inflight, key)
}

func (m *Manager) resolveSession(ctx context.Context, identifier string, refresh bool) (SessionSummary, error) {
	start := time.Now()
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, fmt.Errorf("session id is required")
	}
	if !refresh {
		if summary, ok, err := m.resolveSessionFromSQLite(ctx, identifier, true); err == nil && ok {
			debugf("Manager.resolveSession sqlite success id=%q key=%q source=%q file=%q duration=%s", identifier, summary.Key, summary.Source, summary.FilePath, time.Since(start))
			return summary, nil
		} else if err != nil {
			debugf("Manager.resolveSession sqlite skipped id=%q duration=%s err=%v", identifier, time.Since(start), err)
		}
	}

	summaries, errs := ScanSummaries(ctx, m.Providers)
	if len(errs) > 0 && len(summaries) == 0 {
		debugf("Manager.resolveSession scan error id=%q duration=%s err=%v", identifier, time.Since(start), errs[0])
		return SessionSummary{}, errs[0]
	}
	sqliteIdx, sqliteErr := m.openSQLiteIndex()
	if sqliteErr == nil && sqliteIdx != nil {
		defer sqliteIdx.Close()
		if _, saveErrs := sqliteIdx.SaveScannedSummaries(ctx, summaries, len(errs) == 0); len(saveErrs) > 0 {
			debugf("Manager.resolveSession sqlite save scanned summaries path=%q errors=%d firstErr=%v", m.SQLitePath, len(saveErrs), saveErrs[0])
		}
	}
	var matches []SessionSummary
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return SessionSummary{}, ctx.Err()
		}
		if summary.Key == identifier || summary.ID == identifier || strings.HasPrefix(summary.ID, identifier) {
			matches = append(matches, summary)
		}
	}
	if len(matches) == 0 {
		debugf("Manager.resolveSession not found id=%q scanned=%d duration=%s", identifier, len(summaries), time.Since(start))
		return SessionSummary{}, fmt.Errorf("session not found: %s", identifier)
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Key == identifier {
			return true
		}
		if matches[j].Key == identifier {
			return false
		}
		if matches[i].ID == identifier {
			return true
		}
		if matches[j].ID == identifier {
			return false
		}
		return summarySortTime(matches[i]) > summarySortTime(matches[j])
	})
	if len(matches) > 1 && matches[0].ID != identifier && matches[0].Key != identifier {
		debugf("Manager.resolveSession ambiguous id=%q matches=%d duration=%s", identifier, len(matches), time.Since(start))
		return SessionSummary{}, fmt.Errorf("ambiguous session id prefix %q (%d matches)", identifier, len(matches))
	}

	if sqliteErr == nil && sqliteIdx != nil {
		if err := sqliteIdx.ApplyMeta(ctx, &matches[0]); err != nil {
			debugf("Manager.resolveSession sqlite meta apply error key=%q err=%v", matches[0].Key, err)
		}
	}
	meta, _ := m.openMeta()
	if meta != nil {
		defer meta.Close()
		if sqliteIdx == nil {
			meta.Apply(&matches[0])
		}
	}
	debugf("Manager.resolveSession success id=%q key=%q source=%q file=%q scanned=%d matches=%d duration=%s", identifier, matches[0].Key, matches[0].Source, matches[0].FilePath, len(summaries), len(matches), time.Since(start))
	return matches[0], nil
}

func (m *Manager) resolveSessionFromSQLite(ctx context.Context, identifier string, requireCurrent bool) (SessionSummary, bool, error) {
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		return SessionSummary{}, false, err
	}
	defer sqliteIdx.Close()
	if requireCurrent {
		hasScan, err := sqliteIdx.HasSummaryScan(ctx)
		if err != nil {
			return SessionSummary{}, false, err
		}
		if !hasScan {
			return SessionSummary{}, false, nil
		}
	}
	summary, err := sqliteIdx.GetSession(ctx, identifier)
	if err != nil {
		return SessionSummary{}, false, nil
	}
	if requireCurrent && !cachedSummaryFileIsCurrent(summary) {
		return SessionSummary{}, false, nil
	}
	return summary, true, nil
}

func cachedSummaryFileIsCurrent(summary SessionSummary) bool {
	filePath := strings.TrimSpace(summary.FilePath)
	if filePath == "" || strings.HasPrefix(filePath, "remote:") {
		return true
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return false
	}
	return info.ModTime().UnixMilli() == summary.MTime && info.Size() == summary.Size
}

func normalizeUserLinesLimit(limit int) int {
	if limit <= 0 {
		return 8
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func filterUserMessages(messages []Message, query string) []Message {
	query = strings.ToLower(strings.TrimSpace(query))
	var userMessages []Message
	for _, message := range messages {
		if message.Role != RoleUser || strings.TrimSpace(message.Text) == "" {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(message.Text), query) {
			continue
		}
		userMessages = append(userMessages, message)
	}
	return userMessages
}

func userLineWindow(userMessages []Message, beforeSeq int, limit int) ([]Message, bool) {
	if limit <= 0 {
		limit = 8
	}
	end := len(userMessages)
	if beforeSeq > 0 {
		for idx, message := range userMessages {
			if message.Seq >= beforeSeq {
				end = idx
				break
			}
		}
	}
	if end < 0 {
		end = 0
	}
	start := end - limit
	if start < 0 {
		start = 0
	}
	window := append([]Message(nil), userMessages[start:end]...)
	return window, start > 0
}

func moveSessionFileToDeleted(ctx context.Context, summary SessionSummary) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	srcPath := filepath.Clean(summary.FilePath)
	if _, err := os.Stat(srcPath); err != nil {
		return "", err
	}
	destDir := filepath.Join(DefaultDeletedDir(), sanitizePathPart(summary.Source), time.Now().Format("2006-01-02"))
	if err := os.MkdirAll(destDir, 0700); err != nil {
		return "", err
	}
	base := filepath.Base(srcPath)
	if strings.TrimSpace(base) == "" || base == "." || base == string(filepath.Separator) {
		base = sanitizePathPart(summary.ID) + ".jsonl"
	}
	destPath := uniqueDeletedPath(filepath.Join(destDir, base))
	if err := os.Rename(srcPath, destPath); err == nil {
		return destPath, nil
	}
	if err := copyFile(srcPath, destPath); err != nil {
		return "", err
	}
	if err := os.Remove(srcPath); err != nil {
		return "", err
	}
	return destPath, nil
}

func uniqueDeletedPath(path string) string {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, i, ext)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}

func copyFile(srcPath string, destPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()
	dest, err := os.OpenFile(destPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dest, src); err != nil {
		_ = dest.Close()
		return err
	}
	return dest.Close()
}

func sanitizePathPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}
