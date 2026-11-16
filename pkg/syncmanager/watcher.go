// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncmanager

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncclient"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// Tunable timings — package-level vars so tests can shorten them without patching constants.
var (
	// notifyDebounce is the quiet period after a WS event before SyncNow("notify") fires.
	// Merges bursts of events into one pull.
	notifyDebounce = 500 * time.Millisecond
	// nudgeDebounce is the quiet period after a local save before SyncNow("save") fires.
	nudgeDebounce = 2 * time.Second
	// watchBackoffMin / watchBackoffMax bound the exponential reconnection backoff.
	watchBackoffMin = 1 * time.Second
	watchBackoffMax = 30 * time.Second
	// watchMaxNonNetErrors: after this many consecutive non-network (HTTP 4xx/5xx) dial failures,
	// the watcher gives up until the next reload. Prevents log spam against old servers.
	watchMaxNonNetErrors = 3
)

// watchClient is the interface the watcher uses to establish a WebSocket connection.
// *syncclient.Client implements this; a fake is used in tests. onConnected is called after the
// handshake succeeds (nil is allowed).
type watchClient interface {
	Watch(ctx context.Context, onEvent func(syncproto.WSEvent), onConnected func()) error
}

// syncTriggerFunc is the function called when a notify or nudge fires. Injectable for tests —
// the production value is set in init() to avoid a Go initialization cycle
// (syncTriggerFunc → SyncNow → reload → startWatcher → run → consumeNotifications → syncTriggerFunc).
var syncTriggerFunc func(ctx context.Context, trigger string)

func init() {
	syncTriggerFunc = func(ctx context.Context, trigger string) {
		_, _ = SyncNow(ctx, trigger)
	}
}

// activeWatcher is the process-wide watcher instance (nil when not running).
// Guarded by mu (the same mutex that guards engine).
var activeWatcher *watcher

// watcher manages a long-lived WebSocket connection to the sync server for real-time
// rev-advance notifications. It reconnects with exponential backoff on failure and stops
// permanently after watchMaxNonNetErrors consecutive non-network (HTTP) errors.
type watcher struct {
	cancel context.CancelFunc
	done   chan struct{} // closed when the run goroutine (and its consumer) have exited

	mu        sync.Mutex
	connected bool
	clientURL string
}

// startWatcher spawns the WebSocket reconnection loop. It returns immediately; the caller
// should call stopWatcher to clean up when done.
func startWatcher(client watchClient) *watcher {
	ctx, cancel := context.WithCancel(context.Background())
	w := &watcher{
		cancel: cancel,
		done:   make(chan struct{}),
	}
	if c, ok := client.(*syncclient.Client); ok {
		w.clientURL = c.BaseURL
	}
	go w.run(ctx, client)
	return w
}

// stopWatcher cancels the watcher and waits for all goroutines to exit. Safe to call on nil.
func stopWatcher(w *watcher) {
	if w == nil {
		return
	}
	w.cancel()
	<-w.done
}

// isConnected reports whether the WebSocket connection is currently established.
func (w *watcher) IsConnected() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.connected
}

