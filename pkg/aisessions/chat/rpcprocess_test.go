// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package chat

import (
	"encoding/json"
	"io"
	"testing"
	"time"
)

// fakeRpcProcess is a minimal in-process JSONL-RPC peer: it drains whatever the
// JsonlRpcProcess writes to stdin (so writes never block) and lets the test
// author feed response/event lines to stdout on demand.
type fakeRpcProcess struct {
	stdinW  *io.PipeWriter
	stdoutR *io.PipeReader
	stdoutW *io.PipeWriter
	done    chan struct{}
	mu      chan struct{} // drains stdin
}

func newFakeRpcProcess() *fakeRpcProcess {
	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()
	f := &fakeRpcProcess{
		stdinW:  stdinW,
		stdoutR: stdoutR,
		stdoutW: stdoutW,
		done:    make(chan struct{}),
		mu:      make(chan struct{}, 1),
	}
	// Drain stdin so JsonlRpcProcess.Send never blocks.
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdinR.Read(buf)
			if n > 0 {
				// record/discard; tests inspect stdout, not stdin
			}
			if err != nil {
				return
			}
		}
	}()
	return f
}

func (f *fakeRpcProcess) writeLine(line string) {
	f.stdoutW.Write([]byte(line + "\n"))
}

// writeFakeResponse writes a single JSON response frame.
func (f *fakeRpcProcess) writeFakeResponse(respLine string) {
	f.writeLine(respLine)
}

// close simulates process exit (stdout EOF).
func (f *fakeRpcProcess) close() {
	f.stdoutW.Close()
	<-f.done
}

// TestJsonlRpcProcess_PromptAck verifies request-response correlation and event dispatch.
func TestJsonlRpcProcess_PromptAck(t *testing.T) {
	f := newFakeRpcProcess()
	events := make(chan RpcEvent, 16)
	process := NewJsonlRpcProcess(f.stdinW, f.stdoutR, func(err error) {
		close(f.done)
	})
	defer process.Close()

	unsub := process.OnEvent(func(evt RpcEvent) { events <- evt })
	defer unsub()

	// Real ordering: request is sent first (promise registered), then the peer
	// replies. Feed the response after Send starts to mirror that.
	sendDone := make(chan *RpcResponse, 1)
	go func() {
		got, err := process.Send("r1", "get_state", nil, 2*time.Second)
		if err != nil {
			t.Errorf("Send error: %v", err)
			return
		}
		sendDone <- got
	}()
	time.Sleep(100 * time.Millisecond)
	f.writeFakeResponse(`{"id":"r1","type":"response","command":"get_state","success":true,"data":{"sessionId":"s1"}}`)
	f.writeLine(`{"type":"agent_start"}`)

	got := <-sendDone
	if got == nil {
		t.Fatal("send failed (see goroutine error)")
	}
	if got.Command != "get_state" || !got.Success {
		t.Fatalf("unexpected response: %+v", got)
	}
	select {
	case evt := <-events:
		if evt.Type != "agent_start" {
			t.Fatalf("unexpected event type: %s", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

// TestJsonlRpcProcess_Timeout verifies a short-deadline request fails gracefully.
func TestJsonlRpcProcess_Timeout(t *testing.T) {
	f := newFakeRpcProcess()
	process := NewJsonlRpcProcess(f.stdinW, f.stdoutR, func(err error) {
		close(f.done)
	})
	defer process.Close()
	defer f.close()

	_, err := process.Send("r1", "get_state", nil, 10*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

// TestJsonlRpcProcess_MultipleEvents verifies sequential events dispatch.
func TestJsonlRpcProcess_MultipleEvents(t *testing.T) {
	f := newFakeRpcProcess()
	events := make(chan RpcEvent, 16)
	process := NewJsonlRpcProcess(f.stdinW, f.stdoutR, func(err error) {
		close(f.done)
	})
	defer process.Close()

	unsub := process.OnEvent(func(evt RpcEvent) { events <- evt })
	defer unsub()

	for _, line := range []string{
		`{"type":"turn_start","turnId":"t1"}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello "}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}`,
		`{"type":"tool_execution_start","toolCallId":"tc1","toolName":"bash","args":{}}`,
	} {
		f.writeLine(line)
	}
	time.Sleep(300 * time.Millisecond)

	count := 0
	for {
		select {
		case <-events:
			count++
		default:
			if count == 4 {
				return
			}
			t.Fatalf("expected 4 events, got %d", count)
		}
	}
}

// TestJsonlRpcProcess_UCSeparatorFrames verifies strict \n splitting — U+2028
// embedded in a JSON string must NOT be treated as a record separator.
func TestJsonlRpcProcess_UCSeparatorFrames(t *testing.T) {
	embedded, _ := json.Marshal(map[string]any{"type": "command_output", "text": "line\u2028within"})
	embedded2, _ := json.Marshal(map[string]any{"type": "command_output", "text": "normal"})

	f := newFakeRpcProcess()
	events := make(chan RpcEvent, 16)
	process := NewJsonlRpcProcess(f.stdinW, f.stdoutR, func(err error) {
		close(f.done)
	})
	defer process.Close()
	unsub := process.OnEvent(func(evt RpcEvent) { events <- evt })
	defer unsub()

	f.stdoutW.Write(embedded)
	f.stdoutW.Write([]byte("\n"))
	f.stdoutW.Write(embedded2)
	f.stdoutW.Write([]byte("\n"))
	time.Sleep(300 * time.Millisecond)

	count := 0
	for {
		select {
		case <-events:
			count++
		default:
			if count != 2 {
				t.Fatalf("expected exactly 2 events, got %d", count)
			}
			return
		}
	}
}
