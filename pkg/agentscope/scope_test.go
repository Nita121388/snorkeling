// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentscope

import "testing"

func TestAllows(t *testing.T) {
	cases := []struct {
		granted  []string
		required string
		want     bool
	}{
		{nil, Data, true},                       // app-level token: unrestricted
		{[]string{Observe}, Observe, true},
		{[]string{Observe}, Navigate, false},
		{[]string{Observe, Navigate}, Data, false},
		{[]string{Data}, Navigate, true},        // higher grants lower
		{[]string{Destructive}, Data, true},
		{[]string{Data}, Launch, false},         // data cannot start a process
		{[]string{Launch}, Data, true},          // launch grants the levels below it
		{[]string{Destructive}, Launch, true},   // destructive still covers launch
		{[]string{Launch}, Destructive, false},
		{[]string{Observe}, "bogus", false},     // unknown requirement never passes
		{[]string{"bogus"}, Observe, false},     // unknown grant grants nothing
	}
	for _, tc := range cases {
		if got := Allows(tc.granted, tc.required); got != tc.want {
			t.Fatalf("Allows(%v, %q) = %v, want %v", tc.granted, tc.required, got, tc.want)
		}
	}
}

func TestRequiredForCommand(t *testing.T) {
	cases := map[string]string{
		"uiactive":       Observe,
		"uistate":        Observe,
		"blockread":      Observe,
		"sessionlive":    Observe,
		"sessioninfo":    Observe,
		"sessionusers":   Observe,
		"sessionturns":   Observe,
		"sessionturn":    Observe,
		"tablist":        Observe,
		"agentcardget":   Observe,
		"blockopen":      Navigate,
		"tabcreate":      Navigate,
		"tabactivate":    Navigate,
		"agentcardset":   Data,
		"agentlaunch":    Launch,
		"agentsend":      Launch,
	}
	for cmd, want := range cases {
		got, ok := RequiredForCommand(cmd)
		if !ok {
			t.Fatalf("command %q must have a scope", cmd)
		}
		if got != want {
			t.Fatalf("command %q scope = %q, want %q", cmd, got, want)
		}
	}
	// a write must never be classified as observe/navigate
	if scope, _ := RequiredForCommand("agentcardset"); scope == Observe || scope == Navigate {
		t.Fatal("agentcardset must require data")
	}
	if _, ok := RequiredForCommand("createblock"); ok {
		t.Fatal("createblock is not part of the external surface")
	}
	// launching an agent must be stronger than writing card data, and weaker
	// than destructive: it creates a real process the user has to see.
	if scope, _ := RequiredForCommand("agentlaunch"); scope != Launch {
		t.Fatalf("agentlaunch scope = %q, want %q", scope, Launch)
	}
	launchScope, _ := RequiredForCommand("agentlaunch")
	if !Allows([]string{Launch}, launchScope) || Allows([]string{Data}, launchScope) {
		t.Fatal("agentlaunch must accept launch and reject data")
	}
	sendScope, _ := RequiredForCommand("agentsend")
	if sendScope != Launch {
		t.Fatalf("agentsend scope = %q, want %q (create and talk to an agent are the same level)", sendScope, Launch)
	}
}
