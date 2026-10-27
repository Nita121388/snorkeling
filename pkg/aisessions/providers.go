// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"sort"
	"strings"
	"sync"
)

func ScanSummaries(ctx context.Context, providers []Provider) ([]SessionSummary, []error) {
	var wg sync.WaitGroup
	var mu sync.Mutex
	var summaries []SessionSummary
	var errs []error

	for _, provider := range providers {
		provider := provider
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ctx.Err() != nil {
				return
			}
			cur, err := provider.List(ctx)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
				return
			}
			summaries = append(summaries, cur...)
		}()
	}

	wg.Wait()
	sortSummaries(summaries)
	return summaries, errs
}

func sortSummaries(summaries []SessionSummary) {
	sort.SliceStable(summaries, func(i int, j int) bool {
		return summarySortTime(summaries[i]) > summarySortTime(summaries[j])
	})
}

// SortFieldCreated 是 ListOptions.SortField 目前唯一支持的“非默认”取值。
// 消息数 / 子会话数只能在拿到完整结果后的前端排，后端拿不到这些派生计数，
// 所以这里只区分「按创建时间」与默认的「按更新时间」。
const SortFieldCreated = "created"

// sortSummariesBy 在 Limit 应用**之前**按请求的主排序键排序。
//
// 为什么后端也要排：前端拿到的是 limit 截断后的子集，它只能在这个子集内重排。
// 用户选「Created · Oldest」时期望的是整个索引里创建最早的一批，而不是
// 「最近更新的 200 条里创建最早的」。排序方向同样要传下来。
func sortSummariesBy(summaries []SessionSummary, field string, desc bool) {
	if strings.ToLower(strings.TrimSpace(field)) != SortFieldCreated {
		sortSummaries(summaries)
		return
	}
	sort.SliceStable(summaries, func(i int, j int) bool {
		left := summaryCreatedTime(summaries[i])
		right := summaryCreatedTime(summaries[j])
		if left == right {
			return summarySortTime(summaries[i]) > summarySortTime(summaries[j])
		}
		if desc {
			return left > right
		}
		return left < right
	})
}

// summaryCreatedTime 优先用 createdAt；缺失时回落到 updatedAt（老 provider 没
// 解析到 header 时间），避免这类会话全部被当成 0 排在最后。
func summaryCreatedTime(summary SessionSummary) int64 {
	if summary.CreatedAt != 0 {
		return summary.CreatedAt
	}
	return summarySortTime(summary)
}

func summarySortTime(summary SessionSummary) int64 {
	if summary.UpdatedAt != 0 {
		return summary.UpdatedAt
	}
	return summary.CreatedAt
}

func providerBySource(providers []Provider, source string) Provider {
	for _, provider := range providers {
		if provider.Source() == source {
			return provider
		}
	}
	for _, provider := range providers {
		if remoteProvider, ok := provider.(*RemoteProvider); ok && remoteProvider.SupportsSource(source) {
			return provider
		}
	}
	return nil
}
