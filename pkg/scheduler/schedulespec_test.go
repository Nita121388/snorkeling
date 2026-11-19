// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import "testing"

func TestParseScheduleSpecCron(t *testing.T) {
	sc, err := ParseScheduleSpec("cron:0 9 * * 1-5")
	if err != nil {
		t.Fatal(err)
	}
	if sc.Type != "cron" || sc.CronExpr != "0 9 * * 1-5" {
		t.Fatalf("got %+v", sc)
	}
	if _, err := ParseScheduleSpec("cron:"); err == nil {
		t.Fatal("empty cron expression must error")
	}
}

func TestParseScheduleSpecInterval(t *testing.T) {
	sc, err := ParseScheduleSpec("every:10m")
	if err != nil {
		t.Fatal(err)
	}
	if sc.Type != "interval" || sc.IntervalMs == nil || *sc.IntervalMs != 10*60*1000 {
		t.Fatalf("got %+v", sc)
	}
	sc, err = ParseScheduleSpec("every:30s")
	if err != nil {
		t.Fatal(err)
	}
	if *sc.IntervalMs != 30*1000 {
		t.Fatalf("every:30s -> %d ms", *sc.IntervalMs)
	}
	sc, err = ParseScheduleSpec("every:2h")
	if err != nil {
		t.Fatal(err)
	}
	if *sc.IntervalMs != 2*3600*1000 {
		t.Fatalf("every:2h -> %d ms", *sc.IntervalMs)
	}
	for _, bad := range []string{"every:", "every:abc", "every:0m", "every:-5m", "every:10x"} {
		if _, err := ParseScheduleSpec(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestParseScheduleSpecOnce(t *testing.T) {
	sc, err := ParseScheduleSpec("once@2026-11-20T09:30:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if sc.Type != "once" || sc.RunAt == nil || *sc.RunAt != "2026-11-20T09:30:00Z" {
		t.Fatalf("got %+v", sc)
	}
	if _, err := ParseScheduleSpec("once@not-a-time"); err == nil {
		t.Fatal("invalid once timestamp must error")
	}
}

func TestParseScheduleSpecDailyWeekly(t *testing.T) {
	sc, err := ParseScheduleSpec("daily@09:30")
	if err != nil {
		t.Fatal(err)
	}
	if sc.Type != "daily" || sc.TimeOfDay != "09:30" {
		t.Fatalf("got %+v", sc)
	}
	sc, err = ParseScheduleSpec("weekly@1@09:30")
	if err != nil {
		t.Fatal(err)
	}
	if sc.Type != "weekly" || sc.DayOfWeek == nil || *sc.DayOfWeek != 1 || sc.TimeOfDay != "09:30" {
		t.Fatalf("got %+v", sc)
	}
	for _, bad := range []string{"daily@25:00", "daily@09:60", "weekly@7@09:30", "weekly@-1@09:30", "weekly@1"} {
		if _, err := ParseScheduleSpec(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestParseScheduleSpecRejectsUnknown(t *testing.T) {
	for _, bad := range []string{"", "hourly:1", "daily", "0 9 * * *"} {
		if _, err := ParseScheduleSpec(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}