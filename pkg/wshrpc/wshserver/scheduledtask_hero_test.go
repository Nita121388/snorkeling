// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/scheduler"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// makeTestHeroRoot creates a temp hero root with one hero "tester"
// (<root>/tester/.hero/hero.json + CHARTER.md) and returns the root.
func makeTestHeroRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	heroDir := filepath.Join(root, "tester", ".hero")
	if err := os.MkdirAll(heroDir, 0o755); err != nil {
		t.Fatalf("creating hero dir: %v", err)
	}
	heroJSON := map[string]any{
		"schemaVersion": 1,
		"id":            "tester",
		"name":          "Tester",
		"emoji":         "🧪",
		"role":          "qa",
		"provider":      "pi",
		"model":         "deepseek-v4-pro",
		"createdAt":     "2026-11-23T00:00:00Z",
	}
	barr, err := json.Marshal(heroJSON)
	if err != nil {
		t.Fatalf("marshaling hero.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(heroDir, "hero.json"), barr, 0o644); err != nil {
		t.Fatalf("writing hero.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(heroDir, "CHARTER.md"), []byte("# charter\n"), 0o644); err != nil {
		t.Fatalf("writing CHARTER.md: %v", err)
	}
	t.Setenv("HERO_ROOT", root)
	return root
}

func TestScheduledTaskHeroDefaults(t *testing.T) {
	root := makeTestHeroRoot(t)
	heroHome := filepath.Join(root, "tester")

	// hero field -> workdir defaults to the hero home; provider/model default
	// to the hero.json declarations; hero name is the display label.
	exec := scheduler.ResolveTaskExecution(&wconfig.ScheduledTaskType{Id: "t1", Hero: "tester"})
	if exec.Workdir != heroHome {
		t.Errorf("workdir = %q, want hero home %q", exec.Workdir, heroHome)
	}
	if exec.AgentProfile != "pi" {
		t.Errorf("agentProfile = %q, want hero provider %q", exec.AgentProfile, "pi")
	}
	if exec.Model != "deepseek-v4-pro" {
		t.Errorf("model = %q, want hero model %q", exec.Model, "deepseek-v4-pro")
	}
	if exec.HeroID != "tester" {
		t.Errorf("heroID = %q, want %q", exec.HeroID, "tester")
	}
	if exec.HeroName != "Tester" {
		t.Errorf("heroName = %q, want %q", exec.HeroName, "Tester")
	}

	// explicit task values win over hero.json (empty string counts as unset)
	explicit := scheduler.ResolveTaskExecution(&wconfig.ScheduledTaskType{
		Id:           "t2",
		Hero:         "tester",
		Workdir:      "/explicit/dir",
		AgentProfile: "codex",
		Model:        "gpt-5",
	})
	if explicit.Workdir != "/explicit/dir" {
		t.Errorf("explicit workdir = %q, want /explicit/dir", explicit.Workdir)
	}
	if explicit.AgentProfile != "codex" {
		t.Errorf("explicit agentProfile = %q, want codex", explicit.AgentProfile)
	}
	if explicit.Model != "gpt-5" {
		t.Errorf("explicit model = %q, want gpt-5", explicit.Model)
	}

	// missing hero id falls back to the task defaults without error
	missing := scheduler.ResolveTaskExecution(&wconfig.ScheduledTaskType{Id: "t3", Hero: "ghost", Workdir: "/w", AgentProfile: "pi", Model: "gpt-5"})
	if missing.Workdir != "/w" || missing.AgentProfile != "pi" || missing.Model != "gpt-5" {
		t.Errorf("missing hero should keep task defaults, got %+v", missing)
	}
	if missing.HeroName != "" {
		t.Errorf("missing hero should have empty HeroName, got %q", missing.HeroName)
	}

	// legacy task without hero is byte-level untouched (no derivation kicks in)
	legacy := scheduler.ResolveTaskExecution(&wconfig.ScheduledTaskType{Id: "t4", AgentProfile: "pi", Model: "gpt-5", Workdir: "/w"})
	if legacy.Workdir != "/w" || legacy.AgentProfile != "pi" || legacy.Model != "gpt-5" || legacy.HeroID != "" || legacy.HeroName != "" {
		t.Errorf("legacy task should pass through unchanged, got %+v", legacy)
	}
	legacyBytes, err := json.Marshal(&wconfig.ScheduledTaskType{Id: "t4", Name: "n", Enabled: true, Prompt: "p"})
	if err != nil {
		t.Fatalf("marshaling legacy task: %v", err)
	}
	if strings.Contains(string(legacyBytes), `"hero"`) {
		t.Errorf("legacy task JSON must not contain a hero field, got %s", legacyBytes)
	}
	var roundTrip wconfig.ScheduledTaskType
	if err := json.Unmarshal(legacyBytes, &roundTrip); err != nil {
		t.Fatalf("unmarshaling legacy task: %v", err)
	}
	if roundTrip.Hero != "" {
		t.Errorf("unmarshaled legacy task Hero = %q, want empty", roundTrip.Hero)
	}

	// settings.json byte-level invariance for pre-hero task arrays: an old
	// items list survives an unmarshal/re-marshal round trip unchanged.
	legacySettings := `[{"id":"a","name":"n","enabled":true,"prompt":"p","schedule":{"type":"daily","timeOfDay":"09:00"}}]`
	var items []wconfig.ScheduledTaskType
	if err := json.Unmarshal([]byte(legacySettings), &items); err != nil {
		t.Fatalf("unmarshaling legacy settings: %v", err)
	}
	remarshaled, err := json.Marshal(items)
	if err != nil {
		t.Fatalf("re-marshaling legacy settings: %v", err)
	}
	if string(remarshaled) != legacySettings {
		t.Errorf("legacy settings round trip changed bytes:\n got %s\nwant %s", remarshaled, legacySettings)
	}
}

func TestScheduledTaskHeroBlockMeta(t *testing.T) {
	root := makeTestHeroRoot(t)
	heroHome := filepath.Join(root, "tester")

	task := &wconfig.ScheduledTaskType{Id: "t1", Mode: "block", Hero: "tester", Prompt: "hi", Tab: "new"}
	exec := scheduler.ResolveTaskExecution(task)
	req := blockLaunchRequest(task, exec)
	patch := heroBlockMetaPatch(exec)

	if req.Cwd != heroHome {
		t.Errorf("block launch cwd = %q, want hero home %q", req.Cwd, heroHome)
	}
	if req.Profile != "pi" {
		t.Errorf("block launch profile = %q, want hero provider pi", req.Profile)
	}
	if req.Model != "deepseek-v4-pro" {
		t.Errorf("block launch model = %q, want hero model deepseek-v4-pro", req.Model)
	}
	if patch == nil {
		t.Fatal("hero task must produce a block meta patch")
	}
	if got := patch[scheduler.HeroMetaKey]; got != "tester" {
		t.Errorf("block meta[%q] = %v, want tester", scheduler.HeroMetaKey, got)
	}
	if got := patch[scheduler.HeroNameMetaKey]; got != "Tester" {
		t.Errorf("block meta[%q] = %v, want Tester", scheduler.HeroNameMetaKey, got)
	}
	if strings.TrimSpace(patch.GetString(scheduler.HeroNameMetaKey, "")) == "" {
		t.Error("hero:name must be non-empty")
	}

	// a task without a hero gets no hero meta patch and its own workdir
	plainTask := &wconfig.ScheduledTaskType{Id: "t2", Mode: "block", Prompt: "hi", Workdir: "/plain", AgentProfile: "pi", Model: "gpt-5"}
	plainExec := scheduler.ResolveTaskExecution(plainTask)
	plainReq := blockLaunchRequest(plainTask, plainExec)
	if plainReq.Cwd != "/plain" {
		t.Errorf("plain task cwd = %q, want /plain", plainReq.Cwd)
	}
	if heroBlockMetaPatch(plainExec) != nil {
		t.Error("task without hero must not produce a hero meta patch")
	}
}

func TestScheduledTaskHeroHeadlessCwd(t *testing.T) {
	root := makeTestHeroRoot(t)
	heroHome := filepath.Join(root, "tester")

	// isolate the run-record dir under a temp HOME
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home) // windows parity, harmless elsewhere
	logDir := filepath.Join(home, ".snorkeling", "scheduledtask-runs")

	// a tiny agent "binary" that prints its physical cwd and exits 0
	script := filepath.Join(heroHome, "printcwd.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexec /bin/pwd\n"), 0o755); err != nil {
		t.Fatalf("writing agent script: %v", err)
	}

	countRunLogs := func() int {
		entries, err := os.ReadDir(logDir)
		if err != nil {
			return 0
		}
		n := 0
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".log") {
				n++
			}
		}
		return n
	}
	before := countRunLogs()

	cmd := script
	task := &wconfig.ScheduledTaskType{
		Id:        "t1",
		Name:      "hero run",
		Mode:      "",
		Hero:      "tester",
		Prompt:    "go",
		AgentCmd:  &cmd,
		CreatedAt: "2026-11-23T00:00:00Z",
	}
	runner := &scheduler.DefaultTaskRunner{}
	res := runner.RunTask(task)
	if res.Status != scheduler.RunStatusSuccess {
		t.Fatalf("run status = %q, err = %q, output = %q", res.Status, res.Error, res.Output)
	}

	// headless cwd must be the hero home (physical path comparison)
	want, err := filepath.EvalSymlinks(heroHome)
	if err != nil {
		t.Fatalf("resolving hero home symlinks: %v", err)
	}
	got := strings.TrimSpace(res.Output)
	if got != want {
		t.Errorf("headless cwd = %q, want hero home %q", got, want)
	}

	// exactly one new run record under ~/.snorkeling/scheduledtask-runs/
	after := countRunLogs()
	if after != before+1 {
		t.Errorf("run log count = %d, want %d (one new record)", after, before+1)
	}
	if res.OutputPath == "" || !strings.HasPrefix(res.OutputPath, logDir) {
		t.Errorf("outputPath = %q, want under %q", res.OutputPath, logDir)
	}
}
