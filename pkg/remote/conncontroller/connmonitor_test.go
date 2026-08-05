// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"sync"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestMakeConnMonitorStartsActivityClock(t *testing.T) {
	client := &ssh.Client{}
	conn := &SSHConn{
		lock:          &sync.Mutex{},
		lifecycleLock: &sync.Mutex{},
		Client:        client,
	}
	monitor := MakeConnMonitor(conn, client)
	defer monitor.Close()

	if got := monitor.LastActivityTime.Load(); got == 0 {
		t.Fatal("expected connection monitor activity clock to start at creation")
	}
}
