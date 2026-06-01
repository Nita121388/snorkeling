// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestSetRTInfoStoresShellLastUpdated(t *testing.T) {
	oref := waveobj.MakeORef(waveobj.OType_Block, "block-rtinfo-test")
	DeleteRTInfo(oref)
	defer DeleteRTInfo(oref)

	SetRTInfo(oref, map[string]any{
		"shell:integration": true,
		"shell:state":       "running-command",
		"shell:lastupdated": int64(1790000000000),
	})

	rtInfo := GetRTInfo(oref)
	if rtInfo == nil {
		t.Fatal("expected runtime info")
	}
	if !rtInfo.ShellIntegration {
		t.Fatal("expected shell integration to be true")
	}
	if rtInfo.ShellState != "running-command" {
		t.Fatalf("expected shell state running-command, got %q", rtInfo.ShellState)
	}
	if rtInfo.ShellLastUpdated != 1790000000000 {
		t.Fatalf("expected shell last updated timestamp, got %d", rtInfo.ShellLastUpdated)
	}
}
