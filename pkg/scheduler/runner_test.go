// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func testProfile() agentcatalog.ProfileInfo {
	return agentcatalog.ProfileInfo{
		Name:         "pi",
		Cmd:          "pi",
		ModelFlag:    "--model",
		DefaultModel: "deepseek-v4-pro",
		Models: []agentcatalog.ModelInfo{
			{Id: "deepseek-v4-pro", Default: true},
			{Id: "gpt-5"},
		},
	}
}

func TestResolveTaskModelUsesCatalogDefault(t *testing.T) {
	task := &wconfig.ScheduledTaskType{Id: "t1", AgentProfile: "pi"}
	if got := resolveTaskModel(task, testProfile()); got != "deepseek-v4-pro" {
		t.Fatalf("model = %q, want catalog default", got)
	}
}

func TestResolveTaskModelKeepsExplicitValue(t *testing.T) {
	task := &wconfig.ScheduledTaskType{Id: "t1", AgentProfile: "pi", Model: "gpt-5"}
	if got := resolveTaskModel(task, testProfile()); got != "gpt-5" {
		t.Fatalf("model = %q, want explicit gpt-5", got)
	}
}

func TestResolveTaskModelKeepsUnknownValue(t *testing.T) {
	task := &wconfig.ScheduledTaskType{Id: "t1", AgentProfile: "pi", Model: "brand-new-model"}
	if got := resolveTaskModel(task, testProfile()); got != "brand-new-model" {
		t.Fatalf("model = %q, want brand-new-model", got)
	}
}

func TestModelInCatalog(t *testing.T) {
	profile := testProfile()
	if !modelInCatalog(profile, "gpt-5") {
		t.Fatal("gpt-5 should be in catalog")
	}
	if modelInCatalog(profile, "missing") {
		t.Fatal("missing should not be in catalog")
	}
}
