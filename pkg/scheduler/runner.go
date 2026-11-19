// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scheduler

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type TaskRunner interface {
	RunTask(task *wconfig.ScheduledTaskType) *RunResult
}

// Run statuses. LastRunStatus on the persisted task may additionally carry
// "missed-run" set by the startup catch-up pass (catchup.go).
const (
	RunStatusSuccess   = "success"
	RunStatusError     = "error"
	RunStatusTimeout   = "timeout"
	RunStatusCancelled = "cancelled"
)

type RunResult struct {
	TaskId     string
	Status     string // success / error / timeout / cancelled
	Error      string
	DurationMs int64
	Output     string
	// OutputPath is the log file for headless runs
	// (~/.snorkeling/scheduledtask-runs/<taskid|adhoc>-<ts>.log). Empty for
	// block-mode runs, whose record lives in the created agent block.
	OutputPath string
	// ExitCode is the agent CLI process exit code; 0 on success, -1 unset.
	ExitCode int
}

// headlessArgs returns the one-shot/print flag for a given agent binary, when known.
// Unknown agents default to running with the prompt passed as an argument.
//
// This is the SINGLE parameter table for one-shot headless runs: the scheduled
// task runner, `wsh agent launch --headless` and any future surface all build
// argv from it, so the argument mapping cannot drift between surfaces.
func HeadlessArgs(task *wconfig.ScheduledTaskType, profile agentcatalog.ProfileInfo) []string {
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

// CanonicalizeModelArg expands a bare model id into provider/id using the
// single launch-path mapping (wshserver.canonicalizeModelArg, wired by
// InitScheduledTasks). It exists because pi refuses a bare id that is
// authenticated under several providers ("ambiguous across providers"), and
// the catalog already knows which provider the entry belongs to. The default
// is identity so the package stays testable without wshserver.
var CanonicalizeModelArg = func(profile agentcatalog.ProfileInfo, model string) string {
	return model
}

// DefaultTaskRunner runs a scheduled task either headlessly (invoking the
// agent CLI once, capturing output into a log file) or by creating an agent
// block (Mode=block), and records the outcome.
type DefaultTaskRunner struct {
	Store      *RunStore
	UpdateMeta func(taskID string, status string, durationMs int64, errMsg string)
	// LaunchBlock is how Mode=block tasks create the agent block and deliver
	// the prompt. It is injected by wshserver.InitScheduledTasks so the runner
	// does not depend on the RPC layer; nil means block mode is unavailable.
	LaunchBlock func(task *wconfig.ScheduledTaskType) error
}

func (r *DefaultTaskRunner) RunTask(task *wconfig.ScheduledTaskType) *RunResult {
	start := time.Now()
	res := &RunResult{TaskId: maybeTaskID(task), Status: RunStatusError, ExitCode: -1}
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

	switch strings.ToLower(strings.TrimSpace(task.Mode)) {
	case "", "headless":
		res = RunHeadlessOnce(task, task.Id)
	case "block":
		res = r.runBlock(task)
	default:
		res.Error = fmt.Sprintf("E_USAGE: unknown task mode %q (want headless or block)", task.Mode)
	}
	return res
}

// runBlock executes a Mode=block task: create the agent block (validating
// profile/model first, so a failure never leaves a half-initialized block)
// and deliver the prompt through its TUI.
func (r *DefaultTaskRunner) runBlock(task *wconfig.ScheduledTaskType) *RunResult {
	res := &RunResult{TaskId: maybeTaskID(task), Status: RunStatusError, ExitCode: -1}
	if r.LaunchBlock == nil {
		res.Error = "block launcher not configured (scheduler started without wshserver)"
		return res
	}
	if err := r.LaunchBlock(task); err != nil {
		res.Error = err.Error()
		return res
	}
	res.Status = RunStatusSuccess
	res.Output = "agent block created and prompt delivered"
	return res
}

// RunHeadlessOnce executes the agent CLI exactly once with the shared
// HeadlessArgs table and writes the combined output to
// ~/.snorkeling/scheduledtask-runs/<label>-<ts>.log. It is used both by
// scheduled tasks (label = task id) and by `wsh agent launch --headless`
// (label = "adhoc"); it never records into the store nor updates task meta.
func RunHeadlessOnce(task *wconfig.ScheduledTaskType, label string) *RunResult {
	start := time.Now()
	res := &RunResult{TaskId: maybeTaskID(task), Status: RunStatusError, ExitCode: -1}
	defer func() {
		res.DurationMs = time.Since(start).Milliseconds()
	}()
	if task == nil {
		res.Error = "nil task"
		return res
	}
	log.Printf("[scheduler] headless run task id=%s label=%s agent=%s model=%s", task.Id, label, task.AgentProfile, task.Model)

	profile := agentcatalog.Resolve(task.AgentProfile)
	model := resolveTaskModel(task, profile)
	model = CanonicalizeModelArg(profile, model)
	var cmdBin string
	if task.AgentCmd != nil && *task.AgentCmd != "" {
		cmdBin = *task.AgentCmd
	} else {
		cmdBin = profile.Cmd
	}
	argv := HeadlessArgs(task, profile)
	if model != "" && profile.ModelFlag != "" {
		argv = append(argv, profile.ModelFlag, model)
	}
	if task.Prompt != "" {
		argv = append(argv, task.Prompt)
	}
	if task.SystemPrompt != nil && *task.SystemPrompt != "" {
		argv = append(argv, *task.SystemPrompt)
	}

	ctx, cancel := context.WithTimeout(context.Background(), taskTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, cmdBin, argv...)
	if task.Workdir != "" {
		cmd.Dir = expandHome(task.Workdir)
	}
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	res.Output = string(out)
	if ctx.Err() == context.DeadlineExceeded {
		res.Status = RunStatusTimeout
		res.Error = "task timed out after 30m"
	} else if err != nil {
		res.Error = err.Error()
		if _, missing := err.(*exec.Error); missing {
			res.Error = "unable to launch agent binary: " + res.Error
		}
		if ee, ok := err.(*exec.ExitError); ok {
			res.ExitCode = ee.ExitCode()
		}
	} else {
		res.Status = RunStatusSuccess
		res.ExitCode = 0
	}
	if path, werr := writeRunLog(label, res.Output); werr != nil {
		log.Printf("[scheduler] warning: could not write run log: %v", werr)
	} else {
		res.OutputPath = path
	}
	return res
}

// taskTimeout bounds every headless exec (30 minutes), matching the original runner.
const taskTimeout = 30 * time.Minute

// writeRunLog writes the run output to ~/.snorkeling/scheduledtask-runs/<label>-<ts>.log.
func writeRunLog(label string, output string) (string, error) {
	logDir := filepath.Join(wavebase.GetHomeDir(), ".snorkeling", "scheduledtask-runs")
	if err := os.MkdirAll(logDir, 0700); err != nil {
		return "", err
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = "adhoc"
	}
	label = fileSafeName(label)
	name := fmt.Sprintf("%s-%s.log", label, time.Now().Format("20060102-150405"))
	path := filepath.Join(logDir, name)
	if err := os.WriteFile(path, []byte(output), 0600); err != nil {
		return "", err
	}
	return path, nil
}

// fileSafeName keeps a task id usable as a log filename (ids are uuids in
// practice; this is a belt-and-suspenders guard against odd ids).
func fileSafeName(s string) string {
	safe := make([]rune, 0, len(s))
	for _, c := range s {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_', c == '.':
			safe = append(safe, c)
		default:
			safe = append(safe, '_')
		}
	}
	if len(safe) == 0 {
		return "adhoc"
	}
	return string(safe)
}

func maybeTaskID(task *wconfig.ScheduledTaskType) string {
	if task == nil {
		return ""
	}
	return task.Id
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

// resolveTaskModel returns the model to pass to the agent. An explicit task model
// always wins; an empty one falls back to the catalog default. A model that is not
// in the catalog is still used (only a warning is logged) so new models are not
// blocked by a stale catalog.
func resolveTaskModel(task *wconfig.ScheduledTaskType, profile agentcatalog.ProfileInfo) string {
	if task.Model != "" {
		if !modelInCatalog(profile, task.Model) {
			log.Printf("[scheduler] warning: task id=%s model %q is not in agent %q catalog", task.Id, task.Model, task.AgentProfile)
		}
		return task.Model
	}
	return profile.DefaultModel
}

func modelInCatalog(profile agentcatalog.ProfileInfo, model string) bool {
	for _, m := range profile.Models {
		if m.Id == model {
			return true
		}
	}
	return false
}
