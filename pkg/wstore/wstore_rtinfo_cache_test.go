// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// TestRTInfoTagMapCached asserts the json-tag -> field-index map is built once
// per reflect.Type and reused afterwards (same map header pointer). Rebuilding
// the map on every SetRTInfo call (HEAD behavior) returns a different map each
// time, so this test is red without the cache.
func TestRTInfoTagMapCached(t *testing.T) {
	rtInfoType := reflect.TypeOf(waveobj.ObjRTInfo{})

	m1 := getRTInfoTagMap(rtInfoType)
	if m1 == nil {
		t.Fatal("expected a non-nil tag map")
	}
	m2 := getRTInfoTagMap(rtInfoType)
	if m2 == nil {
		t.Fatal("expected a non-nil tag map on second call")
	}
	p1 := reflect.ValueOf(m1).Pointer()
	p2 := reflect.ValueOf(m2).Pointer()
	if p1 != p2 {
		t.Fatalf("expected cached tag map to be reused (same map header), got %#x and %#x", p1, p2)
	}

	// sanity: known json tags are present, omitempty is stripped, unknown keys absent
	if idx, ok := m1["shell:state"]; !ok || idx < 0 {
		t.Fatal("expected shell:state tag in map")
	}
	if _, ok := m1["tsunami:appmeta"]; !ok {
		t.Fatal("expected tsunami:appmeta tag (omitempty stripped) in map")
	}
	if _, ok := m1["no:such:tag"]; ok {
		t.Fatal("did not expect unknown tag in map")
	}
}

// TestSetRTInfoUsesCachedTagMap checks SetRTInfo keeps merging correctly while
// served entirely by the cached map (multiple calls, multiple keys, nil reset).
func TestSetRTInfoUsesCachedTagMap(t *testing.T) {
	oref := waveobj.MakeORef(waveobj.OType_Block, "block-rtinfo-cache-test")
	DeleteRTInfo(oref)
	defer DeleteRTInfo(oref)

	SetRTInfo(oref, map[string]any{"shell:state": "running-command"})
	SetRTInfo(oref, map[string]any{"shell:type": "zsh", "shell:lastupdated": int64(1790000000000)})
	SetRTInfo(oref, map[string]any{"not:a:field": "ignored"})

	rtInfo := GetRTInfo(oref)
	if rtInfo == nil {
		t.Fatal("expected runtime info")
	}
	if rtInfo.ShellState != "running-command" {
		t.Fatalf("expected shell state preserved, got %q", rtInfo.ShellState)
	}
	if rtInfo.ShellType != "zsh" {
		t.Fatalf("expected shell type zsh, got %q", rtInfo.ShellType)
	}
	if rtInfo.ShellLastUpdated != 1790000000000 {
		t.Fatalf("expected shell last updated timestamp, got %d", rtInfo.ShellLastUpdated)
	}

	// nil resets a field back to its zero value through the same cached map
	SetRTInfo(oref, map[string]any{"shell:state": nil})
	rtInfo = GetRTInfo(oref)
	if rtInfo.ShellState != "" {
		t.Fatalf("expected shell state cleared by nil, got %q", rtInfo.ShellState)
	}
}

// TestGetRTInfoTagMapConcurrent exercises concurrent cache reads/writes of the
// tag map (run with -race).
func TestGetRTInfoTagMapConcurrent(t *testing.T) {
	rtInfoType := reflect.TypeOf(waveobj.ObjRTInfo{})
	done := make(chan struct{})
	for i := 0; i < 8; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			for j := 0; j < 100; j++ {
				m := getRTInfoTagMap(rtInfoType)
				if m == nil || m["shell:state"] < 0 {
					t.Error("expected valid cached tag map")
					return
				}
			}
		}()
	}
	deadline := time.After(10 * time.Second)
	for i := 0; i < 8; i++ {
		select {
		case <-done:
		case <-deadline:
			t.Fatal("timed out waiting for concurrent tag map readers")
		}
	}
}
