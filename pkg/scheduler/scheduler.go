// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// PlatformScheduler is the cross-platform scheduler interface used by the app.
type PlatformScheduler interface {
	Start() error
	Stop() error
	AddTask(task *wconfig.ScheduledTaskType) error
	RemoveTask(taskID string) error
	UpdateTask(task *wconfig.ScheduledTaskType) error
	GetNextRunTime(task *wconfig.ScheduledTaskType) time.Time
	RunNow(taskID string) error
}

// InProcessScheduler is Phase 1: app-lifetime, in-process scheduler using timers.
type InProcessScheduler struct {
	mu      sync.Mutex
	entries map[string]*scheduledEntry
	stopCh  chan struct{}
	runner  TaskRunner
}

type scheduledEntry struct {
	task     *wconfig.ScheduledTaskType
	nextRun  time.Time
	cancelFn context.CancelFunc
}

// NewInProcessScheduler returns a scheduler that is valid for the app lifetime.
func NewInProcessScheduler(runner TaskRunner) *InProcessScheduler {
	return &InProcessScheduler{
		entries: make(map[string]*scheduledEntry),
		stopCh:  make(chan struct{}),
		runner:  runner,
	}
}

func (s *InProcessScheduler) Start() error {
	log.Printf("[scheduler] started")
	return nil
}

func (s *InProcessScheduler) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	close(s.stopCh)
	for id, e := range s.entries {
		if e.cancelFn != nil {
			e.cancelFn()
		}
		delete(s.entries, id)
	}
	log.Printf("[scheduler] stopped")
	return nil
}

func (s *InProcessScheduler) AddTask(task *wconfig.ScheduledTaskType) error {
	if task == nil || task.Id == "" {
		return nil
	}
	_ = s.RemoveTask(task.Id)
	if !task.Enabled {
		return nil
	}
	nextRun := s.GetNextRunTime(task)
	if nextRun.IsZero() {
		return nil
	}
	ctx, cancelFn := context.WithCancel(context.Background())
	entry := &scheduledEntry{task: task, nextRun: nextRun, cancelFn: cancelFn}
	s.mu.Lock()
	s.entries[task.Id] = entry
	s.mu.Unlock()
	go s.runLoop(ctx, entry)
	return nil
}

func (s *InProcessScheduler) RemoveTask(taskID string) error {
	s.mu.Lock()
	e, ok := s.entries[taskID]
	if ok {
		delete(s.entries, taskID)
	}
	s.mu.Unlock()
	if ok && e.cancelFn != nil {
		e.cancelFn()
	}
	return nil
}

func (s *InProcessScheduler) UpdateTask(task *wconfig.ScheduledTaskType) error {
	_ = s.RemoveTask(task.Id)
	return s.AddTask(task)
}

func (s *InProcessScheduler) GetNextRunTime(task *wconfig.ScheduledTaskType) time.Time {
	if task == nil {
		return time.Time{}
	}
	loc := loadLocation(task.Schedule.Timezone)
	now := time.Now().In(loc)
	switch task.Schedule.Type {
	case "cron":
		next, err := NextCronTime(task.Schedule.CronExpr, loc, now)
		if err != nil {
			log.Printf("[scheduler] cron parse error task=%s err=%v", task.Id, err)
			return time.Time{}
		}
		return next
	case "interval":
		if task.Schedule.IntervalMs == nil || *task.Schedule.IntervalMs <= 0 {
			return time.Time{}
		}
		return now.Add(time.Duration(*task.Schedule.IntervalMs) * time.Millisecond)
	case "daily":
		return nextDailyWeekly(task, loc, now)
	case "weekly":
		return nextDailyWeekly(task, loc, now)
	case "once":
		if task.Schedule.RunAt == nil {
			return time.Time{}
		}
		t, err := time.Parse(time.RFC3339, *task.Schedule.RunAt)
		if err != nil {
			return time.Time{}
		}
		if t.Before(now) {
			return time.Time{}
		}
		return t
	}
	return time.Time{}
}

func (s *InProcessScheduler) RunNow(taskID string) error {
	s.mu.Lock()
	e, ok := s.entries[taskID]
	s.mu.Unlock()
	if !ok {
		return nil
	}
	if s.runner != nil {
		go s.runner.RunTask(e.task)
	}
	return nil
}

func (s *InProcessScheduler) runLoop(ctx context.Context, entry *scheduledEntry) {
	for {
		delay := time.Until(entry.nextRun)
		if delay <= 0 {
			delay = 10 * time.Millisecond
		}
		t := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-s.stopCh:
			t.Stop()
			return
		case <-t.C:
		}
		if s.runner != nil {
			go s.runner.RunTask(entry.task)
		}
		nextRun := s.GetNextRunTime(entry.task)
		if nextRun.IsZero() {
			return
		}
		entry.nextRun = nextRun
	}
}

func loadLocation(tz string) *time.Location {
	if tz == "" {
		return time.Local
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Local
	}
	return loc
}

func nextDailyWeekly(task *wconfig.ScheduledTaskType, loc *time.Location, now time.Time) time.Time {
	if task.Schedule.TimeOfDay == "" {
		return time.Time{}
	}
	hour, minute := splitHHMM(task.Schedule.TimeOfDay)
	target := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, loc)
	if task.Schedule.Type == "weekly" {
		wd := 0
		if task.Schedule.DayOfWeek != nil {
			wd = *task.Schedule.DayOfWeek
		}
		daysAhead := (wd - int(now.Weekday()) + 7) % 7
		if daysAhead == 0 && !target.After(now) {
			daysAhead = 7
		}
		target = target.AddDate(0, 0, daysAhead)
	} else {
		if !target.After(now) {
			target = target.AddDate(0, 0, 1)
		}
	}
	return target
}

func splitHHMM(s string) (int, int) {
	h, m := 0, 0
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			h = atoi(s[:i])
			m = atoi(s[i+1:])
			break
		}
	}
	return h, m
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}
