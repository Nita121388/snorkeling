// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The Connect-to list merges several sources and used to flatten them into []string, which threw
// the provenance away. These tests pin the merge rules so a refactor cannot silently re-flatten it.

func TestMergeConnectionSourcesPrecedence(t *testing.T) {
	// settings wins over sshconfig because a settings entry can override ssh-config parameters;
	// history is weakest because it carries no configuration at all.
	got := mergeConnectionSources(
		[]string{"dev-box", "nas"},
		[]string{"nas", "legacy-host"},
		[]string{"dev-box", "nas", "legacy-host", "ghost"},
	)

	if !reflect.DeepEqual(got["dev-box"], []wshrpc.ConnectionSource{wshrpc.ConnSourceSettings}) {
		t.Fatalf("dev-box should be settings only, got %v", got["dev-box"])
	}
	// A name in both settings and sshconfig keeps both, ordered by precedence.
	if !reflect.DeepEqual(got["nas"], []wshrpc.ConnectionSource{
		wshrpc.ConnSourceSettings, wshrpc.ConnSourceSshConfig,
	}) {
		t.Fatalf("nas should carry both sources in precedence order, got %v", got["nas"])
	}
	if !reflect.DeepEqual(got["legacy-host"], []wshrpc.ConnectionSource{wshrpc.ConnSourceSshConfig}) {
		t.Fatalf("legacy-host should be sshconfig only, got %v", got["legacy-host"])
	}
	// A name only seen in history is marked as such, not promoted to a configured source.
	if !reflect.DeepEqual(got["ghost"], []wshrpc.ConnectionSource{wshrpc.ConnSourceHistory}) {
		t.Fatalf("ghost should be history only, got %v", got["ghost"])
	}
}

func TestMergeConnectionSourcesOrderIsStable(t *testing.T) {
	order := mergeConnectionOrder(
		[]string{"b", "a"},
		[]string{"c", "a"},
		[]string{"d"},
	)
	// Settings entries first (in their own order), then sshconfig-only, then history-only.
	if !reflect.DeepEqual(order, []string{"b", "a", "c", "d"}) {
		t.Fatalf("unexpected order: %v", order)
	}
}

func TestMergeConnectionSourcesDeduplicatesWithinSource(t *testing.T) {
	// A duplicate inside one source must not produce a duplicated badge.
	got := mergeConnectionSources(nil, []string{"dup", "dup"}, nil)
	if !reflect.DeepEqual(got["dup"], []wshrpc.ConnectionSource{wshrpc.ConnSourceSshConfig}) {
		t.Fatalf("duplicate within a source must collapse, got %v", got["dup"])
	}
}

func TestMergeConnectionSourcesEmpty(t *testing.T) {
	got := mergeConnectionSources(nil, nil, nil)
	if len(got) != 0 {
		t.Fatalf("expected no entries, got %v", got)
	}
	if order := mergeConnectionOrder(nil, nil, nil); len(order) != 0 {
		t.Fatalf("expected no order, got %v", order)
	}
}
