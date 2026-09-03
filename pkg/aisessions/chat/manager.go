// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// DefaultIdleTimeout is how long an un-attended ChatSession stays alive before
// the sweeper closes it. One Session == one agent subprocess == one model
// connection, so idle sessions are reclaimed (ponytail ceiling: a hard-coded
// constant; upgrade path = per-client leases).
const DefaultIdleTimeout = 10 * time.Minute

// sweepInterval controls how often the idle sweeper runs.
const sweepInterval = 1 * time.Minute

// Manager owns the live ChatSessions for the app. Sessions are keyed by
// source+sessionID: opening the same AI session in two GUI views reuses one
// subprocess; sending a new prompt while a turn is running returns an error.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	idle     time.Duration
	started  bool
}

// NewManager builds a Manager with the default idle timeout.
func NewManager() *Manager {
	return &Manager{
		sessions: map[string]*Session{},
		idle:     DefaultIdleTimeout,
	}
}

// sessionKey identifies one live chat session.
func sessionKey(source, sessionID string) string {
	return source + "/" + sessionID
}

// EnsureResult holds the result of Ensure: the session, whether it was newly created,
// the manager key (for later promotion), and any error.
type EnsureResult struct {
	Session *Session
	IsNew   bool
	Key     string
}

// Ensure returns the live Session for source+sessionID, starting it via the
// provider if absent. The returned session may already have a turn running.
//
// When opts.SessionID is empty (new chat), a unique transient key is generated
// so that multiple concurrent "new chat" requests each spawn their own subprocess
// instead of sharing one. Once pi assigns a real session ID via session_state,
// the caller promotes the session to the real key via PromoteSession.
func (m *Manager) Ensure(ctx context.Context, provider Provider, opts StartOptions) (*Session, bool, string, error) {
	if provider == nil {
		return nil, false, "", fmt.Errorf("no chat provider for source")
	}
	m.mu.Lock()
	if !m.started {
		m.started = true
		go m.sweepLoop()
	}
	key := sessionKey(provider.Source(), opts.SessionID)
	if opts.SessionID == "" {
		// New chat: generate a unique transient key so each request gets its own subprocess.
		key = sessionKey(provider.Source(), "new:"+uuid.NewString())
	}
	if s, ok := m.sessions[key]; ok {
		m.mu.Unlock()
		return s, false, key, nil
	}
	m.mu.Unlock()

	s, err := provider.Start(ctx, opts)
	if err != nil {
		return nil, false, "", err
	}
	m.mu.Lock()
	// Another goroutine may have won the race; if so, close ours and reuse theirs.
	if existing, ok := m.sessions[key]; ok {
		m.mu.Unlock()
		_ = s.Close()
		return existing, false, key, nil
	}
	m.sessions[key] = s
	m.mu.Unlock()
	return s, true, key, nil
}

// PromoteSession moves a session from its transient key to the real source+sessionID
// key once pi assigns a real session ID. This allows subsequent requests with the
// real session ID to find the existing subprocess.
func (m *Manager) PromoteSession(source, oldKey string, realSessionID string, session *Session) {
	if session == nil || realSessionID == "" {
		return
	}
	realKey := sessionKey(source, realSessionID)
	if realKey == oldKey {
		return // already at the right key
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	// Only delete old key if it still maps to this session
	if m.sessions[oldKey] == session {
		delete(m.sessions, oldKey)
	}
	// Don't overwrite an existing real-key entry
	if _, exists := m.sessions[realKey]; !exists {
		m.sessions[realKey] = session
	}
}

// Get returns an existing session without starting one (nil if absent).
func (m *Manager) Get(source, sessionID string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[sessionKey(source, sessionID)]
}

// Close shuts down the session for a key.
func (m *Manager) Close(source, sessionID string) {
	m.mu.Lock()
	s := m.sessions[sessionKey(source, sessionID)]
	delete(m.sessions, sessionKey(source, sessionID))
	m.mu.Unlock()
	if s != nil {
		_ = s.Close()
	}
}

// CloseAll tears down every session (server shutdown).
func (m *Manager) CloseAll() {
	m.mu.Lock()
	sessions := m.sessions
	m.sessions = map[string]*Session{}
	m.mu.Unlock()
	for _, s := range sessions {
		_ = s.Close()
	}
}

// ActiveCount returns how many live sessions exist (diagnostics).
func (m *Manager) ActiveCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

func (m *Manager) sweepLoop() {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for range ticker.C {
		m.sweepOnce()
	}
}

func (m *Manager) sweepOnce() {
	now := time.Now()
	m.mu.Lock()
	var toClose []*Session
	for key, s := range m.sessions {
		if now.Sub(s.LastUsed()) > m.idle {
			toClose = append(toClose, s)
			delete(m.sessions, key)
		}
	}
	m.mu.Unlock()
	for _, s := range toClose {
		_ = s.Close()
	}
}