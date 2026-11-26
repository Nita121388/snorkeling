// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestWriteLoopRefreshesWriteDeadlineBeforeMessage(t *testing.T) {
	serverConnCh := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		serverConnCh <- conn
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer clientConn.Close()

	serverConn := <-serverConnCh
	defer serverConn.Close()

	// Simulate an almost-expired write deadline left over from a prior WritePing().
	if err := serverConn.SetWriteDeadline(time.Now().Add(30 * time.Millisecond)); err != nil {
		t.Fatalf("set write deadline: %v", err)
	}

	outputCh := make(chan any, 4)
	closeCh := make(chan any)
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		WriteLoop(serverConn, outputCh, closeCh, "tab:test-deadline")
	}()

	// Wait until the prior deadline has expired, then send a normal message.
	time.Sleep(60 * time.Millisecond)
	outputCh <- map[string]any{"eventtype": "rpc", "data": "ok"}

	_ = clientConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, payload, err := clientConn.ReadMessage()
	if err != nil {
		close(closeCh)
		<-doneCh
		t.Fatalf("expected WriteLoop to refresh write deadline and deliver message, got error: %v", err)
	}
	if !strings.Contains(string(payload), `"ok"`) {
		t.Fatalf("unexpected payload: %s", string(payload))
	}

	close(closeCh)
	<-doneCh
}
