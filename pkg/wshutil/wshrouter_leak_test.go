// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

type stalledRpcClient struct {
	peer string
}

func (c *stalledRpcClient) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) bool {
	return false
}

func (c *stalledRpcClient) RecvRpcMessage() ([]byte, bool) {
	return nil, false
}

func (c *stalledRpcClient) GetPeerInfo() string {
	return c.peer
}

func TestUnregisterLinkCleansRpcMap(t *testing.T) {
	router := NewWshRouter()
	client := &stalledRpcClient{peer: "test-disconnect"}
	linkId := router.RegisterTrustedRouter(client)

	router.registerRouteInfo("req-from-source", linkId, "route:other")
	router.registerRouteInfo("req-to-other", linkId+999, "route:keep")

	router.UnregisterLink(linkId)

	if info := router.getRouteInfo("req-from-source"); info != nil {
		t.Fatalf("expected rpcMap entry for unregistered link %d to be deleted, still present: %+v", linkId, info)
	}
	if info := router.getRouteInfo("req-to-other"); info == nil {
		t.Fatalf("expected unrelated rpcMap entry to remain intact")
	}
}

func TestLinkMsgBacklogBounded(t *testing.T) {
	router := NewWshRouter()
	client := &stalledRpcClient{peer: "test-stalled"}
	linkId := router.RegisterTrustedRouter(client)
	defer router.UnregisterLink(linkId)

	for i := 0; i < 2500; i++ {
		router.sendRpcMessageToLink(linkId, client, []byte(`{"command":"eventrecv"}`), baseds.NoLinkId, "eventrecv")
	}

	router.lock.Lock()
	backlogLen := len(router.linkMsgBacklog[linkId])
	router.lock.Unlock()

	if backlogLen > 1024 {
		t.Fatalf("expected linkMsgBacklog to be bounded (<=1024), got %d", backlogLen)
	}
}
