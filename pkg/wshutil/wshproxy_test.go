// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bytes"
	"log"
	"strings"
	"sync"
	"testing"
)

func TestWshRpcProxySendAfterCloseDoesNotPanicLog(t *testing.T) {
	var buf bytes.Buffer
	origOut := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(origOut)

	p := MakeRpcProxy("test-peer")
	p.Close()
	p.Close() // idempotent

	if ok := p.SendRpcMessage([]byte(`{"command":"noop"}`), 1, "eventrecv"); ok {
		t.Fatalf("expected SendRpcMessage on closed proxy to return false")
	}
	if strings.Contains(buf.String(), "[panic]") || strings.Contains(buf.String(), "send on closed channel") {
		t.Fatalf("SendRpcMessage logged panic on closed proxy:\n%s", buf.String())
	}
}

func TestWshRpcProxyConcurrentSendAndCloseRaceFree(t *testing.T) {
	var buf bytes.Buffer
	origOut := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(origOut)

	p := MakeRpcProxyWithSize("race-peer", 64, 64)
	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				p.SendRpcMessage([]byte(`{"command":"eventrecv"}`), 1, "eventrecv")
			}
		}()
	}
	p.Close()
	wg.Wait()

	if strings.Contains(buf.String(), "[panic]") || strings.Contains(buf.String(), "send on closed channel") {
		t.Fatalf("concurrent SendRpcMessage + Close panicked:\n%s", buf.String())
	}
}
