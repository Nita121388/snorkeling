// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !cgo

package aisessions

func isRecoverableSQLiteCorruption(err error) bool {
	return false
}
