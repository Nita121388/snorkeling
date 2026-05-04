// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"sort"
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
	return nil
}
