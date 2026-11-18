// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// DefaultSendQuietMs is how long the TUI output must be silent before text is
	// injected. Matches the frontend pending-input quiet window.
	DefaultSendQuietMs = 400
	// DefaultSendWaitMs is the readiness deadline: a TUI that never goes quiet
	// (spinner, animation) must fail loudly instead of swallowing the text.
	DefaultSendWaitMs = 30000
	// MaxSendWaitMs bounds the readiness wait so an RPC cannot hang for minutes.
	MaxSendWaitMs = 120000
	// DefaultSubmitDelayMs mirrors the frontend SubmitAfterPasteDelayMs: the TUI
	// must consume the bracketed paste before a bare CR counts as "submit".
	DefaultSubmitDelayMs = 150
	MaxSubmitDelayMs     = 2000
	MinSendQuietMs       = 100
	MaxSendQuietMs       = 5000
	// MaxSendTextBytes caps one injection. A PTY paste of unbounded size would
	// either be truncated by the TUI or take minutes to render.
	MaxSendTextBytes = 64 * 1024
	sendPollInterval = 100 * time.Millisecond
)

// AgentSendCommand writes text into a term block's PTY. It is the backend twin of
// the frontend CommonText injection chain (pending-input.ts + commontext-insert.ts),
// but it does not go through the frontend at all: it waits for the TUI to be quiet
// by watching the block's term output file, then writes one bracketed paste and one
// CR through blockcontroller.SendInput — the single PTY write path.
func (ws *WshServer) AgentSendCommand(ctx context.Context, data wshrpc.AgentSendRequest) (*wshrpc.AgentSendResult, error) {
	text, err := resolveSendText(data)
	if err != nil {
		return nil, err
	}
	params, err := normalizeSendParams(data)
	if err != nil {
		return nil, err
	}

	blockId, err := resolveSendTargetBlock(ctx, data.BlockId)
	if err != nil {
		return nil, err
	}
	blockObj, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("E_NOT_FOUND: block %q not found", blockId)
	}
	view := blockObj.Meta.GetString(waveobj.MetaKey_View, "")
	if view != "term" {
		return nil, fmt.Errorf("E_BLOCK_NOT_READY: block %q is view %q, not a term block", blockId, view)
	}
	if conn := strings.TrimSpace(blockObj.Meta.GetString(waveobj.MetaKey_Connection, "")); conn != "" && conn != "local" {
		return nil, fmt.Errorf("E_UNSUPPORTED: block %q runs on connection %q (local only for now)", blockId, conn)
	}

	// A term block only has a live PTY once its controller is running. A block in a
	// background tab may have never been mounted by the frontend, so start the
	// controller here instead of failing: the launch+send path depends on it, and
	// the term file keeps the output for whenever the user looks at the block.
	if err := ensureSendBlockController(ctx, blockId, blockObj); err != nil {
		return nil, err
	}

	rtn := &wshrpc.AgentSendResult{
		Version:       wshrpc.AgentControlVersion,
		Ok:            true,
		BlockId:       blockId,
		View:          view,
		QuietMs:       params.QuietMs,
		SubmitDelayMs: params.SubmitDelayMs,
	}

	if params.Wait {
		waitedMs, err := waitForTermQuiet(ctx, blockId, params.WaitMs, params.QuietMs)
		rtn.WaitedMs = waitedMs
		if err != nil {
			return rtn, err
		}
	} else {
		rtn.Warnings = append(rtn.Warnings, "wait-skipped")
	}

	// One bracketed paste for the whole text: multi-line text must stay one paste,
	// otherwise the TUI would treat every line as a separate submission.
	if err := sendInputReady(ctx, blockId, buildInjectBytes(text)); err != nil {
		return rtn, fmt.Errorf("E_BLOCK_NOT_READY: write to pty failed: %w", err)
	}
	rtn.Injected = true

	if params.Submit {
		// The TUI needs the bracketed paste consumed before CR means "submit".
		time.Sleep(time.Duration(params.SubmitDelayMs) * time.Millisecond)
		if err := sendInputReady(ctx, blockId, []byte("\r")); err != nil {
			return rtn, fmt.Errorf("E_BLOCK_NOT_READY: submit (enter) failed: %w", err)
		}
		rtn.Submitted = true
	}
	return rtn, nil
}

