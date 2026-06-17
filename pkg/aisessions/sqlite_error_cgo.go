// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build cgo

package aisessions

import (
	"errors"

	"github.com/mattn/go-sqlite3"
)

func isRecoverableSQLiteCorruption(err error) bool {
	var sqliteErr sqlite3.Error
	if !errors.As(err, &sqliteErr) {
		return false
	}
	return sqliteErr.Code == sqlite3.ErrCorrupt || sqliteErr.Code == sqlite3.ErrNotADB
}
