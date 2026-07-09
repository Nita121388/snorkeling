// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppendExistingPathDirs(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first")
	second := filepath.Join(dir, "second")
	missing := filepath.Join(dir, "missing")
	if err := os.Mkdir(first, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(second, 0o755); err != nil {
		t.Fatal(err)
	}

	pathValue := strings.Join([]string{"/usr/bin", first, "/bin", first}, string(os.PathListSeparator))
	got := appendExistingPathDirs(pathValue, []string{first, missing, second})
	want := strings.Join([]string{"/usr/bin", first, "/bin", second}, string(os.PathListSeparator))
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
