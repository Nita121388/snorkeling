// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import "fmt"

// Stable error codes shared by the wsh CLI and the MCP facade. Keep these
// strings frozen: agents branch on them.
const (
	CodeUsage       = "E_USAGE"
	CodeNotFound    = "E_NOT_FOUND"
	CodeConflict    = "E_CONFLICT"
	CodeForbidden   = "E_FORBIDDEN"
	CodeUnsupported = "E_UNSUPPORTED"
	CodeNoRoute     = "E_NO_ROUTE"
	CodeTimeout     = "E_TIMEOUT"
	CodeInternal    = "E_INTERNAL"
)

// Error is a typed, agent-readable error. The CLI renders Code/Message/Hint as
// JSON when --json is set and maps Code to a process exit code.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
}

func (e *Error) Error() string {
	if e.Hint == "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Message)
	}
	return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.Hint)
}

func newError(code string, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

func (e *Error) WithHint(hint string) *Error {
	e.Hint = hint
	return e
}
