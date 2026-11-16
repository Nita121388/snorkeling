// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// wsWriteTimeout bounds a single Broadcast write. A slow or half-dead client must not stall the
// hub for other connections; after this deadline the write is abandoned and the connection closed.
const wsWriteTimeout = 5 * time.Second

// Hub tracks connected WebSocket clients and broadcasts events to all of them.
//
// Broadcast is non-blocking from the caller's perspective: a write that exceeds wsWriteTimeout
// or fails for any reason causes that connection to be closed and removed, never blocks the
// push handler.
type Hub struct {
	mu    sync.Mutex
	conns map[*websocket.Conn]struct{}
}

// NewHub returns an empty hub ready to accept connections.
func NewHub() *Hub {
	return &Hub{conns: make(map[*websocket.Conn]struct{})}
}

// Register adds a connection and returns an unregister function. The caller must call the
// returned function (typically via defer) when the connection is closed, to avoid a leak.
func (h *Hub) Register(c *websocket.Conn) func() {
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
	return func() {
		h.mu.Lock()
		delete(h.conns, c)
		h.mu.Unlock()
	}
}

// Broadcast sends ev to every connected client. Write failures cause the offending connection
// to be closed and removed; other connections are unaffected.
func (h *Hub) Broadcast(ev syncproto.WSEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns {
		_ = c.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
		if err := c.WriteJSON(ev); err != nil {
			log.Printf("commontext-sync ws hub: dropping connection: %v", err)
			_ = c.Close()
			delete(h.conns, c)
		}
	}
}
