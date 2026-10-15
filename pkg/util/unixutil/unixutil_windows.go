// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package unixutil

import (
	"fmt"
	"os"
)

func GetProcessGroupId(pid int) (int, error) {
	return 0, fmt.Errorf("process group id not supported on windows")
}

func ParseSignal(sigName string) os.Signal {
	return nil
}

func GetSignalName(sig os.Signal) string {
	if sig == nil {
		return ""
	}
	return sig.String()
}

func SetCloseOnExec(fd int) {
}

func SignalTerm(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Kill()
}

// this is a no-op on windows
func SignalHup(pid int) error {
	return nil
}

func IsPidRunning(pid int) bool {
	return false
}

func SendSignalByName(pid int, sigName string) error {
	return fmt.Errorf("sending signals is not supported on Windows")
}

// SignalGroupByName is a no-op on Windows; process-group signaling is a unix
// concept. RedrawTUI degrades gracefully to the frontend-only repaint.
func SignalGroupByName(pgid int, sigName string) error {
	return fmt.Errorf("process group signals are not supported on Windows")
}
