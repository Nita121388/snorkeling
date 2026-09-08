package scheduler

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestNextCronTime(t *testing.T) {
	loc := time.FixedZone("UTC", 0)
	after := time.Date(2026, 3, 19, 8, 30, 0, 0, loc)
	next, err := NextCronTime("0 9 * * 1-5", loc, after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 3, 19, 9, 0, 0, 0, loc)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}
}

func TestNextCronTimeWeekendRollover(t *testing.T) {
	loc := time.FixedZone("UTC", 0)
	after := time.Date(2026, 3, 20, 16, 0, 0, 0, loc) // Friday
	next, err := NextCronTime("0 9 * * 1-5", loc, after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 3, 23, 9, 0, 0, 0, loc) // Monday
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}
}

func TestNextCronTimeRejectsInvalidFieldCount(t *testing.T) {
	_, err := NextCronTime("0 9 * *", time.UTC, time.Now())
	if err == nil {
		t.Fatal("expected invalid cron expression error")
	}
}

func TestNextCronInterval(t *testing.T) {
	loc := time.FixedZone("UTC", 0)
	ms := int64(3600000) // 1h
	task := &wconfig.ScheduledTaskType{
		Schedule: wconfig.ScheduledTaskScheduleType{Type: "interval", IntervalMs: &ms, Timezone: "UTC"},
	}
	s := NewInProcessScheduler(nil)
	now := time.Now().In(loc)
	next := s.GetNextRunTime(task)
	if !next.After(now) {
		t.Fatalf("interval next run should be in future, got %s", next)
	}
}

func TestGetNextRunTimeDaily(t *testing.T) {
	loc := time.FixedZone("UTC", 0)
	// freezegun: construct task with a timeOfDay, verify next daily is later today or tomorrow
	task := &wconfig.ScheduledTaskType{
		Schedule: wconfig.ScheduledTaskScheduleType{Type: "daily", TimeOfDay: "09:00", Timezone: "UTC"},
	}
	s := NewInProcessScheduler(nil)
	now := time.Now().In(loc)
	next := s.GetNextRunTime(task)
	if !next.After(now) {
		t.Fatalf("daily next run should be in future, got %s", next)
	}
}
