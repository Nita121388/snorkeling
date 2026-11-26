// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"fmt"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WshRpcProxy struct {
	Lock         *sync.Mutex
	closeLock    sync.RWMutex
	closed       bool
	RpcContext   *wshrpc.RpcContext
	ToRemoteCh   chan []byte
	FromRemoteCh chan baseds.RpcInputChType
	PeerInfo     string
}

func MakeRpcProxy(peerInfo string) *WshRpcProxy {
	return MakeRpcProxyWithSize(peerInfo, DefaultInputChSize, DefaultOutputChSize)
}

func MakeRpcProxyWithSize(peerInfo string, inputChSize int, outputChSize int) *WshRpcProxy {
	return &WshRpcProxy{
		Lock:         &sync.Mutex{},
		ToRemoteCh:   make(chan []byte, inputChSize),
		FromRemoteCh: make(chan baseds.RpcInputChType, outputChSize),
		PeerInfo:     peerInfo,
	}
}

func (p *WshRpcProxy) GetPeerInfo() string {
	return p.PeerInfo
}

func (p *WshRpcProxy) SetPeerInfo(peerInfo string) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	p.PeerInfo = peerInfo
}

// Close safely marks the proxy closed and closes ToRemoteCh once so concurrent
// SendRpcMessage callers return false without panicking on a closed channel.
func (p *WshRpcProxy) Close() {
	p.closeLock.Lock()
	defer p.closeLock.Unlock()
	if p.closed {
		return
	}
	p.closed = true
	close(p.ToRemoteCh)
}

func (p *WshRpcProxy) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) (sent bool) {
	p.closeLock.RLock()
	defer p.closeLock.RUnlock()
	if p.closed {
		return false
	}
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		// Fallback guard in case a legacy caller closed ToRemoteCh directly without Close().
		if err, ok := r.(error); ok && err.Error() == "send on closed channel" {
			sent = false
			return
		}
		panicCtx := "WshRpcProxy.SendRpcMessage"
		if debugStr != "" {
			panicCtx = fmt.Sprintf("%s:%s", panicCtx, debugStr)
		}
		panichandler.PanicHandler(panicCtx, r)
		sent = false
	}()
	select {
	case p.ToRemoteCh <- msg:
		return true
	default:
		return false
	}
}

func (p *WshRpcProxy) RecvRpcMessage() ([]byte, bool) {
	inputVal, more := <-p.FromRemoteCh
	return inputVal.MsgBytes, more
}
