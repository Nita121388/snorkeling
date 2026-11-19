// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestScheduleDescribe(t *testing.T) {
	ival := int64(10 * 60 * 1000)
	wd := 1
	runAt := "2026-11-20T09:30:00Z"
	cases := []struct {
		name string
		in   wconfig.ScheduledTaskType
		want string
	}{
		{"cron", wconfig.ScheduledTaskType{Schedule: wconfig.ScheduledTaskScheduleType{Type: "cron", CronExpr: "0 9 * * 1-5"}}, "cron:0 9 * * 1-5"},
		{"interval", wconfig.ScheduledTaskType{Schedule: wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: &ival}}, "every:600000ms"},
		{"once", wconfig.ScheduledTaskType{Schedule: wconfig.ScheduledTaskScheduleType{Type: "once", RunAt: &runAt}}, "once@2026-11-20T09:30:00Z"},
		{"daily", wconfig.ScheduledTaskType{Schedule: wconfig.ScheduledTaskScheduleType{Type: "daily", TimeOfDay: "09:30"}}, "daily@09:30"},
		{"weekly", wconfig.ScheduledTaskType{Schedule: wconfig.ScheduledTaskScheduleType{Type: "weekly", DayOfWeek: &wd, TimeOfDay: "09:30"}}, "weekly@1@09:30"},
	}
	for _, c := range cases {
		if got := scheduleDescribe(c.in); got != c.want {
			t.Fatalf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestDerefStr(t *testing.T) {
	s := "x"
	if derefStr(&s) != "x" {
		t.Fatal("derefStr(&\"x\") != x")
	}
	if derefStr(nil) != "" {
		t.Fatal("derefStr(nil) != empty")
	}
}