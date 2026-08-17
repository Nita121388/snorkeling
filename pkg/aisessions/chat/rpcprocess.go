// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/google/uuid"
)

// RpcResponse is a synchronous reply to a request that carried an "id".
type RpcResponse struct {
	ID      string `json:"id"`
	Type    string `json:"type"` // "response"
	Command string `json:"command"`
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
}

// RpcEvent is any non-response line the process emits (agent_start,
// turn_start, message_start, message_update, tool_execution_*, agent_end,
// extension_ui_request, command_output, process_exit, etc.). Adapters read
// .Type and the raw .Raw map and map what they need.
type RpcEvent struct {
	Type string         // event["type"]
	Raw  map[string]any
}

// promise is a one-shot channel pair waiting for the response to a request.
type promise struct {
	id     string
	respCh chan RpcResponse
	errCh  chan error
}

const (
	// defaultRequestTimeout bounds control-plane commands (get_state, abort,
	// prompt ack). Long-running LLM jobs (e.g. compact) use RequestNoTimeout.
	defaultRequestTimeout = 30 * time.Second
	// RequestNoTimeout signals "complete on response, process death, or close".
	RequestNoTimeout time.Duration = -1
)

// JsonlRpcProcess manages one JSONL-RPC subprocess: it correlates requests by id
// and fans every other line out as an RpcEvent to subscribers.
//
// Design mirrors Paseo's JsonlRpcProcess (jsonl-rpc-process.ts): request id
// correlation, timeout policy, and failAll-on-exit. It is decoupled from the
// agent (no pi-specific fields) so the same loop can back any JSONL-RPC agent.
type JsonlRpcProcess struct {
	stdin     io.WriteCloser
	closeOnce sync.Once

	mu       sync.Mutex
	pending  map[string]*promise
	subs     []*rpcSub
	closed   bool
	exitErr  error
	exitOnce sync.Once
}

// rpcSub is a stable identity for subscription removal (funcs aren't comparable).
type rpcSub struct {
	cb func(RpcEvent)
}

// NewJsonlRpcProcess wires a freshly-spawned process's stdin + stdout. The
// reader loop starts immediately; it dispatches responses to pending promises
// and all other lines to subscribers. onExit is invoked exactly once when the
// process dies (or when the stdout stream ends).
func NewJsonlRpcProcess(stdin io.WriteCloser, stdout io.Reader, onExit func(error)) *JsonlRpcProcess {
	p := &JsonlRpcProcess{
		stdin:   stdin,
		pending: map[string]*promise{},
	}
	go p.readLoop(stdout, onExit)
	return p
}

// OnEvent registers a listener for raw RPC events. The returned function
// unsubscribes the listener.
func (p *JsonlRpcProcess) OnEvent(cb func(RpcEvent)) (unsubscribe func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	sub := &rpcSub{cb: cb}
	p.subs = append(p.subs, sub)
	return func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		for i := range p.subs {
			if p.subs[i] == sub {
				p.subs = append(p.subs[:i], p.subs[i+1:]...)
				break
			}
		}
	}
}

// Send issues a JSONL-RPC command. If requestID is "", one is generated so the
// response is matched. timeout <= 0 disables the timeout (long jobs). Returns
// the resolved response (or an error: timeout / process exited / closed).
func (p *JsonlRpcProcess) Send(requestID, command string, data map[string]any, timeout time.Duration) (*RpcResponse, error) {
	if !p.tryAcquire() {
		return nil, fmt.Errorf("rpc process already closed")
	}

	id := requestID
	if id == "" {
		id = uuid.NewString()
	}
	pr := &promise{
		id:     id,
		respCh: make(chan RpcResponse, 1),
		errCh:  make(chan error, 1),
	}

	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, fmt.Errorf("rpc process already closed")
	}
	p.pending[id] = pr
	p.mu.Unlock()

	// pi's JSONL-RPC uses the command name as the frame type: {"type":"get_state"}.
	frame := map[string]any{"id": id, "type": command}
	for k, v := range data {
		frame[k] = v
	}
	line, _ := json.Marshal(frame)
	line = append(line, '\n')
	if _, err := p.stdin.Write(line); err != nil {
		p.removePending(id, fmt.Errorf("failed to write request %q: %w", id, err))
		return nil, err
	}

	if timeout == RequestNoTimeout {
		select {
		case resp := <-pr.respCh:
			return &resp, nil
		case err := <-pr.errCh:
			return nil, err
		}
	}
	select {
	case resp := <-pr.respCh:
		return &resp, nil
	case err := <-pr.errCh:
		return nil, err
	case <-time.After(timeout):
		p.removePending(id, fmt.Errorf("request %q timed out after %s", id, timeout))
		return nil, fmt.Errorf("request %q timed out after %s", id, timeout)
	}
}

// Error returns the exit reason captured by failAll (nil before exit).
func (p *JsonlRpcProcess) Error() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exitErr
}

// Close terminates the process's stdin. Callers owning the lifecycle should
// also kill any associated exec.Cmd.
func (p *JsonlRpcProcess) Close() error {
	p.closeOnce.Do(func() {
		p.mu.Lock()
		p.closed = true
		p.mu.Unlock()
		p.failAll(fmt.Errorf("rpc process closed"))
		_ = p.stdin.Close()
	})
	return nil
}

// tryAcquire returns true if the process isn't globally closed. (Currently a
// trivial guard; reserved for future state machine extensions.)
func (p *JsonlRpcProcess) tryAcquire() bool { return true }

func (p *JsonlRpcProcess) removePending(id string, err error) {
	p.mu.Lock()
	pr, ok := p.pending[id]
	delete(p.pending, id)
	p.mu.Unlock()
	if ok {
		pr.errCh <- err
	}
}

var errRpcExit = fmt.Errorf("rpc process exited")

// failAll rejects every outstanding request and records the exit reason. Called
// once by the reader loop when stdout ends or the process dies.
func (p *JsonlRpcProcess) failAll(err error) {
	if err == nil {
		err = errRpcExit
	}
	p.exitOnce.Do(func() {
		p.exitErr = err
		p.mu.Lock()
		p.closed = true
		pending := p.pending
		p.pending = map[string]*promise{}
		p.mu.Unlock()
		for _, pr := range pending {
			pr.errCh <- err
		}
	})
}

// readLoop scans stdout JSONL and routes frames.
func (p *JsonlRpcProcess) readLoop(stdout io.Reader, onExit func(error)) {
	scanner := bufio.NewScanner(stdout)
	// pi emits large message payloads; allow big lines.
	buf := make([]byte, 0, 1<<20)
	scanner.Buffer(buf, 64<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal(line, &frame); err != nil {
			continue // tolerate non-JSON noise
		}
		t, _ := frame["type"].(string)
		if t == "response" {
			var resp RpcResponse
			if err := json.Unmarshal(line, &resp); err != nil {
				continue
			}
			p.mu.Lock()
			pr := p.pending[resp.ID]
			if pr != nil {
				delete(p.pending, resp.ID)
			}
			p.mu.Unlock()
			if pr != nil {
				pr.respCh <- resp
			}
			continue
		}
		// Everything else is an event.
		evt := RpcEvent{Type: t, Raw: frame}
		p.mu.Lock()
		subs := make([]*rpcSub, len(p.subs))
		copy(subs, p.subs)
		p.mu.Unlock()
		for _, sub := range subs {
			sub.cb(evt)
		}
	}
	var err error
	if scanErr := scanner.Err(); scanErr != nil {
		err = fmt.Errorf("rpc read loop: %w", scanErr)
	}
	p.failAll(err)
	if onExit != nil {
		onExit(err)
	}
}
