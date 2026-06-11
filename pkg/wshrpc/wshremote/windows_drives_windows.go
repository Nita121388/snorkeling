// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wshremote

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func isWindowsDrivesPath(path string) bool {
	path = strings.ReplaceAll(path, `\`, "/")
	return path == WindowsDrivesPath || path == WindowsDrivesPath[1:]
}

func isWindowsDriveRootPath(path string) bool {
	if len(path) != 2 && len(path) != 3 {
		return false
	}
	if path[1] != ':' {
		return false
	}
	driveLetter := path[0]
	if (driveLetter < 'A' || driveLetter > 'Z') && (driveLetter < 'a' || driveLetter > 'z') {
		return false
	}
	return len(path) == 2 || path[2] == '/' || path[2] == '\\'
}

func makeWindowsDrivesFileInfo() *wshrpc.FileInfo {
	return &wshrpc.FileInfo{
		Path:          WindowsDrivesPath,
		Dir:           WindowsDrivesPath,
		Name:          WindowsDrivesDisplayName,
		Size:          -1,
		Mode:          os.ModeDir | 0755,
		ModeStr:       (os.ModeDir | 0755).String(),
		ModTime:       time.Now().UnixMilli(),
		IsDir:         true,
		MimeType:      "directory",
		ReadOnly:      true,
		SupportsMkdir: false,
	}
}

func listWindowsDriveEntries() []*wshrpc.FileInfo {
	var entries []*wshrpc.FileInfo
	now := time.Now().UnixMilli()
	mode := os.ModeDir | 0755
	for driveLetter := 'A'; driveLetter <= 'Z'; driveLetter++ {
		path := string(driveLetter) + ":/"
		if _, err := os.Stat(path); err != nil {
			continue
		}
		entries = append(entries, &wshrpc.FileInfo{
			Path:          path,
			Dir:           WindowsDrivesPath,
			Name:          string(driveLetter) + ":",
			Size:          -1,
			Mode:          mode,
			ModeStr:       mode.String(),
			ModTime:       now,
			IsDir:         true,
			MimeType:      "directory",
			SupportsMkdir: false,
		})
	}
	return entries
}

func windowsDriveRootDir(path string) string {
	if isWindowsDriveRootPath(path) {
		return WindowsDrivesPath
	}
	return filepath.ToSlash(filepath.Dir(path))
}
