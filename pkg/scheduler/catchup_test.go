// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func ivalPtr(v int64) *int64 { return &v }

func lastRunAtString(t *testing.T, v time.Time) *string {
	t.Helper()
	s := v.UTC().Format(time.RFC3339)
	return &s
}

func TestFindMissedOccurrenceInterval(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	task := &wconfig.ScheduledTaskType{
		Id:        "t1",
		Enabled:   true,
		LastRunAt: lastRunAtString(t, now.Add(-1*time.Hour)),
		Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
	}
	missed := FindMissedOccurrence(task, now)
	want := now.Add(-50 * time.Minute) // lastRunAt + 10m
	if missed.IsZero() {
		t.Fatal("expected a missed occurrence")
	}
	if !missed.Equal(want) {
		t.Fatalf("missed = %s, want %s", missed, want)
	}
}

func TestFindMissedOccurrenceIntervalNotYet(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	task := &wconfig.ScheduledTaskType{
		Id:        "t1",
		Enabled:   true,
		LastRunAt: lastRunAtString(t, now.Add(-5*time.Minute)),
		Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
	}
	if missed := FindMissedOccurrence(task, now); !missed.IsZero() {
		t.Fatalf("expected no miss, got %s", missed)
	}
}

func TestFindMissedOccurrenceSkipsDisabledAndNeverRun(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	disabled := &wconfig.ScheduledTaskType{
		Id:        "t1",
		Enabled:   false,
		LastRunAt: lastRunAtString(t, now.Add(-1*time.Hour)),
		Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
	}
	if missed := FindMissedOccurrence(disabled, now); !missed.IsZero() {
		t.Fatalf("disabled task must not catch up, got %s", missed)
	}
	neverRan := &wconfig.ScheduledTaskType{
		Id:       "t2",
		Enabled:  true,
		Schedule: wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
	}
	if missed := FindMissedOccurrence(neverRan, now); !missed.IsZero() {
		t.Fatalf("task that never ran must not catch up, got %s", missed)
	}
}

func TestFindMissedOccurrenceCronPast(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	// last run yesterday 08:00 UTC; cron fires daily at 09:00 -> one miss at yesterday 09:00 UTC.
	task := &wconfig.ScheduledTaskType{
		Id:        "t1",
		Enabled:   true,
		LastRunAt: lastRunAtString(t, now.AddDate(0, 0, -1).Truncate(24*time.Hour).Add(8*time.Hour)),
		Schedule:  wconfig.ScheduledTaskScheduleType{Type: "cron", CronExpr: "0 9 * * *", Timezone: "UTC"},
	}
	missed := FindMissedOccurrence(task, now)
	if missed.IsZero() {
		t.Fatal("expected a missed cron occurrence")
	}
	want := now.AddDate(0, 0, -1).Truncate(24 * time.Hour).Add(9 * time.Hour)
	if !missed.Equal(want) {
		t.Fatalf("missed = %s, want %s", missed, want)
	}
}

// fakeTaskRunner simulates the real runner's meta persistence: it advances
// LastRunAt to `now` (like updateScheduledTaskMeta does) and counts invocations.
type fakeTaskRunner struct {
	now time.Time
	ran []string
}

func (f *fakeTaskRunner) RunTask(task *wconfig.ScheduledTaskType) *RunResult {
	f.ran = append(f.ran, task.Id)
	nowStr := f.now.UTC().Format(time.RFC3339)
	task.LastRunAt = &nowStr
	return &RunResult{TaskId: task.Id, Status: RunStatusSuccess, ExitCode: 0}
}

// TestCatchUpMissedRunsOnceIsA9: lastRunAt=1h ago + every:10m -> exactly one
// catch-up run, marked; a second startup (LastRunAt now advanced) runs nothing.
func TestCatchUpMissedRunsOnce(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	items := []wconfig.ScheduledTaskType{
		{
			Id:        "t-hourly",
			Name:      "missed one",
			Enabled:   true,
			LastRunAt: lastRunAtString(t, now.Add(-1*time.Hour)),
			Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
		},
		{
			Id:        "t-fresh",
			Name:      "ran five minutes ago",
			Enabled:   true,
			LastRunAt: lastRunAtString(t, now.Add(-5*time.Minute)),
			Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
		},
		// A missed task must still be picked up; the OTHER cases assert no re-run.
		{
			Id:        "t-disabled",
			Name:      "must be skipped",
			Enabled:   false,
			LastRunAt: lastRunAtString(t, now.Add(-2*time.Hour)),
			Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
		},
	}

	var marked []string
	// notifyMissed mirrors wshserver.markScheduledTaskMissedRun: persist
	// LastRunStatus=missed-run on top of the run's own meta update.
	notifyMissed := func(taskID string) {
		marked = append(marked, taskID)
		for i := range items {
			if items[i].Id == taskID {
				status := RunStatusMissedRun
				items[i].LastRunStatus = &status
			}
		}
	}
	runner := &fakeTaskRunner{now: now}

	caught := CatchUpMissed(runner, items, now, notifyMissed)
	if len(caught) != 1 || caught[0] != "t-hourly" {
		t.Fatalf("first pass caught = %v, want [t-hourly]", caught)
	}
	if len(runner.ran) != 1 || runner.ran[0] != "t-hourly" {
		t.Fatalf("first pass ran = %v, want exactly [t-hourly]", runner.ran)
	}
	if len(marked) != 1 || marked[0] != "t-hourly" {
		t.Fatalf("marked = %v, want [t-hourly] (this is where LastRunStatus=missed-run is written)", marked)
	}
	// The marked task's LastRunStatus is persisted as missed-run (simulated).
	found := false
	for i := range items {
		if items[i].Id == "t-hourly" && items[i].LastRunStatus != nil && *items[i].LastRunStatus == RunStatusMissedRun {
			found = true
		}
	}
	if !found {
		t.Fatal("t-hourly was not flagged with LastRunStatus=missed-run")
	}

	// Second startup: LastRunAt advanced by the run => nothing to catch up.
	runner.ran = nil
	caught2 := CatchUpMissed(runner, items, now, notifyMissed)
	if len(caught2) != 0 {
		t.Fatalf("second pass caught = %v, want none (repeat runs must not fire)", caught2)
	}
	if len(runner.ran) != 0 {
		t.Fatalf("second pass ran %v, want none", runner.ran)
	}
}

func TestCatchUpDisabledByFlag(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	items := []wconfig.ScheduledTaskType{{
		Id:        "t1",
		Enabled:   true,
		LastRunAt: lastRunAtString(t, now.Add(-1*time.Hour)),
		Schedule:  wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: ivalPtr(10 * 60 * 1000)},
	}}
	// Save + flip the flag so the test restores it afterwards.
	old := CATCHUP_ENABLED
	CATCHUP_ENABLED = false
	defer func() { CATCHUP_ENABLED = old }()
	runner := &fakeTaskRunner{now: now}
	caught := CatchUpMissed(runner, items, now, nil)
	if len(caught) != 0 || len(runner.ran) != 0 {
		t.Fatalf("CATCHUP_ENABLED=false must disable catch-up (caught=%v ran=%v)", caught, runner.ran)
	}
}