// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// RunStore holds in-memory run history. Phase 1 does not persist runs to disk.
type RunStore struct {
	mu   sync.Mutex
	runs map[string][]wconfig.ScheduledTaskRunRecord // taskId -> records
}

func NewRunStore() *RunStore {
	return &RunStore{runs: make(map[string][]wconfig.ScheduledTaskRunRecord)}
}

func (s *RunStore) RecordRun(taskId string, status string, durationMs int64, errMsg string, output string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record := wconfig.ScheduledTaskRunRecord{
		TaskId:     taskId,
		Status:     status,
		DurationMs: durationMs,
		Error:      errMsg,
		Output:     output,
	}
	s.runs[taskId] = append(s.runs[taskId], record)
	// cap per-task history to avoid unbounded growth
	if len(s.runs[taskId]) > 200 {
		s.runs[taskId] = s.runs[taskId][len(s.runs[taskId])-200:]
	}
	log.Printf("[scheduler] recorded run taskId=%s status=%s dur=%dms", taskId, status, durationMs)
}

func (s *RunStore) GetRuns(taskId string, limit int) []wconfig.ScheduledTaskRunRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.runs[taskId]
	if limit <= 0 || limit > len(all) {
		limit = len(all)
	}
	out := make([]wconfig.ScheduledTaskRunRecord, limit)
	copy(out, all[len(all)-limit:])
	// reverse so newest first
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}
