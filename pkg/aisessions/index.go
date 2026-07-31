// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const indexVersion = 1

type Index struct {
	path string
	data indexData
}

type indexData struct {
	Version  int                       `json:"version"`
	Sessions map[string]SessionSummary `json:"sessions"`
	Messages map[string][]Message      `json:"messages,omitempty"`
	Files    map[string]indexFile      `json:"files,omitempty"`
	Marks    map[string]indexMark      `json:"marks,omitempty"`
}

type indexFile struct {
	Key             string `json:"key"`
	MTime           int64  `json:"mtime"`
	Size            int64  `json:"size"`
	IndexedAt       int64  `json:"indexedAt"`
	FullTextIndexed bool   `json:"fullTextIndexed"`
}

type indexMark struct {
	Marked    bool   `json:"marked,omitempty"`
	Note      string `json:"note,omitempty"`
	UpdatedAt int64  `json:"updatedAt,omitempty"`
}

type IndexStats struct {
	Summaries       int `json:"summaries"`
	FullTextIndexed int `json:"fullTextIndexed"`
	Skipped         int `json:"skipped"`
	Errors          int `json:"errors"`
}

func OpenIndex(path string) (*Index, error) {
	if path == "" {
		path = DefaultIndexPath()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	idx := &Index{path: path}
	idx.data = indexData{
		Version:  indexVersion,
		Sessions: make(map[string]SessionSummary),
		Messages: make(map[string][]Message),
		Files:    make(map[string]indexFile),
		Marks:    make(map[string]indexMark),
	}
	if err := idx.load(); err != nil {
		return nil, err
	}
	return idx, nil
}

func (idx *Index) Close() error {
	return nil
}

func (idx *Index) Path() string {
	return idx.path
}

func (idx *Index) CountSessions(ctx context.Context) (int, error) {
	count := 0
	for _, summary := range idx.data.Sessions {
		if ctx.Err() != nil {
			return count, ctx.Err()
		}
		if !summary.Missing {
			count++
		}
	}
	return count, nil
}

func (idx *Index) RefreshSummaries(ctx context.Context, providers []Provider) (IndexStats, []error) {
	summaries, errs := ScanSummaries(ctx, providers)
	stats := IndexStats{Summaries: len(summaries), Errors: len(errs)}

	for key, summary := range idx.data.Sessions {
		summary.Missing = true
		idx.data.Sessions[key] = summary
	}
	for _, summary := range summaries {
		if ctx.Err() != nil {
			errs = append(errs, ctx.Err())
			stats.Errors++
			break
		}
		if summary.Key == "" {
			summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
		}
		if err := summary.Validate(); err != nil {
			errs = append(errs, err)
			stats.Errors++
			continue
		}
		existing := idx.data.Sessions[summary.Key]
		fileRecord := idx.data.Files[summary.FilePath]
		if summary.MessageCount == 0 && fileRecord.FullTextIndexed && fileRecord.MTime == summary.MTime && fileRecord.Size == summary.Size {
			summary.MessageCount = existing.MessageCount
		}
		summary.Missing = false
		idx.applyMark(&summary)
		idx.data.Sessions[summary.Key] = summary
		fileRecord.Key = summary.Key
		fileRecord.MTime = summary.MTime
		fileRecord.Size = summary.Size
		idx.data.Files[summary.FilePath] = fileRecord
	}
	if err := idx.save(); err != nil {
		errs = append(errs, err)
		stats.Errors++
	}
	return stats, errs
}

func (idx *Index) IndexAll(ctx context.Context, providers []Provider) (IndexStats, []error) {
	stats, errs := idx.RefreshSummaries(ctx, providers)
	summaries, err := idx.List(ctx, ListOptions{Limit: 0})
	if err != nil {
		return stats, append(errs, err)
	}
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return stats, append(errs, ctx.Err())
		}
		if !idx.needsFullTextIndex(summary) {
			stats.Skipped++
			continue
		}
		provider := providerBySource(providers, summary.Source)
		if provider == nil {
			errs = append(errs, fmt.Errorf("no provider for source %q", summary.Source))
			stats.Errors++
			continue
		}
		messages, err := provider.LoadMessages(ctx, summary.FilePath)
		if err != nil {
			errs = append(errs, err)
			stats.Errors++
			continue
		}
		idx.saveMessages(summary, messages)
		stats.FullTextIndexed++
	}
	if err := idx.save(); err != nil {
		errs = append(errs, err)
		stats.Errors++
	}
	return stats, errs
}

func (idx *Index) List(ctx context.Context, opts ListOptions) ([]SessionSummary, error) {
	var summaries []SessionSummary
	for _, summary := range idx.data.Sessions {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		idx.applyMark(&summary)
		if !summaryMatchesList(summary, opts) {
			continue
		}
		summaries = append(summaries, summary)
	}
	sortSummaries(summaries)
	return limitSummaries(summaries, opts.Limit), nil
}

func (idx *Index) Search(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	query := strings.ToLower(strings.TrimSpace(opts.Query))
	if query == "" {
		return idx.List(ctx, ListOptions{Source: opts.Source, Project: opts.Project, Limit: opts.Limit})
	}
	var summaries []SessionSummary
	for _, summary := range idx.data.Sessions {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		idx.applyMark(&summary)
		if summary.Missing {
			continue
		}
		if opts.Source != "" && summary.Source != opts.Source {
			continue
		}
		if opts.Project != "" && !strings.Contains(strings.ToLower(summary.ProjectPath), strings.ToLower(opts.Project)) {
			continue
		}
		if idx.summaryMatchesSearch(summary, query) {
			summaries = append(summaries, summary)
		}
	}
	sortSummaries(summaries)
	return limitSummaries(summaries, opts.Limit), nil
}