// sendInputReady writes bytes through the single PTY path, tolerating the narrow
// window where the controller reports "running" but its input channel has not
// been created yet (ShellController sets ProcStatus=running before
// manageRunningShellProcess installs ShellInputCh). Without this retry a freshly
// launched block fails the very first write with "no shell input chan".
func sendInputReady(ctx context.Context, blockId string, data []byte) error {
	const readyTimeout = 3 * time.Second
	const readyPoll = 50 * time.Millisecond
	deadline := time.Now().Add(readyTimeout)
	for {
		err := blockcontroller.SendInput(blockId, &blockcontroller.BlockInputUnion{InputData: data})
		if err == nil {
			return nil
		}
		// Only the "input channel not ready yet" case is worth retrying; a missing
		// controller is a real failure.
		if !strings.Contains(err.Error(), "no shell input chan") || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(readyPoll):
		}
	}
}

// resolveSendText accepts either plain text or base64 and enforces the size cap.
// Text64 wins when both are present: it is the channel that survives control
// characters and shell quoting untouched.
func resolveSendText(data wshrpc.AgentSendRequest) (string, error) {
	raw := data.Text
	if strings.TrimSpace(data.Text64) != "" {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(data.Text64))
		if err != nil {
			return "", fmt.Errorf("E_USAGE: text64 is not valid base64: %w", err)
		}
		raw = string(decoded)
	}
	if raw == "" {
		return "", fmt.Errorf("E_USAGE: text or text64 is required")
	}
	if len(raw) > MaxSendTextBytes {
		return "", fmt.Errorf("E_USAGE: text is %d bytes, over the %d byte cap", len(raw), MaxSendTextBytes)
	}
	return SanitizeSendText(raw), nil
}

