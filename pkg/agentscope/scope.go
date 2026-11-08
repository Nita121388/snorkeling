// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentscope is the single source of truth for what an external agent
// token may do. Design §10.5.3: observe < navigate < data < destructive.
//
// It lives in its own package because both the RPC transport (pkg/wshutil) and
// the capability facades (pkg/agentcontrol, pkg/agentmcp) must agree, and
// pkg/wshutil cannot import pkg/agentcontrol without creating a cycle.
package agentscope

// Scope levels, ordered from least to most powerful.
const (
	Observe     = "observe"
	Navigate    = "navigate"
	Data        = "data"
	Destructive = "destructive"
)

var rank = map[string]int{
	Observe:     1,
	Navigate:    2,
	Data:        3,
	Destructive: 4,
}

// Known reports whether name is a valid scope level.
func Known(name string) bool {
	_, ok := rank[name]
	return ok
}

// Allows reports whether the granted scopes satisfy required. An empty grant
// means an app-level (in-app) token, which is deliberately not scope-limited:
// in-app agents already run with the user's own credentials.
func Allows(granted []string, required string) bool {
	if len(granted) == 0 {
		return true
	}
	need, ok := rank[required]
	if !ok {
		// An unknown requirement must never silently pass.
		return false
	}
	for _, g := range granted {
		if rank[g] >= need {
			return true
		}
	}
	return false
}

// commandScopes maps an ACS wsh command name to the minimum scope it needs.
// Commands absent from this map are not exposed to external agents at all
// (the transport layer only enforces the entries listed here; anything else is
// reachable only through an app-level token).
var commandScopes = map[string]string{
	"sessionlive":    Observe,
	"sessionget":     Observe,
	"sessionlist":    Observe,
	"sessionforblock": Observe,
	"agentcardget":   Observe,
	"uiactive":       Observe,
	"uistate":        Observe,
	"blockread":      Observe,
	"tablist":        Observe,

	"blockopen":    Navigate,
	"tabcreate":    Navigate,
	"tabactivate":  Navigate,

	"agentcardset": Data,
}

// RequiredForCommand returns the minimum scope for an ACS command.
func RequiredForCommand(command string) (string, bool) {
	scope, ok := commandScopes[command]
	return scope, ok
}
