// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"context"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type TaskRunner interface {
	RunTask(task *wconfig.ScheduledTaskType) *RunResult
}

type RunResult struct {
	TaskId     string
	Status     string // success / error / timeout / cancelled
	Error      string
	DurationMs int64
	Output     string
}

// headlessFlag returns the one-shot/print flag for a given agent binary, when known.
// Unknown agents default to running with the prompt passed as an argument.
func headlessArgs(task *wconfig.ScheduledTaskType, profile wconfig.AgentProfileConfigType) []string {
	agent := task.AgentProfile
	if profile.Cmd != "" {
		agent = profile.Cmd
	}
	var argv []string
	if len(profile.Args) > 0 {
		argv = append(argv, profile.Args...)
	}
	switch agent {
	case "pi":
		argv = append(argv, "--no-extensions")
	case "codex":
		argv = append(argv, "exec", "--skip-git-repo-check")
	case "claude":
		argv = append(argv, "-p")
	case "gemini":
		argv = append(argv, "-p")
	case "opencode":
		argv = append(argv, "run")
	default:
		if len(argv) == 0 {
			argv = append(argv, "-p")
		}
	}
	return argv
}

// DefaultTaskRunner runs a scheduled task headlessly by invoking the agent CLI,
// capturing output, and recording the outcome.
type DefaultTaskRunner struct {
	Store      *RunStore
	UpdateMeta func(taskID string, status string, durationMs int64, errMsg string)
}

func (r *DefaultTaskRunner) RunTask(task *wconfig.ScheduledTaskType) *RunResult {
	start := time.Now()
	res := &RunResult{TaskId: maybeTaskID(task), Status: "error"}
	defer func() {
		res.DurationMs = time.Since(start).Milliseconds()
		if r.Store != nil && task != nil {
			r.Store.RecordRun(res.TaskId, res.Status, res.DurationMs, res.Error, res.Output)
		}
		if r.UpdateMeta != nil && task != nil {
			r.UpdateMeta(res.TaskId, res.Status, res.DurationMs, res.Error)
		}
	}()

	if task == nil {
		res.Error = "nil task"
		return res
	}
	log.Printf("[scheduler] running task id=%s name=%q agent=%s model=%s", task.Id, task.Name, task.AgentProfile, task.Model)

	profile := resolveAgentProfile(task.AgentProfile)
	var cmdBin string
	if task.AgentCmd != nil && *task.AgentCmd != "" {
		cmdBin = *task.AgentCmd
	} else {
		cmdBin = profile.Cmd
	}
	argv := headlessArgs(task, profile)
	if task.Model != "" && profile.ModelFlag != "" {
		argv = append(argv, profile.ModelFlag, task.Model)
	}
	if task.Prompt != "" {
		argv = append(argv, task.Prompt)
	}
	if task.SystemPrompt != nil && *task.SystemPrompt != "" {
		argv = append(argv, *task.SystemPrompt)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, cmdBin, argv...)
	if task.Workdir != "" {
		cmd.Dir = expandHome(task.Workdir)
	}
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	res.Output = string(out)
	if ctx.Err() == context.DeadlineExceeded {
		res.Status = "timeout"
		res.Error = "task timed out after 30m"
		return res
	}
	if err != nil {
		res.Error = err.Error()
		if _, missing := err.(*exec.Error); missing {
			res.Error = "unable to launch agent binary: " + res.Error
		}
		return res
	}
	res.Status = "success"
	return res
}

func maybeTaskID(task *wconfig.ScheduledTaskType) string {
	if task == nil {
		return ""
	}
	return task.Id
}

func resolveAgentProfile(agent string) wconfig.AgentProfileConfigType {
	profiles := map[string]wconfig.AgentProfileConfigType{}
	if fc := wconfig.ReadFullConfig(); fc.Settings.AgentProfiles != nil {
		profiles = fc.Settings.AgentProfiles
	}
	if p, ok := profiles[agent]; ok && p.Cmd != "" {
		return p
	}
	switch agent {
	case "pi":
		return wconfig.AgentProfileConfigType{Cmd: "pi", ModelFlag: "--model"}
	case "codex":
		return wconfig.AgentProfileConfigType{Cmd: "codex", ModelFlag: "--model"}
	case "claude":
		return wconfig.AgentProfileConfigType{Cmd: "claude", ModelFlag: "--model"}
	case "gemini":
		return wconfig.AgentProfileConfigType{Cmd: "gemini", ModelFlag: "--model"}
	case "opencode":
		return wconfig.AgentProfileConfigType{Cmd: "opencode", ModelFlag: "--model"}
	default:
		return wconfig.AgentProfileConfigType{Cmd: agent, ModelFlag: "--model"}
	}
}

func expandHome(p string) string {
	if p == "~" {
		if h, err := os.UserHomeDir(); err == nil {
			return h
		}
	}
	if strings.HasPrefix(p, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			return h + p[1:]
		}
	}
	return p
}
