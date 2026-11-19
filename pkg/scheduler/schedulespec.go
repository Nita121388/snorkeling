// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// ParseScheduleSpec parses the CLI/MCP `--schedule` shorthand into the
// persisted schedule shape. It is the single parser for every surface so a
// schedule written by `wsh scheduledtask create`, by the MCP create tool and by
// the editor modal is always the same encoding.
//
// Supported forms:
//
//	cron:<expr>            5-field cron (minute hour dom month dow)
//	every:<n>s|m|h         interval (seconds/minutes/hours)
//	once@<RFC3339>         one-shot at an absolute timestamp
//	daily@HH:MM            daily at local time
//	weekly@<0-6>@HH:MM     weekly on a weekday (0=Sunday) at local time
func ParseScheduleSpec(spec string) (wconfig.ScheduledTaskScheduleType, error) {
	sc := wconfig.ScheduledTaskScheduleType{Type: "interval"}
	spec = strings.TrimSpace(spec)
	switch {
	case spec == "":
		return sc, fmt.Errorf("E_USAGE: --schedule is required (cron:<expr> | every:<n>s|m|h | once@<ISO> | daily@HH:MM | weekly@<0-6>@HH:MM)")
	case strings.HasPrefix(spec, "cron:"):
		expr := strings.TrimSpace(strings.TrimPrefix(spec, "cron:"))
		if expr == "" {
			return sc, fmt.Errorf("E_USAGE: cron: requires an expression, e.g. cron:0 9 * * 1-5")
		}
		if _, err := NextCronTime(expr, time.Local, time.Now()); err != nil {
			return sc, fmt.Errorf("E_USAGE: invalid cron expression %q: %v", expr, err)
		}
		sc.Type = "cron"
		sc.CronExpr = expr
		return sc, nil
	case strings.HasPrefix(spec, "every:"):
		ms, err := parseEvery(strings.TrimSpace(strings.TrimPrefix(spec, "every:")))
		if err != nil {
			return sc, err
		}
		sc.Type = "interval"
		sc.IntervalMs = &ms
		return sc, nil
	case strings.HasPrefix(spec, "once@"):
		iso := strings.TrimSpace(strings.TrimPrefix(spec, "once@"))
		if _, err := time.Parse(time.RFC3339, iso); err != nil {
			return sc, fmt.Errorf("E_USAGE: once@ requires an RFC3339 timestamp, got %q", iso)
		}
		sc.Type = "once"
		sc.RunAt = &iso
		return sc, nil
	case strings.HasPrefix(spec, "daily@"):
		tod := strings.TrimSpace(strings.TrimPrefix(spec, "daily@"))
		if err := validateHHMM(tod); err != nil {
			return sc, err
		}
		sc.Type = "daily"
		sc.TimeOfDay = tod
		return sc, nil
	case strings.HasPrefix(spec, "weekly@"):
		parts := strings.Split(strings.TrimPrefix(spec, "weekly@"), "@")
		if len(parts) != 2 {
			return sc, fmt.Errorf("E_USAGE: weekly@ requires weekly@<0-6>@HH:MM (e.g. weekly@1@09:30)")
		}
		wd, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil || wd < 0 || wd > 6 {
			return sc, fmt.Errorf("E_USAGE: weekly@ weekday must be 0-6 (0=Sun), got %q", strings.TrimSpace(parts[0]))
		}
		tod := strings.TrimSpace(parts[1])
		if err := validateHHMM(tod); err != nil {
			return sc, err
		}
		sc.Type = "weekly"
		sc.DayOfWeek = &wd
		sc.TimeOfDay = tod
		return sc, nil
	}
	return sc, fmt.Errorf("E_USAGE: invalid --schedule %q (must start with cron:, every:, once@, daily@ or weekly@)", spec)
}

// parseEvery converts every:<n>s|m|h into milliseconds.
func parseEvery(raw string) (int64, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) < 2 {
		return 0, fmt.Errorf("E_USAGE: every: requires a duration like 5m or 30s, got %q", raw)
	}
	unit := raw[len(raw)-1]
	n, err := strconv.ParseInt(strings.TrimSpace(raw[:len(raw)-1]), 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("E_USAGE: every: invalid duration %q (want <n>s|m|h)", raw)
	}
	switch unit {
	case 's':
		return n * 1000, nil
	case 'm':
		return n * 60 * 1000, nil
	case 'h':
		return n * 3600 * 1000, nil
	}
	return 0, fmt.Errorf("E_USAGE: every: unit must be s/m/h, got %q", raw)
}

// validateHHMM enforces strict HH:MM (24h local time).
func validateHHMM(raw string) error {
	s := strings.TrimSpace(raw)
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return fmt.Errorf("E_USAGE: time must be HH:MM (24h), got %q", s)
	}
	h, errH := strconv.Atoi(parts[0])
	m, errM := strconv.Atoi(parts[1])
	if errH != nil || errM != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return fmt.Errorf("E_USAGE: time must be HH:MM (24h), got %q", s)
	}
	return nil
}