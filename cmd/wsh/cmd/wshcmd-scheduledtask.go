// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/scheduler"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// wshcmd-scheduledtask.go — the CLI surface for scheduled tasks.
//
// Write commands (create/update/delete) are dry-run by default: without --yes
// they print a preview and touch nothing in settings. `run` executes a task
// now and blocks until it finishes, returning the outcome (used for
// verification: A6 headless log, A7 block row). createdBy is decided
// server-side from the caller's identity (external agent token => "agent"),
// so the CLI never claims an identity.

var (
	schedTaskJSON       bool
	schedTaskCreatedBy  string
	schedTaskName       string
	schedTaskPrompt     string
	schedTaskSchedule   string
	schedTaskMode       string
	schedTaskAgent      string
	schedTaskModel      string
	schedTaskWorkdir    string
	schedTaskTab        string
	schedTaskYes        bool
	schedTaskEnabled    bool
	schedTaskRunTimeout int64
)

var scheduledTaskCmd = &cobra.Command{
	Use:   "scheduledtask",
	Short: "Manage scheduled tasks (agent-runnable automation)",
	Long: `Manage scheduled tasks that fire an agent on a schedule.

A task runs in one of two modes:
  headless  run the agent CLI once into a log file (~/.snorkeling/scheduledtask-runs/)
  block     create a visible agent block in a tab and deliver the prompt to its TUI

Write commands (create/update/delete) are dry-run by default: add --yes to
commit. Tasks created through an external agent token count against that
agent's quota (10) and are refused with E_QUOTA once full.

Schedules:
  cron:<expr>         5-field cron (minute hour dom month dow)
  every:<n>s|m|h      interval
  once@<RFC3339>      one-shot at an absolute timestamp
  daily@HH:MM         daily at local time
  weekly@<0-6>@HH:MM  weekly on a weekday (0=Sunday) at local time

  wsh scheduledtask list --json
  wsh scheduledtask create --name "daily digest" --prompt "summarize" \
      --schedule daily@09:00 --agent pi --yes`,
	Args: cobra.NoArgs,
}

var scheduledTaskListCmd = &cobra.Command{
	Use:   "list",
	Short: "List scheduled tasks",
	RunE:  scheduledTaskListRun,
	Args:  cobra.NoArgs,
}

var scheduledTaskGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Show one scheduled task",
	Args:  cobra.ExactArgs(1),
	RunE:  scheduledTaskGetRun,
}

var scheduledTaskCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a scheduled task (dry-run unless --yes)",
	Long: `Create a scheduled task.

Without --yes this prints a preview and does NOT write to settings.`,
	RunE: scheduledTaskCreateRun,
	Args: cobra.NoArgs,
}

var scheduledTaskUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update a scheduled task (dry-run unless --yes)",
	Long: `Update one scheduled task. Only the flags you pass are changed; the
task is fetched first so untouched fields survive. Ownership (createdBy) and
createdAt are immutable. Without --yes this prints a preview and does NOT
write to settings.`,
	RunE: scheduledTaskUpdateRun,
	Args: cobra.ExactArgs(1),
}

var scheduledTaskDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a scheduled task (dry-run unless --yes)",
	RunE:  scheduledTaskDeleteRun,
	Args:  cobra.ExactArgs(1),
}

var scheduledTaskRunCmd = &cobra.Command{
	Use:   "run <id>",
	Short: "Run a task now and wait for the result (verification)",
	Long: `Run a task immediately and wait for it to finish, printing the
outcome (status, exit code, duration, log path). Use it to verify a task
before it goes live on its schedule.`,
	RunE: scheduledTaskRunRun,
	Args: cobra.ExactArgs(1),
}

