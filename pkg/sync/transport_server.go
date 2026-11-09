// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sync

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/syncclient"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// ServerTransport adapts syncclient.Client to the Transport interface.
//
// It is a thin adapter on purpose: the HTTP/REST knowledge stays in syncclient (which is also what
// `wsh commontext-sync doctor` uses), so a protocol change lands in one place. All this adds is the
// mapping from syncclient's shapes to the engine's, plus the transport identity/capabilities.
type ServerTransport struct {
	Client *syncclient.Client
}

func NewServerTransport(baseURL, token string, allowInsecure bool) (*ServerTransport, error) {
	normalized, err := syncclient.ValidateURL(baseURL, allowInsecure)
	if err != nil {
		return nil, err
	}
	return &ServerTransport{
		Client: &syncclient.Client{BaseURL: normalized, Token: token, AllowInsecure: allowInsecure},
	}, nil
}

func (t *ServerTransport) Id() TransportId { return TransportServer }

func (t *ServerTransport) Caps() Caps {
	return Caps{
		RequiresCredential: true,
		// The client never writes a file directly; the server owns its SQLite writes, and HTTP
		// bodies are delivered whole, so a partial payload cannot be observed.
		AtomicWrite: true,
		// /v1/snapshot?sinceRev=N is a real incremental read.
		Incremental: true,
		// Realtime (WebSocket) is not implemented yet — the engine must not promise it.
		Realtime: false,
	}
}

func (t *ServerTransport) Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error) {
	snap, err := t.Client.Pull(ctx, sinceRev)
	if err != nil {
		return nil, err
	}
	return snap, nil
}

func (t *ServerTransport) Push(ctx context.Context, req syncproto.PushRequest) (*PushOutcome, error) {
	res, err := t.Client.Push(ctx, req)
	if err != nil {
		return nil, err
	}
	outcome := &PushOutcome{
		Applied:   res.AppliedCount,
		Unchanged: res.Unchanged,
		Conflicts: res.Conflicts,
		Items:     res.Items,
		Rev:       res.Rev,
	}
	if !res.Applied {
		// The server moved on between our pull and push. Report it instead of retrying in a loop:
		// the caller decides whether to reconcile now or on the next tick.
		outcome.StaleBase = true
		outcome.Current = res.Current
	}
	return outcome, nil
}

// Probe runs the same diagnostics `wsh commontext-sync doctor` runs, for the status panel.
func (t *ServerTransport) Probe(ctx context.Context) *syncclient.Probe {
	return syncclient.Diagnose(ctx, t.Client.BaseURL, t.Client.Token, t.Client.AllowInsecure)
}

func (t *ServerTransport) String() string {
	if t == nil || t.Client == nil {
		return "server(<unconfigured>)"
	}
	return fmt.Sprintf("server(%s)", t.Client.BaseURL)
}
