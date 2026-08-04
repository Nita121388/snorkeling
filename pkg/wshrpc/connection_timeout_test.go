// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "testing"

func TestConnectionOperationTimeoutCoversWshInstall(t *testing.T) {
	const minimumTimeoutMs int64 = 7 * 60 * 1000
	if ConnectionOperationTimeoutMs < minimumTimeoutMs {
		t.Fatalf("connection operation timeout is %dms, want at least %dms", ConnectionOperationTimeoutMs, minimumTimeoutMs)
	}
}
