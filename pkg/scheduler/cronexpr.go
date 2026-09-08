// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// NextCronTime computes the next occurrence strictly after 'after' for a 5-field cron expression.
// Fields: minute hour dayOfMonth month dayOfWeek (standard POSIX cron).
// Supported: * , - / and limited weekday 0-6 / mon-sun.
func NextCronTime(expr string, loc *time.Location, after time.Time) (time.Time, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return time.Time{}, fmt.Errorf("cron expression must have 5 fields, got %d", len(fields))
	}
	minutes := expandField(fields[0], 0, 59)
	hours := expandField(fields[1], 0, 23)
	daysOfMonth := expandField(fields[2], 1, 31)
	months := expandField(fields[3], 1, 12)
	daysOfWeek := expandField(fields[4], 0, 6)

	if len(minutes) == 0 || len(hours) == 0 || len(months) == 0 {
		return time.Time{}, fmt.Errorf("cron expression contains empty field")
	}
	// Limit search space to avoid pathological scans.
	cursor := after.In(loc).Add(time.Minute)
	for i := 0; i < 366*24*60; i++ {
		if !setContains(months, int(cursor.Month())) {
			cursor = cursor.Add(time.Minute)
			continue
		}
		if !setContains(daysOfMonth, cursor.Day()) {
			cursor = cursor.Add(time.Minute)
			continue
		}
		if !setContains(daysOfWeek, int(cursor.Weekday())) {
			cursor = cursor.Add(time.Minute)
			continue
		}
		if !setContains(hours, cursor.Hour()) {
			cursor = cursor.Add(time.Minute)
			continue
		}
		if !setContains(minutes, cursor.Minute()) {
			cursor = cursor.Add(time.Minute)
			continue
		}
		return cursor, nil
	}
	return time.Time{}, fmt.Errorf("failed to compute next cron time")
}

func expandField(field string, minVal, maxVal int) []int {
	// Returns unique, sorted integers within [minVal, maxVal].
	if field == "*" {
		return rangeSlice(minVal, maxVal)
	}
	outMap := map[int]struct{}{}
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			stepParts := strings.SplitN(part, "/", 2)
			start := minVal
			if stepParts[0] != "*" {
				start = parseOrMin(stepParts[0], minVal)
			}
			step := parseOrMin(stepParts[1], 1)
			if step <= 0 {
				step = 1
			}
			for v := start; v <= maxVal; v += step {
				outMap[v] = struct{}{}
			}
			continue
		}
		if strings.Contains(part, "-") {
			rng := strings.SplitN(part, "-", 2)
			a := parseOrMin(rng[0], minVal)
			b := parseOrMin(rng[1], maxVal)
			if a > b {
				a, b = b, a
			}
			for v := a; v <= b; v++ {
				outMap[v] = struct{}{}
			}
			continue
		}
		v := parseOrMin(part, minVal)
		outMap[v] = struct{}{}
	}
	out := make([]int, 0, len(outMap))
	for v := range outMap {
		if v >= minVal && v <= maxVal {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		return rangeSlice(minVal, maxVal)
	}
	sortInts(out)
	return out
}

func parseOrMin(s string, def int) int {
	s = strings.TrimSpace(strings.ToLower(s))
	switch s {
	case "sun", "sunday":
		return 0
	case "mon", "monday":
		return 1
	case "tue", "tuesday":
		return 2
	case "wed", "wednesday":
		return 3
	case "thu", "thursday":
		return 4
	case "fri", "friday":
		return 5
	case "sat", "saturday":
		return 6
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func setContains(set []int, v int) bool {
	for _, x := range set {
		if x == v {
			return true
		}
	}
	return false
}

func rangeSlice(a, b int) []int {
	out := make([]int, 0, b-a+1)
	for i := a; i <= b; i++ {
		out = append(out, i)
	}
	return out
}

func sortInts(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
