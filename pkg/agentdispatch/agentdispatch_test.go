// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentdispatch

import "testing"

func TestCanTransition(t *testing.T) {
	legal := [][2]State{
		{StatePending, StateDelivering},
		{StatePending, StateFailed},
		{StateDelivering, StateConfirmed},
		{StateDelivering, StateFailed},
		{StateFailed, StatePending},
	}
	for _, pair := range legal {
		if !CanTransition(pair[0], pair[1]) {
			t.Fatalf("%s → %s must be legal", pair[0], pair[1])
		}
	}
	illegal := [][2]State{
		{StateConfirmed, StatePending},
		{StateConfirmed, StateFailed},
		{StatePending, StateConfirmed},
		{StateDelivering, StatePending},
		{StatePending, StatePending},
	}
	for _, pair := range illegal {
		if CanTransition(pair[0], pair[1]) {
			t.Fatalf("%s → %s must be illegal", pair[0], pair[1])
		}
	}
}

func TestStoreLifecycle(t *testing.T) {
	s := NewStore()
	rec := s.Create("block-1", "tab-1", "dGV4dA==", "desktop")
	if rec.State != StatePending || rec.DispatchId == "" {
		t.Fatalf("bad create: %+v", rec)
	}
	if err := s.Transition(rec.DispatchId, StateDelivering, ""); err != nil {
		t.Fatalf("pending→delivering: %v", err)
	}
	got, _ := s.Get(rec.DispatchId)
	if got.AcceptedAt == 0 {
		t.Fatal("acceptedat must be stamped on delivering")
	}
	if err := s.Transition(rec.DispatchId, StateConfirmed, ""); err != nil {
		t.Fatalf("delivering→confirmed: %v", err)
	}
	got, _ = s.Get(rec.DispatchId)
	if got.ConfirmedAt == 0 || got.State != StateConfirmed {
		t.Fatalf("bad confirmed record: %+v", got)
	}
	// confirmed 是终态
	if err := s.Transition(rec.DispatchId, StateDelivering, ""); err == nil {
		t.Fatal("confirmed → delivering must be refused")
	}
}

func TestRetryKeepsSameRecord(t *testing.T) {
	s := NewStore()
	rec := s.Create("block-1", "", "dGV4dA==", "cli")
	if err := s.Transition(rec.DispatchId, StateDelivering, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.Transition(rec.DispatchId, StateFailed, "E_AGENT_NOT_READY: still starting"); err != nil {
		t.Fatal(err)
	}
	retried, err := s.Retry(rec.DispatchId)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if retried.DispatchId != rec.DispatchId || retried.State != StatePending {
		t.Fatalf("retry must reuse the record: %+v", retried)
	}
	if all := s.List("", 10); len(all) != 1 {
		t.Fatalf("retry must not create a second record, got %d", len(all))
	}
}

func TestListFiltersAndOrders(t *testing.T) {
	s := NewStore()
	a := s.Create("block-1", "", "dGV4dA==", "desktop")
	b := s.Create("block-2", "", "dGV4dA==", "desktop")
	all := s.List("", 10)
	if len(all) != 2 || all[0].DispatchId != b.DispatchId {
		t.Fatalf("list must be newest-first: %+v", all)
	}
	filtered := s.List("block-1", 10)
	if len(filtered) != 1 || filtered[0].DispatchId != a.DispatchId {
		t.Fatalf("block filter failed: %+v", filtered)
	}
}

func TestStoreEvictsOldestTerminal(t *testing.T) {
	s := NewStore()
	var last string
	for i := 0; i < MaxRecords+5; i++ {
		rec := s.Create("block", "", "dGV4dA==", "test")
		last = rec.DispatchId
		if i%2 == 0 {
			_ = s.Transition(rec.DispatchId, StateDelivering, "")
			_ = s.Transition(rec.DispatchId, StateConfirmed, "")
		}
	}
	if rec, ok := s.Get(last); !ok {
		t.Fatalf("newest record must survive: %+v", rec)
	}
	if n := len(s.List("", MaxRecords)); n > MaxRecords {
		t.Fatalf("store over cap: %d", n)
	}
}
