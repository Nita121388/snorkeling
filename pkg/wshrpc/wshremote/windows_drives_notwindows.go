// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wshremote

import (
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func isWindowsDrivesPath(path string) bool {
	return false
}

func isWindowsDriveRootPath(path string) bool {
	return false
}

func makeWindowsDrivesFileInfo() *wshrpc.FileInfo {
	return nil
}

func listWindowsDriveEntries() []*wshrpc.FileInfo {
	return nil
}

func windowsDriveRootDir(path string) string {
	return filepath.Dir(path)
}