// run is the watcher's main loop: connect → consume events → reconnect on failure.
// It exits when ctx is cancelled or after too many non-network errors.
func (w *watcher) run(ctx context.Context, client watchClient) {
	defer close(w.done)
	backoff := watchBackoffMin
	nonNetErrors := 0

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Set up a fresh notification channel for this connection attempt.
		notifyCh := make(chan struct{}, 1)
		consumerDone := make(chan struct{})
		go func() {
			defer close(consumerDone)
			w.consumeNotifications(ctx, notifyCh)
		}()

		w.mu.Lock()
		w.connected = false // only set true once the handshake really succeeded
		w.mu.Unlock()

		onEvent := func(_ syncproto.WSEvent) {
			// Non-blocking send: if a notification is already pending, drop this one.
			// The debounce consumer will pull the latest state anyway.
			select {
			case notifyCh <- struct{}{}:
			default:
			}
		}
		onConnected := func() {
			w.mu.Lock()
			w.connected = true
			w.mu.Unlock()
		}

		err := client.Watch(ctx, onEvent, onConnected)

		w.mu.Lock()
		w.connected = false
		w.mu.Unlock()

		// Stop the consumer for this connection attempt.
		close(notifyCh)
		<-consumerDone

		if ctx.Err() != nil {
			return
		}

		// Classify the error.
		if isNonNetworkDialError(err) {
			nonNetErrors++
			if nonNetErrors == 1 {
				// Log once per streak — don't spam against an old server.
				log.Printf("commontext sync watcher: server does not support WebSocket (%v); retrying", err)
			}
			if nonNetErrors >= watchMaxNonNetErrors {
				log.Printf("commontext sync watcher: giving up after %d consecutive non-network errors; "+
					"will retry on next config reload", nonNetErrors)
				return
			}
		} else {
			nonNetErrors = 0
			// Network errors are expected (server restart, network flap). Log at low priority.
			log.Printf("commontext sync watcher: disconnected, reconnecting in %v: %v", backoff, err)
		}

		// Exponential backoff before reconnecting.
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > watchBackoffMax {
			backoff = watchBackoffMax
		}
	}
}

// consumeNotifications reads from notifyCh, debounces, and fires SyncNow("notify").
// One goroutine runs per connection attempt; it exits when ctx is cancelled or notifyCh is closed.
func (w *watcher) consumeNotifications(ctx context.Context, ch <-chan struct{}) {
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-ch:
			if !ok {
				return
			}
			// Debounce: wait for notifyDebounce of quiet, draining any additional events.
			if !debounceWait(ctx, ch, notifyDebounce) {
				return // ctx cancelled during debounce
			}
			syncTriggerFunc(ctx, "notify")
		}
	}
}

// debounceWait waits for d of silence on ch, returning false if ctx was cancelled.
// Any events that arrive during the window reset the timer (proper debounce).
func debounceWait(ctx context.Context, ch <-chan struct{}, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			return true
		case _, ok := <-ch:
			if !ok {
				return false
			}
			// Reset the timer for a new quiet window.
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(d)
		}
	}
}

// isNonNetworkDialError reports whether err is an HTTP error response (404, 401, etc.) from
// the WebSocket handshake, as opposed to a network-level failure (connection refused, timeout).
// Non-network errors indicate a persistent configuration mismatch (e.g. old server without WS)
// and should not be retried indefinitely.
func isNonNetworkDialError(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *syncclient.WSHTTPError
	if errors.As(err, &httpErr) {
		return true
	}
	// Fallback: check error message for HTTP status patterns (belt-and-suspenders).
	msg := err.Error()
	return strings.Contains(msg, "HTTP 4") || strings.Contains(msg, "HTTP 5") ||
		strings.Contains(msg, "bad handshake")
}

// ── Nudge (save-triggered sync) ───────────────────────────────────────────────────────────────

// nudgeMu serializes access to nudgeTimer.
var nudgeMu sync.Mutex
var nudgeTimer *time.Timer

// Nudge signals that local Common Text data has changed and a debounced save sync should run.
//
// Multiple Nudge calls within nudgeDebounce coalesce into one SyncNow(trigger="save").
// When sync is not configured (no engine), Nudge is a silent no-op.
// Safe to call from any goroutine; never blocks the caller.
func Nudge() {
	mu.Lock()
	eng := engine
	mu.Unlock()
	if eng == nil {
		return // not configured — silent no-op
	}

	nudgeMu.Lock()
	defer nudgeMu.Unlock()
	if nudgeTimer != nil {
		// Already scheduled: reset the timer so the debounce window extends.
		nudgeTimer.Reset(nudgeDebounce)
		return
	}
	nudgeTimer = time.AfterFunc(nudgeDebounce, func() {
		nudgeMu.Lock()
		nudgeTimer = nil
		nudgeMu.Unlock()
		syncTriggerFunc(context.Background(), "save")
	})
}
