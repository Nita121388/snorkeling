// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"testing"
	"time"
)

func TestClampServiceTimeoutMs(t *testing.T) {
	tests := []struct {
		name string
		ms   int64
		want time.Duration
	}{
		{"unset/zero falls back to default", 0, HttpTimeoutDuration},
		{"negative falls back to default", -5, HttpTimeoutDuration},
		{"below min clamps up", 10, HttpServiceTimeoutMinMs * time.Millisecond},
		{"in range is preserved", 30_000, 30 * time.Second},
		{"max is allowed", HttpServiceTimeoutMaxMs, HttpServiceTimeoutMaxMs * time.Millisecond},
		{"above max clamps down", 10 * 60_000, HttpServiceTimeoutMaxMs * time.Millisecond},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := clampServiceTimeoutMs(tc.ms); got != tc.want {
				t.Fatalf("clampServiceTimeoutMs(%d) = %s, want %s", tc.ms, got, tc.want)
			}
		})
	}
}

func TestClampServiceTimeoutMsKeepsDefaultAboveMin(t *testing.T) {
	// 默认值必须落在合法区间内，否则未配置时会被误夹。
	if HttpTimeoutDuration < HttpServiceTimeoutMinMs*time.Millisecond ||
		HttpTimeoutDuration > HttpServiceTimeoutMaxMs*time.Millisecond {
		t.Fatalf("default HttpTimeoutDuration %s out of [%s, %s]", HttpTimeoutDuration, time.Duration(HttpServiceTimeoutMinMs)*time.Millisecond, time.Duration(HttpServiceTimeoutMaxMs)*time.Millisecond)
	}
}
