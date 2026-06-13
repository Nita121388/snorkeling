// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Manager struct {
	Providers []Provider
	IndexPath string
	MetaPath  string
}

type ManagerOptions struct {
	Providers []Provider
	IndexPath string
	MetaPath  string
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
	return &Manager{Providers: providers, IndexPath: indexPath, MetaPath: metaPath}
}

func (m *Manager) openIndex() (*Index, error) {
	return OpenIndex(m.IndexPath)
}

func (m *Manager) List(ctx context.Context, opts ListOptions) ([]SessionSummary, error) {
	return m.ScanList(ctx, opts, "")
}

func (m *Manager) ListCached(ctx context.Context, opts ListOptions) ([]SessionSummary, error) {
	return m.List(ctx, opts)
}

func (m *Manager) Search(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	return m.ScanList(ctx, ListOptions{
		Source:     opts.Source,
		Project:    opts.Project,
		Limit:      opts.Limit,
		Refresh:    opts.Refresh,
		MarkedOnly: false,
	}, opts.Query)
}

func (m *Manager) SearchCached(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	return m.Search(ctx, opts)
}

func (m *Manager) ScanList(ctx context.Context, opts ListOptions, query string) ([]SessionSummary, error) {
	summaries, errs := ScanSummaries(ctx, m.Providers)
	if len(errs) > 0 && len(summaries) == 0 {
		return nil, errs[0]
	}
	meta, _ := m.openMeta()
	if meta != nil {
		defer meta.Close()
	}
	query = strings.ToLower(strings.TrimSpace(query))
	var filtered []SessionSummary
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return filtered, ctx.Err()
		}
		if meta != nil {
			meta.Apply(&summary)
		}
		if !summaryMatchesList(summary, opts) {
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
	return limited, nil
}

func (m *Manager) populateMessageCounts(ctx context.Context, summaries []SessionSummary, refresh bool) {
	idxStore, _ := m.openIndex()
	if idxStore != nil {
		defer idxStore.Close()
	}
	cacheDirty := false
	for idx := range summaries {
		if ctx.Err() != nil {
			break
		}
		var messages []Message
		if !refresh && idxStore != nil {
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
			if idxStore != nil {
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
	idx, err := m.openIndex()
	if err != nil {
		return IndexStats{}, []error{err}
	}
	defer idx.Close()
	return idx.IndexAll(ctx, m.Providers)
}

func (m *Manager) Refresh(ctx context.Context) (IndexStats, []error) {
	idx, err := m.openIndex()
	if err != nil {
		return IndexStats{}, []error{err}
	}
	defer idx.Close()
	return idx.RefreshSummaries(ctx, m.Providers)
}

func (m *Manager) Load(ctx context.Context, identifier string, opts LoadOptions) (SessionDetail, error) {
	summary, err := m.resolveSession(ctx, identifier)
	if err != nil {
		return SessionDetail{}, err
	}
	messages, err := m.loadMessages(ctx, summary, opts.Refresh)
	if err != nil {
		return SessionDetail{}, err
	}
	summary.MessageCount = readableMessageCount(messages)
	detail := SessionDetail{Summary: summary, Messages: messages}
	if opts.IncludeTools {
		provider := providerBySource(m.Providers, summary.Source)
		if provider == nil {
			return SessionDetail{}, fmt.Errorf("no provider for source %q", summary.Source)
		}
		toolProvider, ok := provider.(ToolCallProvider)
		if ok {
			toolCalls, err := toolProvider.LoadToolCalls(ctx, summary.FilePath)
			if err != nil {
				return SessionDetail{}, err
			}
			detail.ToolCalls = toolCalls
		}
	}
	return detail, nil
}

func (m *Manager) UserLines(ctx context.Context, identifier string, opts UserLinesOptions) (UserLinesResult, error) {
	summary, err := m.resolveSession(ctx, identifier)
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
	return m.resolveSession(ctx, identifier)
}

func (m *Manager) Mark(ctx context.Context, identifier string, marked bool) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier)
	if err != nil {
		return SessionSummary{}, err
	}
	meta, err := m.openMeta()
	if meta == nil {
		return SessionSummary{}, err
	}
	defer meta.Close()
	if err := meta.SetMarked(ctx, summary.Key, marked); err != nil {
		return SessionSummary{}, err
	}
	summary.Marked = marked
	return summary, nil
}

func (m *Manager) Note(ctx context.Context, identifier string, note string) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier)
	if err != nil {
		return SessionSummary{}, err
	}
	meta, err := m.openMeta()
	if meta == nil {
		return SessionSummary{}, err
	}
	defer meta.Close()
	if err := meta.SetNote(ctx, summary.Key, note); err != nil {
		return SessionSummary{}, err
	}
	summary.Note = note
	return summary, nil
}

func (m *Manager) Delete(ctx context.Context, identifier string) (SessionSummary, error) {
	summary, err := m.resolveSession(ctx, identifier)
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
	summary, err := m.resolveSession(ctx, identifier)
	if err != nil {
		return "", err
	}
	return summary.FilePath, nil
}

func (m *Manager) openMeta() (*MetaStore, error) {
	return OpenMeta(m.MetaPath)
}

func (m *Manager) loadMessages(ctx context.Context, summary SessionSummary, refresh bool) ([]Message, error) {
	if !refresh {
		idx, err := m.openIndex()
		if err == nil {
			defer idx.Close()
			messages, ok, err := idx.GetMessages(ctx, summary)
			if err != nil {
				return nil, err
			}
			if ok {
				return messages, nil
			}
		}
	}
	provider := providerBySource(m.Providers, summary.Source)
	if provider == nil {
		return nil, fmt.Errorf("no provider for source %q", summary.Source)
	}
	messages, err := provider.LoadMessages(ctx, summary.FilePath)
	if err != nil {
		return nil, err
	}
	idx, err := m.openIndex()
	if err == nil {
		defer idx.Close()
		idx.saveMessages(summary, messages)
		_ = idx.save()
	}
	return messages, nil
}

func (m *Manager) resolveSession(ctx context.Context, identifier string) (SessionSummary, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, fmt.Errorf("session id is required")
	}

	summaries, errs := ScanSummaries(ctx, m.Providers)
	if len(errs) > 0 && len(summaries) == 0 {
		return SessionSummary{}, errs[0]
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
		return SessionSummary{}, fmt.Errorf("ambiguous session id prefix %q (%d matches)", identifier, len(matches))
	}

	meta, _ := m.openMeta()
	if meta != nil {
		defer meta.Close()
		meta.Apply(&matches[0])
	}
	return matches[0], nil
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
