// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentaccess

import (
	"sync"
	"time"
)

// DefaultRateLimit is the per-jti budget: 60 control calls per minute. One
// runaway agent must not be able to starve the app for the others (design
// §10.4), and an agent that needs more than 1 call/second is polling, which the
// design forbids in favour of wsh ui active.
const DefaultRateLimit = 60

const rateWindow = time.Minute

type bucket struct {
	windowStart int64
	count       int
}

var (
	rateLock    sync.Mutex
	rateBuckets = map[string]*bucket{}
)

// Allow consumes one unit for the jti. An empty jti is app-level and is not
// rate limited. Returns false when the window budget is exhausted.
func Allow(jti string) bool { return AllowWithLimit(jti, DefaultRateLimit) }

// AllowWithLimit is Allow with an explicit budget (tests use a small one).
func AllowWithLimit(jti string, limit int) bool {
	if jti == "" {
		return true
	}
	if limit <= 0 {
		return true
	}
	now := time.Now().UnixMilli()
	windowStart := now - (now % rateWindow.Milliseconds())

	rateLock.Lock()
	defer rateLock.Unlock()
	b, ok := rateBuckets[jti]
	if !ok || b.windowStart != windowStart {
		rateBuckets[jti] = &bucket{windowStart: windowStart, count: 1}
		return true
	}
	if b.count >= limit {
		return false
	}
	b.count++
	return true
}

// ResetRateLimit clears state (tests).
func ResetRateLimit() {
	rateLock.Lock()
	defer rateLock.Unlock()
	rateBuckets = map[string]*bucket{}
}