// SanitizeSendText strips C0 control characters (keeping tab and newline) so the
// injected bytes cannot carry terminal escape sequences of their own. Bracketed
// paste markers are added by buildInjectBytes, never by the caller.
func SanitizeSendText(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(r)
		case r < 0x20 || r == 0x7f:
			// drop other C0 controls, DEL, and ESC (ESC is < 0x20)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// buildInjectBytes wraps the text in bracketed paste markers. pi and other TUIs
// rely on these markers to accept a multi-line paste as one block (pi-tui #7321).
func buildInjectBytes(text string) []byte {
	return []byte("\x1b[200~" + text + "\x1b[201~")
}

type sendParams struct {
	Wait          bool
	WaitMs        int
	QuietMs       int
	Submit        bool
	SubmitDelayMs int
}

func normalizeSendParams(data wshrpc.AgentSendRequest) (sendParams, error) {
	// Submit/Wait are pointers so an explicit false survives the wire; unset
	// defaults to the documented behaviour (wait + submit).
	params := sendParams{
		Wait:          data.Wait == nil || *data.Wait,
		WaitMs:        data.WaitMs,
		QuietMs:       data.QuietMs,
		Submit:        data.Submit == nil || *data.Submit,
		SubmitDelayMs: data.SubmitDelayMs,
	}
	if params.WaitMs <= 0 {
		params.WaitMs = DefaultSendWaitMs
	}
	if params.WaitMs > MaxSendWaitMs {
		return params, fmt.Errorf("E_USAGE: waitms %d over the %d ms cap", params.WaitMs, MaxSendWaitMs)
	}
	if params.QuietMs <= 0 {
		params.QuietMs = DefaultSendQuietMs
	}
	if params.QuietMs < MinSendQuietMs || params.QuietMs > MaxSendQuietMs {
		return params, fmt.Errorf("E_USAGE: quietms %d out of range [%d,%d]", params.QuietMs, MinSendQuietMs, MaxSendQuietMs)
	}
	if params.SubmitDelayMs < 0 {
		return params, fmt.Errorf("E_USAGE: submitdelayms must not be negative")
	}
	if params.SubmitDelayMs == 0 && params.Submit {
		params.SubmitDelayMs = DefaultSubmitDelayMs
	}
	if params.SubmitDelayMs > MaxSubmitDelayMs {
		return params, fmt.Errorf("E_USAGE: submitdelayms %d over the %d ms cap", params.SubmitDelayMs, MaxSubmitDelayMs)
	}
	return params, nil
}

// resolveSendTargetBlock turns "this" into the calling block id. `this` comes from
// the RPC context (WAVETERM_BLOCKID exported into the block's shell), so it means
// "the block the agent is standing in", never a guess from the UI.
func resolveSendTargetBlock(ctx context.Context, blockId string) (string, error) {
	id := strings.TrimSpace(blockId)
	if id == "" {
		return "", fmt.Errorf("E_USAGE: --block is required (use 'this' for the calling block)")
	}
	if id == "this" {
		resolved := ""
		if handler := wshutil.GetRpcResponseHandlerFromContext(ctx); handler != nil {
			resolved = strings.TrimSpace(handler.GetRpcContext().BlockId)
		}
		if resolved == "" {
			return "", fmt.Errorf("E_NOT_FOUND: 'this' requires running inside a block (WAVETERM_BLOCKID is empty)")
		}
		return resolved, nil
	}
	return id, nil
}

// ensureSendBlockController starts the block's controller when it is not running.
// Without a live controller SendInput has nowhere to write, and failing there would
// surface as a confusing "no controller found" after the text was accepted.
func ensureSendBlockController(ctx context.Context, blockId string, blockObj *waveobj.Block) error {
	status := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
	if status != nil && status.ShellProcStatus == blockcontroller.Status_Running {
		return nil
	}
	tabId, err := findTabIdForBlock(ctx, blockId)
	if err != nil {
		return err
	}
	if err := blockcontroller.ResyncController(ctx, tabId, blockId, nil, false); err != nil {
		return fmt.Errorf("E_BLOCK_NOT_READY: could not start the block controller: %w", err)
	}
	status = blockcontroller.GetBlockControllerRuntimeStatus(blockId)
	if status == nil {
		return fmt.Errorf("E_BLOCK_NOT_READY: block %q has no controller (view=%q)", blockId, blockObj.Meta.GetString(waveobj.MetaKey_View, ""))
	}
	return nil
}

// waitForTermQuiet polls the block's term output file until it stops growing for
// quietMs. The signal is the same one the frontend uses (terminal output stops
// updating), but measured on the persisted term file instead of the xterm instance,
// so it works for blocks the frontend has never mounted.
func waitForTermQuiet(ctx context.Context, blockId string, waitMs int, quietMs int) (int, error) {
	start := time.Now()
	deadline := start.Add(time.Duration(waitMs) * time.Millisecond)
	var lastSize int64
	var lastMod int64
	haveBaseline := false
	lastChange := start
	for {
		wfile, statErr := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
		if statErr == nil && wfile != nil {
			if !haveBaseline || wfile.Size != lastSize || wfile.ModTs != lastMod {
				haveBaseline = true
				lastSize = wfile.Size
				lastMod = wfile.ModTs
				lastChange = time.Now()
			}
		} else if !haveBaseline {
			// No term file yet: the controller has not produced anything. Keep
			// waiting within the deadline instead of injecting into the void.
			haveBaseline = false
		}
		if haveBaseline {
			quietFor := time.Since(lastChange)
			if quietFor >= time.Duration(quietMs)*time.Millisecond {
				return int(time.Since(start).Milliseconds()), nil
			}
		}
		if time.Now().After(deadline) {
			return int(time.Since(start).Milliseconds()), fmt.Errorf(
				"E_AGENT_NOT_READY: no quiet window of %d ms within %d ms (block %q is still producing output)",
				quietMs, waitMs, blockId)
		}
		select {
		case <-ctx.Done():
			return int(time.Since(start).Milliseconds()), fmt.Errorf("E_AGENT_NOT_READY: cancelled while waiting for a quiet TUI")
		case <-time.After(sendPollInterval):
		}
	}
}

// findTabIdForBlock locates the tab that currently owns a block via the shared
// wstore lookup (block parents walk). ResyncController needs it, and a block
// always belongs to exactly one tab.
func findTabIdForBlock(ctx context.Context, blockId string) (string, error) {
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil || tabId == "" {
		return "", fmt.Errorf("E_NOT_FOUND: block %q is not in any tab: %v", blockId, err)
	}
	return tabId, nil
}
