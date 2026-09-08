// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type TaskRunner interface {
	RunTask(task *wconfig.ScheduledTaskType) *RunResult
}

type RunResult struct {
	TaskId     string
	Status     string // success / error / timeout / cancelled
	Error      string
	DurationMs int64
}

// DefaultTaskRunner is a thin adapter that will expand to use AgentLauncher / headless execution.
type DefaultTaskRunner struct{}

func (r *DefaultTaskRunner) RunTask(task *wconfig.ScheduledTaskType) *RunResult {
	start := time.Now()
	if task == nil {
		return &RunResult{Status: "error", Error: "nil task"}
	}
	log.Printf("[scheduler] running task id=%s name=%q agent=%s model=%s", task.Id, task.Name, task.AgentProfile, task.Model)
	// Phase 1: record attempt as success placeholder until real agent launch is wired.
	return &RunResult{
		TaskId:     task.Id,
		Status:     "success",
		DurationMs: time.Since(start).Milliseconds(),
	}
}
