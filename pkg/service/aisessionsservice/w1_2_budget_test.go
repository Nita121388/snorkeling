// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"testing"
	"time"
)

func TestLiveSessionStateBudgetIsBoundedUnderHttpTimeout(t *testing.T) {
	if liveGetStateTimeout <= 0 || liveGetStateTimeout > 2*time.Second {
		t.Fatalf("expected liveGetStateTimeout in (0, 2s], got %s", liveGetStateTimeout)
	}
	if liveSessionStateTimeout <= 0 || liveSessionStateTimeout > 12*time.Second {
		t.Fatalf("expected liveSessionStateTimeout in (0, 12s], got %s", liveSessionStateTimeout)
	}
}
