// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// OriginAllID is the synthetic origin id for the merged "All machines" view.
// It aggregates the local origin plus every external dump in memory (read-only),
// without creating a shared index or writing anything.
const OriginAllID = "__all__"

// listAllOrigins merges every origin's list result into one read-only view.
// Each origin's own manager still applies its own filters/query; the merged set is
// deduped by Key (which embeds the file path, so local/dump rows never collide) and
// sorted by the requested primary key before the limit is applied.
func (svc *AISessionsService) listAllOrigins(ctx context.Context, request *AISessionsListRequest) (*AISessionsListResponse, error) {
	limit := request.Limit
	if limit == 0 {
		limit = 100
	}
	opts := aisessions.ListOptions{
		Source:          request.Source,
		Project:         request.Project,
		Projects:        request.Projects,
		ExcludeProjects: request.ExcludeProjects,
		Limit:           limit,
		Marked:          request.Marked,
		Since:           request.Since,
		Before:          request.Before,
		TagFilters:      request.TagFilters,
		ExcludeTags:     request.ExcludeTags,
		TagPresence:     request.TagPresence,
		Refresh:         request.Refresh,
		AttachMode:      request.AttachMode,
		AttachMaxRows:   request.AttachMaxRows,
		SortField:       request.SortField,
		SortDesc:        request.SortDesc,
	}
	originIDs := append([]string{aisessions.OriginLocalID}, externalOriginIDs()...)

	seen := make(map[string]bool)
	var merged []aisessions.SessionSummary
	var projectPaths []aisessions.ProjectPathSummary
	scanning := false
	scanned, total := 0, 0
	for _, originID := range originIDs {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		manager, _, err := managerForOrigin(ctx, originID)
		if err != nil {
			// A broken/removed dump must not sink the whole merged view.
			continue
		}
		result, err := manager.ScanListResult(ctx, opts, request.Query)
		if err != nil {
			continue
		}
		scanning = scanning || result.Scanning
		scanned += result.Scanned
		total += result.Total
		projectPaths = append(projectPaths, result.ProjectPaths...)
		for i := range result.Sessions {
			if seen[result.Sessions[i].Key] {
				continue
			}
			seen[result.Sessions[i].Key] = true
			result.Sessions[i].Origin = originID
			merged = append(merged, result.Sessions[i])
		}
	}

	sortMergeOrder(merged, request.SortField, request.SortDesc)
	if len(merged) > limit {
		merged = merged[:limit]
	}
	response := &AISessionsListResponse{
		Sessions: merged,
		Scanning: scanning,
		Scanned:  scanned,
		Total:    len(merged),
	}
	if request.IncludeProjectPaths {
		response.ProjectPaths = mergeProjectPaths(projectPaths)
	}
	return response, nil
}

// sortMergeOrder orders merged sessions by the primary key the same way the single
// origin does (updatedAt by default, createdAt when requested).
func sortMergeOrder(sessions []aisessions.SessionSummary, sortField string, sortDesc bool) {
	useCreated := strings.EqualFold(strings.TrimSpace(sortField), "created")
	sort.SliceStable(sessions, func(i, j int) bool {
		a, b := sessions[i], sessions[j]
		var av, bv int64
		if useCreated {
			av, bv = a.CreatedAt, b.CreatedAt
		} else {
			av, bv = a.UpdatedAt, b.UpdatedAt
		}
		if av == bv {
			return a.Key < b.Key
		}
		if sortDesc {
			return av > bv
		}
		return av < bv
	})
}

// mergeProjectPaths unions per-origin project path distributions by path.
func mergeProjectPaths(paths []aisessions.ProjectPathSummary) []aisessions.ProjectPathSummary {
	merged := make(map[string]int)
	var order []string
	for _, item := range paths {
		if _, ok := merged[item.Path]; !ok {
			order = append(order, item.Path)
		}
		merged[item.Path] += item.Count
	}
	out := make([]aisessions.ProjectPathSummary, 0, len(order))
	for _, path := range order {
		out = append(out, aisessions.ProjectPathSummary{Path: path, Count: merged[path]})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	return out
}

func externalOriginIDs() []string {
	origins := resolveOrigins()
	ids := make([]string, 0, len(origins))
	for _, origin := range origins {
		ids = append(ids, origin.ID)
	}
	return ids
}
