// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"reflect"
	"sync"
	"testing"
)

type cmdMethodTestImpl struct{}

func (*cmdMethodTestImpl) PingpongCommand(ctx context.Context) error {
	return nil
}

func (*cmdMethodTestImpl) OtherCommand(ctx context.Context) error {
	return nil
}

// TestFindCmdMethodStablePointer asserts findCmdMethod returns the *same*
// *reflect.Method pointer for repeated lookups of the same (type, command).
// Without a cache, rtype.Method(i) re-allocates a fresh value each call, so
// the two pointers differ (red on HEAD).
func TestFindCmdMethodStablePointer(t *testing.T) {
	impl := &cmdMethodTestImpl{}
	m1 := findCmdMethod(impl, "pingpong")
	if m1 == nil {
		t.Fatal("expected to find pingpong command method")
	}
	m2 := findCmdMethod(impl, "pingpong")
	if m2 == nil {
		t.Fatal("expected to find pingpong command method on second call")
	}
	if m1 != m2 {
		t.Fatalf("expected same *reflect.Method pointer for repeated lookups, got %p and %p", m1, m2)
	}
}

// TestFindCmdMethodNotFound asserts unknown commands still resolve to nil
// (negative lookups must not be cached as a found method).
func TestFindCmdMethodNotFound(t *testing.T) {
	impl := &cmdMethodTestImpl{}
	if m := findCmdMethod(impl, "doesnotexist"); m != nil {
		t.Fatalf("expected nil for unknown command, got %+v", m)
	}
	// repeated unknown lookups stay nil
	if m := findCmdMethod(impl, "doesnotexist"); m != nil {
		t.Fatalf("expected nil for repeated unknown command, got %+v", m)
	}
	// known method still resolves after a negative lookup
	if m := findCmdMethod(impl, "other"); m == nil {
		t.Fatal("expected to find other command method after negative lookup")
	}
}

// TestFindCmdMethodConcurrent exercises concurrent lookups; the per-type cache
// must be race-free (run with -race).
func TestFindCmdMethodConcurrent(t *testing.T) {
	impl := &cmdMethodTestImpl{}
	const goroutines = 16
	const iterations = 200
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var first *reflect.Method = nil
			for i := 0; i < iterations; i++ {
				m := findCmdMethod(impl, "pingpong")
				if m == nil {
					t.Error("expected to find pingpong command method")
					return
				}
				if first == nil {
					first = m
				} else if first != m {
					t.Errorf("expected same *reflect.Method pointer across goroutine lookups, got %p and %p", first, m)
					return
				}
			}
		}()
	}
	wg.Wait()
}
