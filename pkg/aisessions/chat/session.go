// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

// SessionState mirrors the coarse lifecycle of one GUI chat session.
type SessionState string

const (
	StateStarting SessionState = "starting"
	StateIdle     SessionState = "idle"
	StateRunning  SessionState = "running" // a turn is in flight
	StateClosed   SessionState = "closed"
)

// SessionStateInfo is the subset of the agent get_state payload the GUI shows.
type SessionStateInfo struct {
	SessionID       string      `json:"sessionId,omitempty"`
	SessionName     string      `json:"sessionName,omitempty"`
	SessionFile     string      `json:"sessionFile,omitempty"`
	MessageCount    int         `json:"messageCount,omitempty"`
	IsStreaming     bool        `json:"isStreaming,omitempty"`
	ThinkingLevel   string      `json:"thinkingLevel,omitempty"`
	Model           *ModelInfo  `json:"model,omitempty"`
	ContextUsagePct *float64    `json:"contextUsagePercent,omitempty"`
}

// ModelInfo is the model descriptor returned by get_state.
type ModelInfo struct {
	Provider    string `json:"provider,omitempty"`
	ID          string `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	ContextWindow int  `json:"contextWindow,omitempty"`
}

// Session is one live agent subprocess behind a GUI chat. It wraps a
// JsonlRpcProcess plus adapter-level event mapping. All methods are safe for
// concurrent use.
type Session struct {
	source   string
	opts     StartOptions
	stateMu  sync.Mutex
	state    SessionState
	lastUsed time.Time

	mu     sync.Mutex
	subs   []*eventSub
	closed bool
	turnMu sync.Mutex // serializes prompt submission per session
	active bool       // a turn is currently running

	rpc     *JsonlRpcProcess
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	mapper  func(RpcEvent) *ChatEvent
	usage   *ChatUsage
	lastMsg map[string]any
}

// eventSub is the subscription identity for ChatEvent callbacks.
type eventSub struct {
	cb func(ChatEvent)
}

// NewSession spawns cmd and wraps it. The adapter is responsible for argv; the
// session owns stdin/stdout pipes, the JSONL-RPC loop, and the mapper. The
// default mapper handles the pi event vocabulary; other adapters call SetMapper.
func NewSession(source string, opts StartOptions, cmd *exec.Cmd) (*Session, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("spawn %s: %w", source, err)
	}
	s := &Session{
		source:   source,
		opts:     opts,
		state:    StateStarting,
		lastUsed: time.Now(),
		cmd:      cmd,
		stdin:    stdin,
	}
	// One mapper instance per session so turn/usage state survives across events.
	pm := &piMapper{session: s}
	s.mapper = pm.mapEvent
	s.rpc = NewJsonlRpcProcess(stdin, stdout, func(err error) {
		s.handleProcessExit(err)
	})
	s.rpc.OnEvent(func(evt RpcEvent) {
		if cevt := s.mapEvent(evt); cevt != nil {
			s.publish(*cevt)
		}
	})
	s.setState(StateIdle)
	return s, nil
}

// Source returns the agent source ("pi", ...).
func (s *Session) Source() string { return s.source }

// Options returns the launch options (for diagnostics / re-attach).
func (s *Session) Options() StartOptions { return s.opts }

// SetMapper replaces the default pi event mapper (adapters use their own).
func (s *Session) SetMapper(m func(RpcEvent) *ChatEvent) { s.mapper = m }

// State returns the current lifecycle state.
func (s *Session) State() SessionState {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.state
}

func (s *Session) setState(st SessionState) {
	s.stateMu.Lock()
	s.state = st
	s.stateMu.Unlock()
}

// LastUsed returns the last activity timestamp (idle-sweeper input).
func (s *Session) LastUsed() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastUsed
}

// OnEvent subscribes to mapped ChatEvents. Returns an unsubscribe function.
func (s *Session) OnEvent(cb func(ChatEvent)) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := &eventSub{cb: cb}
	s.subs = append(s.subs, sub)
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		for i := range s.subs {
			if s.subs[i] == sub {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				break
			}
		}
	}
}

func (s *Session) publish(evt ChatEvent) {
	s.mu.Lock()
	subs := make([]*eventSub, len(s.subs))
	copy(subs, s.subs)
	s.lastUsed = time.Now()
	s.mu.Unlock()
	for _, sub := range subs {
		sub.cb(evt)
	}
}

// Prompt sends a user message. It returns after the agent acknowledges the
// prompt; the resulting events stream through OnEvent subscribers. Returns an
// error if another turn is already running.
func (s *Session) Prompt(ctx context.Context, text string) error {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if s.State() == StateClosed {
		return fmt.Errorf("session closed")
	}
	if s.active {
		return fmt.Errorf("agent is busy: another turn is still running")
	}
	s.active = true
	s.setState(StateRunning)
	resp, err := s.rpc.Send("", "prompt", map[string]any{"message": text}, defaultRequestTimeout)
	if err != nil {
		s.active = false
		s.setState(StateIdle)
		return fmt.Errorf("prompt rejected: %w", err)
	}
	if !resp.Success {
		s.active = false
		s.setState(StateIdle)
		return fmt.Errorf("prompt rejected: %s", resp.Error)
	}
	return nil
}

// Abort interrupts the in-flight turn, if any.
func (s *Session) Abort(ctx context.Context) error {
	if s.State() == StateClosed {
		return nil
	}
	_, err := s.rpc.Send("", "abort", nil, defaultRequestTimeout)
	return err
}

// GetState queries the agent's current session state (model, streaming, etc.).
func (s *Session) GetState(ctx context.Context) (*SessionStateInfo, error) {
	s.mu.Lock()
	rpc := s.rpc
	s.mu.Unlock()
	if rpc == nil {
		return nil, fmt.Errorf("session rpc not initialized")
	}
	resp, err := rpc.Send("", "get_state", nil, defaultRequestTimeout)
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("get_state failed: %s", resp.Error)
	}
	raw, _ := json.Marshal(resp.Data)
	var info SessionStateInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// Close tears down the subprocess. Safe to call multiple times.
func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()
	s.setState(StateClosed)
	s.rpc.Close()
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		_, _ = s.cmd.Process.Wait()
	}
	return nil
}

// handleProcessExit is the onExit hook for the underlying rpc process.
func (s *Session) handleProcessExit(err error) {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if s.State() == StateClosed {
		return
	}
	wasActive := s.active
	s.active = false
	s.setState(StateClosed)
	if wasActive {
		msg := "agent process exited"
		if err != nil {
			msg = fmt.Sprintf("agent process exited: %v", err)
		}
		s.publish(ChatEvent{Type: TurnFailed, Error: msg})
	}
}

// turnFinished is called by adapters when a turn ends normally (agent_end).
func (s *Session) turnFinished() {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	s.active = false
	if s.State() != StateClosed {
		s.setState(StateIdle)
	}
}

// mapEvent converts a raw RPC event to a ChatEvent.
func (s *Session) mapEvent(evt RpcEvent) *ChatEvent {
	if s.mapper == nil {
		return nil
	}
	return s.mapper(evt)
}
