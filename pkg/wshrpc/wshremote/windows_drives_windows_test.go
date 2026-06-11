// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wshremote

import "testing"

func TestWindowsDrivesPathRecognition(t *testing.T) {
	tests := []string{
		WindowsDrivesPath,
		WindowsDrivesPath[1:],
		`\__wave_windows_drives__`,
	}
	for _, test := range tests {
		if !isWindowsDrivesPath(test) {
			t.Fatalf("isWindowsDrivesPath(%q) = false, want true", test)
		}
	}
}

func TestWindowsDriveRootPathRecognition(t *testing.T) {
	trueTests := []string{"C:", "C:/", `C:\`, "d:/"}
	for _, test := range trueTests {
		if !isWindowsDriveRootPath(test) {
			t.Fatalf("isWindowsDriveRootPath(%q) = false, want true", test)
		}
	}

	falseTests := []string{"C:/Users", "/tmp", "not-drive", "1:/"}
	for _, test := range falseTests {
		if isWindowsDriveRootPath(test) {
			t.Fatalf("isWindowsDriveRootPath(%q) = true, want false", test)
		}
	}
}

func TestWindowsDriveRootDir(t *testing.T) {
	if got := windowsDriveRootDir("C:/"); got != WindowsDrivesPath {
		t.Fatalf("windowsDriveRootDir(%q) = %q, want %q", "C:/", got, WindowsDrivesPath)
	}
}
