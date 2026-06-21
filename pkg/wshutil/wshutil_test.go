// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSocketAddressFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snorkeling.sock")
	if err := os.WriteFile(path, []byte("127.0.0.1:49152\n"), 0600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	if got := readSocketAddressFile(path); got != "127.0.0.1:49152" {
		t.Fatalf("unexpected socket address: %q", got)
	}
}

func TestReadSocketAddressFileRejectsNonAddress(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snorkeling.sock")
	if err := os.WriteFile(path, []byte("not-a-socket"), 0600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	if got := readSocketAddressFile(path); got != "" {
		t.Fatalf("expected non-address file to be ignored, got %q", got)
	}
}
