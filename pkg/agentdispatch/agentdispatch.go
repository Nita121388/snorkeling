// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentdispatch 持有「给 agent 块派发一条消息」的服务端状态。
//
// 为什么需要它（2026-11-21 真机事故）：agent TUI 启动可能几十秒到几分钟（pi 会跑 npm 查扩展更新），
// 这期间回车会被吞。把派发当成一次前端 RPC 的同步等待，会把 UI 卡死；把送达当成前端 promise，
// 手机端/CLI/MCP 就没有权威状态可读。所以派发是服务端状态机，任何端只做「提交 + 读回执」。
//
// 状态机：pending → delivering → confirmed / failed，failed 可 retry 回 pending（同 dispatchid，不新建记录）。
// 三段回执：acceptedat（消息已写进 TUI 输入缓冲）→ submittedat（回车确认生效）
// → confirmedat（agent 状态 hook 报活跃，例如 pi 的 agent_start → working）。
package agentdispatch

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type State string

const (
	StatePending    State = "pending"
	StateDelivering State = "delivering"
	StateConfirmed  State = "confirmed"
	StateFailed     State = "failed"
)

// MaxRecords caps the in-memory store. Oldest terminal records are dropped first:
// the store is an observability + retry surface, not an audit log.
const MaxRecords = 500

type Record struct {
	DispatchId string `json:"dispatchid"`
	BlockId    string `json:"blockid"`
	TabId      string `json:"tabid,omitempty"`
	Text64     string `json:"text64,omitempty"`
	// Requester names the surface that submitted: desktop / cli / mcp / mobile.
	// Mobile consumers filter by it, and it survives the transport.
	Requester string `json:"requester,omitempty"`
	State     State  `json:"state"`
	// Three-stage receipt. 0 = stage not reached.
	CreatedAt   int64  `json:"createdat"`
	UpdatedAt   int64  `json:"updatedat"`
	AcceptedAt  int64  `json:"acceptedat,omitempty"`
	SubmittedAt int64  `json:"submittedat,omitempty"`
	ConfirmedAt int64  `json:"confirmedat,omitempty"`
	Attempts    int    `json:"attempts,omitempty"`
	// SubmitRetries counts CR re-sends while the TUI stayed silent (startup gate).
	SubmitRetries int    `json:"submitretries,omitempty"`
	Error         string `json:"error,omitempty"`
}

type Store struct {
	mu      sync.Mutex
	records map[string]*Record
	order   []string
	nowFn   func() time.Time
}

var DefaultStore = NewStore()

func NewStore() *Store {
	return &Store{records: make(map[string]*Record), nowFn: time.Now}
}

func newDispatchId() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("d-%d", time.Now().UnixNano())
	}
	return "d-" + hex.EncodeToString(buf)
}

// CanTransition reports whether from → to is legal. Pure; unit-tested.
func CanTransition(from, to State) bool {
	switch from {
	case StatePending:
		return to == StateDelivering || to == StateFailed
	case StateDelivering:
		return to == StateConfirmed || to == StateFailed
	case StateFailed:
		return to == StatePending // retry
	case StateConfirmed:
		return false
	}
	return false
}

func (s *Store) now() int64 { return s.nowFn().UnixMilli() }

// Create records a new dispatch and returns its id. Empty requester defaults to "unknown".
func (s *Store) Create(blockId, tabId, text64, requester string) *Record {
	now := s.now()
	rec := &Record{
		DispatchId: newDispatchId(),
		BlockId:    blockId,
		TabId:      tabId,
		Text64:     text64,
		Requester:  requester,
		State:      StatePending,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[rec.DispatchId] = rec
	s.order = append(s.order, rec.DispatchId)
	s.evictLocked()
	// 返回副本：调用方/goroutine 拿到的快照不会被并发改写
	snapshot := *rec
	return &snapshot
}

// Update applies fn to the record under the lock and stamps updatedat.
func (s *Store) Update(id string, fn func(rec *Record)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.records[id]
	if !ok {
		return
	}
	fn(rec)
	rec.UpdatedAt = s.now()
}

// Transition moves a record to next state, validating the edge.
func (s *Store) Transition(id string, next State, errMsg string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.records[id]
	if !ok {
		return fmt.Errorf("E_NOT_FOUND: dispatch %q not found", id)
	}
	if !CanTransition(rec.State, next) {
		return fmt.Errorf("E_INVALID_STATE: %s → %s", rec.State, next)
	}
	now := s.now()
	rec.State = next
	rec.UpdatedAt = now
	if errMsg != "" {
		rec.Error = errMsg
	}
	switch next {
	case StateDelivering:
		rec.AcceptedAt = now
	case StateConfirmed:
		rec.ConfirmedAt = now
		rec.Error = ""
	case StateFailed:
		if rec.Error == "" {
			rec.Error = "failed"
		}
	}
	return nil
}

func (s *Store) Get(id string) (Record, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.records[id]
	if !ok {
		return Record{}, false
	}
	return *rec, true
}

// List returns newest-first records, optionally filtered by block id.
func (s *Store) List(blockId string, limit int) []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > MaxRecords {
		limit = 50
	}
	out := make([]Record, 0, limit)
	for i := len(s.order) - 1; i >= 0 && len(out) < limit; i-- {
		rec, ok := s.records[s.order[i]]
		if !ok {
			continue
		}
		if blockId != "" && rec.BlockId != blockId {
			continue
		}
		out = append(out, *rec)
	}
	return out
}

// Retry moves a failed record back to pending. Same id: no duplicate record.
func (s *Store) Retry(id string) (Record, error) {
	if err := s.Transition(id, StatePending, ""); err != nil {
		return Record{}, err
	}
	rec, _ := s.Get(id)
	return rec, nil
}

// evictLocked drops the oldest terminal record when over capacity.
func (s *Store) evictLocked() {
	for len(s.order) > MaxRecords {
		evicted := false
		for i, id := range s.order {
			rec, ok := s.records[id]
			if !ok {
				s.order = append(s.order[:i], s.order[i+1:]...)
				evicted = true
				break
			}
			if rec.State == StateConfirmed || rec.State == StateFailed {
				delete(s.records, id)
				s.order = append(s.order[:i], s.order[i+1:]...)
				evicted = true
				break
			}
		}
		if !evicted {
			return
		}
	}
}