func (idx *Index) GetSession(ctx context.Context, identifier string) (SessionSummary, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, fmt.Errorf("session id is required")
	}

	var matches []SessionSummary
	for _, summary := range idx.data.Sessions {
		if ctx.Err() != nil {
			return SessionSummary{}, ctx.Err()
		}
		if summary.Missing {
			continue
		}
		if summary.Key == identifier || summary.ID == identifier || strings.HasPrefix(summary.ID, identifier) {
			idx.applyMark(&summary)
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
	return matches[0], nil
}

func (idx *Index) SetMarked(ctx context.Context, key string, marked bool) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	mark := idx.data.Marks[key]
	mark.Marked = marked
	mark.UpdatedAt = time.Now().UnixMilli()
	idx.data.Marks[key] = mark
	return idx.save()
}

func (idx *Index) SetNote(ctx context.Context, key string, note string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	mark := idx.data.Marks[key]
	mark.Note = note
	mark.UpdatedAt = time.Now().UnixMilli()
	idx.data.Marks[key] = mark
	return idx.save()
}

func (idx *Index) load() error {
	data, err := os.ReadFile(idx.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, &idx.data); err != nil {
		return err
	}
	if idx.data.Version == 0 {
		idx.data.Version = indexVersion
	}
	if idx.data.Sessions == nil {
		idx.data.Sessions = make(map[string]SessionSummary)
	}
	if idx.data.Messages == nil {
		idx.data.Messages = make(map[string][]Message)
	}
	if idx.data.Files == nil {
		idx.data.Files = make(map[string]indexFile)
	}
	if idx.data.Marks == nil {
		idx.data.Marks = make(map[string]indexMark)
	}
	return nil
}

func (idx *Index) save() error {
	data, err := json.MarshalIndent(idx.data, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := idx.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmpPath, idx.path)
}

func (idx *Index) needsFullTextIndex(summary SessionSummary) bool {
	fileRecord, ok := idx.data.Files[summary.FilePath]
	if !ok {
		return true
	}
	if !fileRecord.FullTextIndexed {
		return true
	}
	return fileRecord.MTime != summary.MTime || fileRecord.Size != summary.Size
}

func (idx *Index) GetMessages(ctx context.Context, summary SessionSummary) ([]Message, bool, error) {
	if ctx.Err() != nil {
		return nil, false, ctx.Err()
	}
	if idx.needsFullTextIndex(summary) {
		return nil, false, nil
	}
	messages, ok := idx.data.Messages[summary.Key]
	if !ok {
		return nil, false, nil
	}
	return append([]Message(nil), messages...), true, nil
}

func (idx *Index) saveMessages(summary SessionSummary, messages []Message) {
	idx.data.Messages[summary.Key] = messages
	summary.MessageCount = readableMessageCount(messages)
	idx.applyMark(&summary)
	idx.data.Sessions[summary.Key] = summary
	idx.data.Files[summary.FilePath] = indexFile{
		Key:             summary.Key,
		MTime:           summary.MTime,
		Size:            summary.Size,
		IndexedAt:       time.Now().UnixMilli(),
		FullTextIndexed: true,
	}
}

func (idx *Index) applyMark(summary *SessionSummary) {
	mark := idx.data.Marks[summary.Key]
	summary.Marked = mark.Marked
	summary.Note = mark.Note
}

func (idx *Index) summaryMatchesSearch(summary SessionSummary, query string) bool {
	metaText := strings.ToLower(strings.Join([]string{
		summary.ID,
		summary.Source,
		summary.Title,
		summary.Snippet,
		summary.ProjectPath,
		summary.FilePath,
		summary.Note,
		strings.Join(summary.Tags, " "),
	}, " "))
	if strings.Contains(metaText, query) {
		return true
	}
	for _, message := range idx.data.Messages[summary.Key] {
		if strings.Contains(strings.ToLower(textForSearch(message)), query) {
			if strings.TrimSpace(summary.Snippet) == "" {
				summary.Snippet = truncateSummary(message.Text, snippetMaxChars)
			}
			return true
		}
	}
	return false
}

func summaryMatchesList(summary SessionSummary, opts ListOptions) bool {
	if summary.Missing {
		return false
	}
	if opts.Source != "" && summary.Source != opts.Source {
		return false
	}
	if opts.Project != "" && !strings.Contains(strings.ToLower(summary.ProjectPath), strings.ToLower(opts.Project)) {
		return false
	}
	if opts.Since != 0 && summarySortTime(summary) < opts.Since {
		return false
	}
	if opts.Before != 0 && summarySortTime(summary) > opts.Before {
		return false
	}
	if opts.Marked == "starred" && !summary.Marked {
		return false
	}
	if opts.Marked == "unstarred" && summary.Marked {
		return false
	}
	if !sessionMatchesTagPresence(summary, opts.TagPresence, opts.TagFilters) {
		return false
	}
	if !sessionTagsContainAll(summary.Tags, opts.TagFilters) {
		return false
	}
	return true
}

func summaryMatchesQuery(summary SessionSummary, query string) bool {
	text := strings.ToLower(strings.Join([]string{
		summary.ID,
		summary.Source,
		summary.Title,
		summary.Snippet,
		summary.ProjectPath,
		summary.FilePath,
		summary.Note,
		strings.Join(summary.Tags, " "),
	}, " "))
	return strings.Contains(text, query)
}

func textForSearch(message Message) string {
	text := strings.TrimSpace(message.Text)
	if text == "" {
		return ""
	}
	if message.Role == RoleTool && runeCount(text) > 4000 {
		return truncateSummary(text, 4000)
	}
	return text
}

func limitSummaries(summaries []SessionSummary, limit int) []SessionSummary {
	if limit <= 0 || len(summaries) <= limit {
		return summaries
	}
	return summaries[:limit]
}
