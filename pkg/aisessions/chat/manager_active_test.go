// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"testing"
	"time"
)

func TestActiveSessionsSnapshot(t *testing.T) {
	m := NewManager()
	now := time.Now()
	m.sessions[sessionKey("pi", "real-1")] = &Session{source: "pi", state: StateRunning, lastUsed: now}
	m.sessions[sessionKey("pi", "new:abc")] = &Session{source: "pi", state: StateIdle, lastUsed: now.Add(-time.Second)}
	m.sessions[sessionKey("pi", "closed-1")] = &Session{source: "pi", state: StateClosed, lastUsed: now}

	got := m.ActiveSessions()
	if len(got) != 2 {
		t.Fatalf("expected 2 active sessions, got %d: %+v", len(got), got)
	}
	// sorted by session id: "new:abc" < "real-1"
	if got[0].SessionID != "new:abc" || !got[0].Provisional {
		t.Fatalf("expected provisional new:abc first, got %+v", got[0])
	}
	if got[1].SessionID != "real-1" || got[1].State != StateRunning {
		t.Fatalf("expected real-1 running, got %+v", got[1])
	}
	if got[1].LastUsed != now.UnixMilli() {
		t.Fatalf("unexpected lastUsed %d", got[1].LastUsed)
	}
}

func TestActiveSessionsEmpty(t *testing.T) {
	m := NewManager()
	if got := m.ActiveSessions(); len(got) != 0 {
		t.Fatalf("expected empty, got %+v", got)
	}
}

func TestDefaultManagerIsStable(t *testing.T) {
	if DefaultManager() == nil {
		t.Fatal("DefaultManager returned nil")
	}
	if DefaultManager() != DefaultManager() {
		t.Fatal("DefaultManager must return the same instance")
	}
}
