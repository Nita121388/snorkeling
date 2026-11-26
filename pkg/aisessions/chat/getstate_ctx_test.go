// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"context"
	"io"
	"testing"
	"time"
)

func TestSessionGetStateHonorsContextDeadline(t *testing.T) {
	pr, pw := io.Pipe()
	defer pr.Close()
	defer pw.Close()

	// Drain stdin so rpc.Send never blocks on pipe write.
	go func() {
		_, _ = io.Copy(io.Discard, pr)
	}()

	rpc := &JsonlRpcProcess{
		stdin:   pw,
		pending: make(map[string]*promise),
	}
	sess := &Session{rpc: rpc}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	errCh := make(chan error, 1)
	start := time.Now()
	go func() {
		_, err := sess.GetState(ctx)
		errCh <- err
	}()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatalf("expected error on 100ms ctx deadline, got nil")
		}
		if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
			t.Fatalf("GetState took %s for 100ms deadline", elapsed)
		}
	case <-time.After(600 * time.Millisecond):
		_ = rpc.Close()
		t.Fatalf("Session.GetState ignored 100ms context deadline (still waiting on 30s timeout)")
	}
}
