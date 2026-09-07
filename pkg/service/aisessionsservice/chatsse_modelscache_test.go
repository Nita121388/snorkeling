// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"testing"
	"time"
)

func TestModelsCacheTTL(t *testing.T) {
	// Isolate from other tests in the package.
	modelsCache.Lock()
	modelsCache.bySource = map[string]modelsCacheEntry{}
	modelsCache.Unlock()

	if _, ok := getCachedModels("pi"); ok {
		t.Fatalf("expected cache miss for unknown source")
	}

	putCachedModels("pi", map[string]any{"models": []string{"m1"}})
	if _, ok := getCachedModels("pi"); !ok {
		t.Fatalf("expected cache hit right after put")
	}

	// Expire the entry by backdating its timestamp.
	modelsCache.Lock()
	modelsCache.bySource["pi"] = modelsCacheEntry{
		data:      modelsCache.bySource["pi"].data,
		fetchedAt: time.Now().Add(-modelsCacheTTL - time.Minute),
	}
	modelsCache.Unlock()
	if _, ok := getCachedModels("pi"); ok {
		t.Fatalf("expected cache miss after TTL expiry")
	}
}
