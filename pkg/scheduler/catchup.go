// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// CATCHUP_ENABLED gates the startup catch-up pass. When false, missed runs are
// simply not executed (the app only schedules from now on). A var so it can be
// toggled without recompiling and unit-tested; default true (roll back by
// flipping it to false).
var CATCHUP_ENABLED = true

// RunStatusMissedRun is the LastRunStatus written after a catch-up run, so a
// reader can tell "fired by startup catch-up" apart from a normal success/error.
const RunStatusMissedRun = "missed-run"

// FindMissedOccurrence computes the most recent schedule occurrence that
// elapsed before `now` without a run (task.LastRunAt is older than the
// occurrence). Returns the zero time when nothing was missed, the task is
// disabled, or the task never ran (no LastRunAt: nothing to catch up on).
//
// Catch-up deliberately anchors on LastRunAt, never on creation time, so the
// "advance LastRunAt to now" step is what stops a task from re-firing on every
// start (A9: run once, then never again).
func FindMissedOccurrence(task *wconfig.ScheduledTaskType, now time.Time) time.Time {
	if task == nil || !task.Enabled || task.LastRunAt == nil {
		return time.Time{}
	}
	loc := loadLocation(task.Schedule.Timezone)
	last, err := time.Parse(time.RFC3339, *task.LastRunAt)
	if err != nil {
		return time.Time{}
	}
	if !last.Before(now) {
		return time.Time{}
	}
	switch task.Schedule.Type {
	case "cron":
		next, err := NextCronTime(task.Schedule.CronExpr, loc, last)
		if err != nil {
			return time.Time{}
		}
		if next.After(last) && !next.After(now) {
			return next
		}
	case "interval":
		if task.Schedule.IntervalMs != nil && *task.Schedule.IntervalMs > 0 {
			next := last.Add(time.Duration(*task.Schedule.IntervalMs) * time.Millisecond)
			if !next.After(now) {
				return next
			}
		}
	case "daily", "weekly":
		next := nextDailyWeekly(task, loc, last)
		if !next.IsZero() && next.After(last) && !next.After(now) {
			return next
		}
	case "once":
		if task.Schedule.RunAt != nil {
			t, err := time.Parse(time.RFC3339, *task.Schedule.RunAt)
			if err == nil && t.After(last) && !t.After(now) {
				return t
			}
		}
	}
	return time.Time{}
}

// CatchUpMissed runs, serially (one at a time, no concurrency), every enabled
// task that missed its last scheduled occurrence while the app was off. Each
// missed task runs exactly once and no status guard prevents the real runner's
// own meta update (LastRunAt advances); markMissed is then invoked so the
// caller can persist LastRunStatus=missed-run on top of the run's own status.
//
// Returns the ids that were caught up. runner may be nil (dry inspection);
// markMissed may be nil.
func CatchUpMissed(runner TaskRunner, items []wconfig.ScheduledTaskType, now time.Time, markMissed func(taskID string)) []string {
	if !CATCHUP_ENABLED {
		return nil
	}
	var caught []string
	for i := range items {
		t := &items[i]
		missed := FindMissedOccurrence(t, now)
		if missed.IsZero() {
			continue
		}
		log.Printf("[scheduler] catch-up: task id=%s name=%q missed occurrence %s; running once", t.Id, t.Name, missed.Format(time.RFC3339))
		if runner != nil {
			runner.RunTask(t)
		}
		if markMissed != nil {
			markMissed(t.Id)
		}
		caught = append(caught, t.Id)
	}
	return caught
}