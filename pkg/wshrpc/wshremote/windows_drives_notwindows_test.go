// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wshremote

import "testing"

func TestWindowsDriveHelpersNoopOutsideWindows(t *testing.T) {
	if isWindowsDrivesPath(WindowsDrivesPath) {
		t.Fatalf("isWindowsDrivesPath(%q) = true, want false outside Windows", WindowsDrivesPath)
	}
	if isWindowsDriveRootPath("C:/") {
		t.Fatalf("isWindowsDriveRootPath(%q) = true, want false outside Windows", "C:/")
	}
	if got := listWindowsDriveEntries(); got != nil {
		t.Fatalf("listWindowsDriveEntries() = %v, want nil outside Windows", got)
	}
}
