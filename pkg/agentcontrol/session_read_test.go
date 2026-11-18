// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func codeOf(t *testing.T, err error) string {
	t.Helper()
	var agentErr *Error
	if !errors.As(err, &agentErr) {
		t.Fatalf("expected *agentcontrol.Error, got %T: %v", err, err)
	}
	return agentErr.Code
}

// Progressive read errors must carry stable ACS codes so agents can branch.
func TestSessionReadErrorMapping(t *testing.T) {
	if code := codeOf(t, sessionReadError(errors.New("E_USAGE: turn page limit must be 1-10"))); code != CodeUsage {
		t.Fatalf("E_USAGE mapped to %q", code)
	}
	if code := codeOf(t, sessionReadError(errors.New("E_NOT_FOUND: session has 3 turns"))); code != CodeNotFound {
		t.Fatalf("E_NOT_FOUND mapped to %q", code)
	}
	if code := codeOf(t, sessionReadError(errors.New("session not found: pi:x"))); code != CodeNotFound {
		t.Fatalf("not-found message mapped to %q", code)
	}
	if code := codeOf(t, sessionReadError(errors.New("session id is required"))); code != CodeUsage {
		t.Fatalf("missing id mapped to %q", code)
	}
	if code := codeOf(t, sessionReadError(errors.New("boom"))); code != CodeInternal {
		t.Fatalf("unknown error mapped to %q", code)
	}
}

// The stateless gate: turns needs an explicit limit (1-10), turn needs chars
// (1-8000) — both rejected before any session lookup happens.
func TestSessionReadGatesBeforeLookup(t *testing.T) {
	_, err := GetSessionTurns(context.Background(), wshrpc.SessionTurnsRequest{Identifier: "pi:x", Limit: 0})
	if code := codeOf(t, err); code != CodeUsage {
		t.Fatalf("missing limit mapped to %q: %v", code, err)
	}
	if !strings.Contains(err.Error(), "session info") {
		t.Fatalf("gate error must point at 'session info': %v", err)
	}
	_, err = GetSessionTurns(context.Background(), wshrpc.SessionTurnsRequest{Identifier: "pi:x", Limit: 11})
	if code := codeOf(t, err); code != CodeUsage {
		t.Fatalf("limit>10 mapped to %q: %v", code, err)
	}
	_, err = GetSessionTurn(context.Background(), wshrpc.SessionTurnRequest{Identifier: "pi:x", Turn: 1, Chars: 0})
	if code := codeOf(t, err); code != CodeUsage {
		t.Fatalf("missing chars mapped to %q: %v", code, err)
	}
	_, err = GetSessionTurn(context.Background(), wshrpc.SessionTurnRequest{Identifier: "pi:x", Turn: 1, Chars: 8001})
	if code := codeOf(t, err); code != CodeUsage {
		t.Fatalf("chars>8000 mapped to %q: %v", code, err)
	}
	_, err = GetSessionInfo(context.Background(), wshrpc.SessionInfoRequest{})
	if code := codeOf(t, err); code != CodeUsage {
		t.Fatalf("missing identifier mapped to %q: %v", code, err)
	}
}