func init() {
	scheduledTaskListCmd.Flags().BoolVar(&schedTaskJSON, "json", false, "output as JSON")
	scheduledTaskListCmd.Flags().StringVar(&schedTaskCreatedBy, "created-by", "", "filter by creator: agent | user")
	scheduledTaskGetCmd.Flags().BoolVar(&schedTaskJSON, "json", false, "output as JSON")

	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskName, "name", "", "task name (required)")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskPrompt, "prompt", "", "prompt delivered to the agent (required)")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskSchedule, "schedule", "", "cron:<expr> | every:<n>s|m|h | once@<ISO> | daily@HH:MM | weekly@<0-6>@HH:MM (required)")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskMode, "mode", "headless", "headless | block")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskAgent, "agent", "pi", "agent profile from the catalog")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskModel, "model", "", "model id or provider/id (default: profile default)")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskWorkdir, "workdir", "", "working directory for the run / block")
	scheduledTaskCreateCmd.Flags().StringVar(&schedTaskTab, "tab", "", "current | new | <tabid> (block mode only)")
	scheduledTaskCreateCmd.Flags().BoolVar(&schedTaskYes, "yes", false, "commit the write (default: dry-run preview)")
	scheduledTaskCreateCmd.Flags().BoolVar(&schedTaskJSON, "json", false, "output as JSON")

	scheduledTaskUpdateCmd.Flags().BoolVar(&schedTaskEnabled, "enabled", true, "task enabled (only applies with --enabled)")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskName, "name", "", "task name")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskPrompt, "prompt", "", "prompt delivered to the agent")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskSchedule, "schedule", "", "cron:<expr> | every:<n>s|m|h | once@<ISO> | daily@HH:MM | weekly@<0-6>@HH:MM")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskMode, "mode", "", "headless | block")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskAgent, "agent", "", "agent profile from the catalog")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskModel, "model", "", "model id or provider/id")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskWorkdir, "workdir", "", "working directory")
	scheduledTaskUpdateCmd.Flags().StringVar(&schedTaskTab, "tab", "", "current | new | <tabid> (block mode only)")
	scheduledTaskUpdateCmd.Flags().BoolVar(&schedTaskYes, "yes", false, "commit the write (default: dry-run preview)")
	scheduledTaskUpdateCmd.Flags().BoolVar(&schedTaskJSON, "json", false, "output as JSON")

	scheduledTaskDeleteCmd.Flags().BoolVar(&schedTaskYes, "yes", false, "commit the delete (default: dry-run preview)")
	scheduledTaskDeleteCmd.Flags().BoolVar(&schedTaskJSON, "json", false, "output as JSON")

	scheduledTaskRunCmd.Flags().BoolVar(&schedTaskJSON, "json", false, "output the run result as JSON")
	scheduledTaskRunCmd.Flags().Int64Var(&schedTaskRunTimeout, "timeout-ms", 35*60*1000, "RPC timeout in ms (task runs can take up to 30m)")

	scheduledTaskCmd.AddCommand(scheduledTaskListCmd, scheduledTaskGetCmd, scheduledTaskCreateCmd,
		scheduledTaskUpdateCmd, scheduledTaskDeleteCmd, scheduledTaskRunCmd)
	for _, c := range []*cobra.Command{scheduledTaskListCmd, scheduledTaskGetCmd, scheduledTaskCreateCmd,
		scheduledTaskUpdateCmd, scheduledTaskDeleteCmd, scheduledTaskRunCmd} {
		c.PreRunE = preRunSetupRpcClient
	}
	rootCmd.AddCommand(scheduledTaskCmd)
}

func schedTaskOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Timeout: 10000}
}

func scheduledTaskListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("scheduledtask list", rtnErr == nil) }()
	items, err := wshclient.ScheduledTaskListCommand(RpcClient, schedTaskOpts())
	if err != nil {
		return fmt.Errorf("listing scheduled tasks: %w", err)
	}
	if items == nil {
		items = []wconfig.ScheduledTaskType{}
	}
	if schedTaskCreatedBy != "" {
		filtered := items[:0]
		for _, t := range items {
			if t.CreatedBy == schedTaskCreatedBy {
				filtered = append(filtered, t)
			}
		}
		items = filtered
	}
	if schedTaskJSON {
		return writeJSON(items)
	}
	if len(items) == 0 {
		WriteStdout("no scheduled tasks\n")
		return nil
	}
	for _, t := range items {
		WriteStdout("%s\t%s\t%s\tmode=%s\tenabled=%v\tcreatedBy=%s\tlastRunStatus=%s\n",
			t.Id, t.Name, scheduleDescribe(t), t.Mode, t.Enabled, orDash(t.CreatedBy), orDash(derefStr(t.LastRunStatus)))
	}
	return nil
}

func scheduledTaskGetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("scheduledtask get", rtnErr == nil) }()
	task, err := wshclient.ScheduledTaskGetCommand(RpcClient, args[0], schedTaskOpts())
	if err != nil {
		return fmt.Errorf("getting scheduled task: %w", err)
	}
	if task == nil {
		return fmt.Errorf("E_NOT_FOUND: task %q not found", args[0])
	}
	if schedTaskJSON {
		return writeJSON(task)
	}
	writeTaskText(task)
	return nil
}

func scheduledTaskCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("scheduledtask create", rtnErr == nil) }()
	if strings.TrimSpace(schedTaskName) == "" {
		return fmt.Errorf("E_USAGE: --name is required")
	}
	if strings.TrimSpace(schedTaskPrompt) == "" {
		return fmt.Errorf("E_USAGE: --prompt is required")
	}
	if strings.TrimSpace(schedTaskSchedule) == "" {
		return fmt.Errorf("E_USAGE: --schedule is required (cron:<expr> | every:<n>s|m|h | once@<ISO> | daily@HH:MM | weekly@<0-6>@HH:MM)")
	}
	req, err := schedTaskDraftFromFlags("")
	if err != nil {
		return err
	}
	req.Id = uuid.NewString()
	if !schedTaskYes {
		return schedTaskPreview("would create task", req)
	}
	created, err := wshclient.ScheduledTaskCreateCommand(RpcClient, req, schedTaskOpts())
	if err != nil {
		return err
	}
	if schedTaskJSON {
		return writeJSON(created)
	}
	WriteStdout("created\t%s\t%s\n", created.Id, created.Name)
	WriteStdout("createdby\t%s\n", orDash(created.CreatedBy))
	return nil
}

func scheduledTaskUpdateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("scheduledtask update", rtnErr == nil) }()
	current, err := wshclient.ScheduledTaskGetCommand(RpcClient, args[0], schedTaskOpts())
	if err != nil {
		return fmt.Errorf("getting scheduled task: %w", err)
	}
	if current == nil {
		return fmt.Errorf("E_NOT_FOUND: task %q not found", args[0])
	}
	req, err := schedTaskDraftFromFlags(args[0])
	if err != nil {
		return err
	}
	// Merge: fetched task is the base; only explicitly changed fields override.
	merged := *current
	if cmd.Flags().Changed("enabled") {
		merged.Enabled = schedTaskEnabled
	}
	if cmd.Flags().Changed("name") {
		merged.Name = schedTaskName
	}
	if cmd.Flags().Changed("prompt") {
		merged.Prompt = schedTaskPrompt
	}
	if cmd.Flags().Changed("schedule") {
		merged.Schedule = req.Schedule
	}
	if cmd.Flags().Changed("mode") {
		merged.Mode = schedTaskMode
	}
	if cmd.Flags().Changed("agent") {
		merged.AgentProfile = schedTaskAgent
	}
	if cmd.Flags().Changed("model") {
		merged.Model = schedTaskModel
	}
	if cmd.Flags().Changed("workdir") {
		merged.Workdir = schedTaskWorkdir
	}
	if cmd.Flags().Changed("tab") {
		merged.Tab = schedTaskTab
	}
	if !schedTaskYes {
		return schedTaskPreview("would update task", merged)
	}
	if err := wshclient.ScheduledTaskUpdateCommand(RpcClient, merged, schedTaskOpts()); err != nil {
		return err
	}
	if schedTaskJSON {
		return writeJSON(merged)
	}
	WriteStdout("updated\t%s\t%s\n", merged.Id, merged.Name)
	return nil
}

func scheduledTaskDeleteRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("scheduledtask delete", rtnErr == nil) }()
	task, err := wshclient.ScheduledTaskGetCommand(RpcClient, args[0], schedTaskOpts())
	if err != nil {
		return fmt.Errorf("getting scheduled task: %w", err)
	}
	if task == nil {
		return fmt.Errorf("E_NOT_FOUND: task %q not found", args[0])
	}
	if !schedTaskYes {
		if schedTaskJSON {
			return writeJSON(map[string]any{"dryrun": true, "action": "delete", "taskid": args[0], "name": task.Name})
		}
		WriteStdout("would delete task\t%s\t%s (pass --yes to commit)\n", task.Id, task.Name)
		return nil
	}
	if err := wshclient.ScheduledTaskDeleteCommand(RpcClient, args[0], schedTaskOpts()); err != nil {
		return err
	}
	if schedTaskJSON {
		return writeJSON(map[string]any{"deleted": true, "taskid": args[0]})
	}
	WriteStdout("deleted\t%s\n", args[0])
	return nil
}

func scheduledTaskRunRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() { sendActivity("scheduledtask run", rtnErr == nil) }()
	res, err := wshclient.ScheduledTaskRunCommand(RpcClient, args[0], &wshrpc.RpcOpts{Timeout: schedTaskRunTimeout})
	if err != nil {
		// Keep the outcome visible even when the run itself failed: the RPC
		// returns the result together with the error for E_AGENT_FAILED-style
		// outcomes; other errors (transport/quota) are plain failures.
		if schedTaskJSON && res != nil {
			_ = writeJSON(res)
		}
		return err
	}
	if schedTaskJSON {
		return writeJSON(res)
	}
	WriteStdout("task\t%s\n", res.TaskId)
	WriteStdout("status\t%s\n", res.Status)
	WriteStdout("exitcode\t%d\n", res.ExitCode)
	WriteStdout("durationms\t%d\n", res.DurationMs)
	if res.OutputPath != "" {
		WriteStdout("outputpath\t%s\n", res.OutputPath)
	}
	if res.Error != "" {
		WriteStdout("error\t%s\n", res.Error)
	}
	return nil
}

// schedTaskDraftFromFlags validates the create/update shared flags and builds a
// task with the schedule parsed. For update (id != "") the schedule parse runs
// only when a --schedule flag was provided (caller checks Changed separately).
func schedTaskDraftFromFlags(id string) (wconfig.ScheduledTaskType, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	req := wconfig.ScheduledTaskType{
		Id:           id,
		Name:         schedTaskName,
		Enabled:      true,
		AgentProfile: schedTaskAgent,
		Model:        schedTaskModel,
		Prompt:       schedTaskPrompt,
		Workdir:      schedTaskWorkdir,
		Tab:          schedTaskTab,
		Mode:         schedTaskMode,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if schedTaskSchedule != "" {
		sc, err := scheduler.ParseScheduleSpec(schedTaskSchedule)
		if err != nil {
			return req, err
		}
		req.Schedule = sc
	}
	// Defaults live here rather than on the flag: the same vars are bound to
	// both create and update flags (with different defaults), and cobra applies
	// a flag default at registration time, so the last registration wins.
	if strings.TrimSpace(req.AgentProfile) == "" {
		req.AgentProfile = "pi"
	}
	if strings.TrimSpace(req.Mode) == "" {
		req.Mode = "headless"
	}
	return req, nil
}

func schedTaskPreview(verb string, task wconfig.ScheduledTaskType) error {
	if schedTaskJSON {
		return writeJSON(map[string]any{"dryrun": true, "action": verb, "task": task})
	}
	WriteStdout("%s (dry-run; pass --yes to commit)\n", verb)
	writeTaskText(&task)
	return nil
}

func writeTaskText(t *wconfig.ScheduledTaskType) {
	WriteStdout("id\t%s\n", t.Id)
	WriteStdout("name\t%s\n", orDash(t.Name))
	WriteStdout("enabled\t%v\n", t.Enabled)
	WriteStdout("agent\t%s\n", orDash(t.AgentProfile))
	if t.Model != "" {
		WriteStdout("model\t%s\n", t.Model)
	}
	WriteStdout("mode\t%s\n", orDash(t.Mode))
	if t.Tab != "" {
		WriteStdout("tab\t%s\n", t.Tab)
	}
	if t.Workdir != "" {
		WriteStdout("workdir\t%s\n", t.Workdir)
	}
	WriteStdout("schedule\t%s\n", scheduleDescribe(*t))
	if t.Prompt != "" {
		WriteStdout("prompt\t%s\n", t.Prompt)
	}
	if t.CreatedBy != "" {
		WriteStdout("createdby\t%s\n", t.CreatedBy)
	}
	if t.LastRunStatus != nil {
		WriteStdout("lastrunstatus\t%s\n", *t.LastRunStatus)
	}
	if t.LastRunAt != nil {
		WriteStdout("lastrunat\t%s\n", *t.LastRunAt)
	}
}

func scheduleDescribe(t wconfig.ScheduledTaskType) string {
	switch t.Schedule.Type {
	case "cron":
		return "cron:" + t.Schedule.CronExpr
	case "interval":
		if t.Schedule.IntervalMs != nil {
			return fmt.Sprintf("every:%dms", *t.Schedule.IntervalMs)
		}
	case "once":
		if t.Schedule.RunAt != nil {
			return "once@" + *t.Schedule.RunAt
		}
	case "daily":
		return "daily@" + t.Schedule.TimeOfDay
	case "weekly":
		wd := 0
		if t.Schedule.DayOfWeek != nil {
			wd = *t.Schedule.DayOfWeek
		}
		return fmt.Sprintf("weekly@%d@%s", wd, t.Schedule.TimeOfDay)
	}
	return t.Schedule.Type
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}