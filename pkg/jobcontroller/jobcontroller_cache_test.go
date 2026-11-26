// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"context"
	"testing"
)

func TestJobAttachedBlockCacheResolvesWithoutDB(t *testing.T) {
	// Verify the in-memory attached-block cache exists and short-circuits DB lookups
	// on hot 4KB job output chunks once populated.
	const jobId = "job-cache-test-1"
	const blockId = "block-cache-test-1"

	setCachedJobAttachedBlockId(jobId, blockId)
	defer clearCachedJobAttachedBlockId(jobId)

	got, ok := getCachedJobAttachedBlockId(jobId)
	if !ok || got != blockId {
		t.Fatalf("expected cached block %q (ok=true), got %q (ok=%v)", blockId, got, ok)
	}

	resolved, err := resolveJobAttachedBlockId(context.Background(), jobId)
	if err != nil {
		t.Fatalf("resolveJobAttachedBlockId hit DB unexpectedly: %v", err)
	}
	if resolved != blockId {
		t.Fatalf("expected resolved block %q, got %q", blockId, resolved)
	}
}
