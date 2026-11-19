// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
	"github.com/wavetermdev/waveterm/pkg/scheduler"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func GetWatcherFullConfig() wconfig.FullConfigType {
	return wconfig.ReadFullConfig()
}

// maxAgentScheduledTasks is the per-creator quota for agent-created tasks
// (security gate: an external agent can schedule arbitrary prompts, so the
// count is capped and the message tells the caller where it stands).
const maxAgentScheduledTasks = 10

// ScheduledTask global instances set on startup via InitScheduledTasks.
var (
	schedScheduler scheduler.PlatformScheduler
	schedRunner    *scheduler.DefaultTaskRunner
	schedStore     *scheduler.RunStore
)

func InitScheduledTasks() {
	schedRunner = &scheduler.DefaultTaskRunner{}
	schedStore = scheduler.NewRunStore()
	schedRunner.Store = schedStore
	schedRunner.UpdateMeta = updateScheduledTaskMeta
	// Mode=block tasks build the agent block through the exact path the GUI and
	// `agent launch` use (catalog validation happens before any block is
	// created; send failure leaves a usable, visible block).
	schedRunner.LaunchBlock = launchBlockForTask
	// Keep the headless model mapping identical to the launch path: pi refuses
	// bare ids that resolve under several authenticated providers, and the one
	// provider/id expansion lives in canonicalizeModelArg (agentlaunch.go).
	scheduler.CanonicalizeModelArg = func(profile agentcatalog.ProfileInfo, model string) string {
		return canonicalizeModelArg(profile, model)
	}
	schedScheduler = scheduler.NewInProcessScheduler(schedRunner)
	_ = schedScheduler.Start()
	// Load persisted tasks and add them to scheduler
	items := loadScheduledTaskItems()
	// Startup catch-up (decision #1, C 档): tasks that missed their scheduled
	// occurrence while the app was off are re-run once, serially, and marked
	// LastRunStatus=missed-run. Runs BEFORE the AddTask loop so every task is
	// re-scheduled from its (possibly advanced) LastRunAt.
	scheduler.CatchUpMissed(schedRunner, items, time.Now(), markScheduledTaskMissedRun)
	for i := range items {
		_ = schedScheduler.AddTask(&items[i])
	}
}

// launchBlockForTask is the injected block launcher: equivalent to
// `wsh agent launch --profile <p> --model <m> --cwd <workdir> --tab <tab> --send <prompt>`.
func launchBlockForTask(task *wconfig.ScheduledTaskType) error {
	tab := strings.TrimSpace(task.Tab)
	if tab == "" || tab == "current" {
		tab = "active"
	}
	launchReq := wshrpc.AgentLaunchRequest{
		Profile: strings.TrimSpace(task.AgentProfile),
		Model:   strings.TrimSpace(task.Model),
		Tab:     tab,
		Cwd:     strings.TrimSpace(task.Workdir),
	}
	if prompt := strings.TrimSpace(task.Prompt); prompt != "" {
		launchReq.Send = &wshrpc.AgentSendRequest{
			Text64: base64.StdEncoding.EncodeToString([]byte(prompt)),
		}
	}
	_, err := WshServerImpl.AgentLaunchCommand(context.Background(), launchReq)
	return err
}

// updateScheduledTaskMeta records lastRun fields on the persisted task and refreshes the
// in-process scheduler with the updated metadata (schedule is unchanged).
func updateScheduledTaskMeta(taskID string, status string, durationMs int64, errMsg string) {
	items := loadScheduledTaskItems()
	var updated *wconfig.ScheduledTaskType
	for i := range items {
		if items[i].Id == taskID {
			now := time.Now().UTC().Format(time.RFC3339)
			items[i].UpdatedAt = now
			items[i].LastRunAt = &now
			lastRunStatus := status
			items[i].LastRunStatus = &lastRunStatus
			items[i].RunCount++
			updated = &items[i]
			break
		}
	}
	if updated == nil {
		return
	}
	_ = wconfig.SetBaseConfigValue(map[string]any{wconfig.ConfigKey_ScheduledTasksItems: items})
	if schedScheduler != nil {
		_ = schedScheduler.UpdateTask(updated)
	}
}

// markScheduledTaskMissedRun overwrites LastRunStatus with missed-run after a
// startup catch-up run (LastRunAt/RunCount were already written by the run
// itself). The rewrite intentionally keeps the run's own LastRunAt so the next
// startup cannot re-fire the same miss.
func markScheduledTaskMissedRun(taskID string) {
	items := loadScheduledTaskItems()
	for i := range items {
		if items[i].Id == taskID {
			status := scheduler.RunStatusMissedRun
			items[i].LastRunStatus = &status
			_ = wconfig.SetBaseConfigValue(map[string]any{wconfig.ConfigKey_ScheduledTasksItems: items})
			return
		}
	}
}

func loadScheduledTaskItems() []wconfig.ScheduledTaskType {
	fc := GetWatcherFullConfig()
	return fc.Settings.ScheduledTasksItems
}

func (ws *WshServer) ScheduledTaskListCommand(ctx context.Context) ([]wconfig.ScheduledTaskType, error) {
	return loadScheduledTaskItems(), nil
}

func (ws *WshServer) ScheduledTaskGetCommand(ctx context.Context, taskId string) (*wconfig.ScheduledTaskType, error) {
	items := loadScheduledTaskItems()
	for i := range items {
		if items[i].Id == taskId {
			return &items[i], nil
		}
	}
	return nil, nil
}

func (ws *WshServer) ScheduledTaskCreateCommand(ctx context.Context, data wconfig.ScheduledTaskType) (wconfig.ScheduledTaskType, error) {
	if data.Id == "" {
		return data, fmt.Errorf("E_USAGE: task id is required")
	}
	// CreatedBy is a server-side fact, never a caller-declared field: external
	// agent calls (scoped token on the link) land as "agent", everything else
	// as "user". A client cannot paint itself as a user to dodge the quota.
	createdBy := "user"
	if callerIsAgent(ctx) {
		createdBy = "agent"
	}
	data.CreatedBy = createdBy
	items := loadScheduledTaskItems()
	for i := range items {
		if items[i].Id == data.Id {
			return data, fmt.Errorf("E_CONFLICT: task with id %q already exists", data.Id)
		}
	}
	if createdBy == "agent" {
		agentCount := 0
		for i := range items {
			if items[i].CreatedBy == "agent" {
				agentCount++
			}
		}
		if agentCount >= maxAgentScheduledTasks {
			return data, fmt.Errorf(
				"E_QUOTA: agent task quota reached (%d/%d); delete an existing task (wsh scheduledtask delete <id>) before creating another",
				agentCount, maxAgentScheduledTasks)
		}
	}
	items = append(items, data)
	if err := wconfig.SetBaseConfigValue(map[string]any{wconfig.ConfigKey_ScheduledTasksItems: items}); err != nil {
		return data, err
	}
	if schedScheduler != nil {
		_ = schedScheduler.AddTask(&data)
	}
	return data, nil
}

func (ws *WshServer) ScheduledTaskUpdateCommand(ctx context.Context, data wconfig.ScheduledTaskType) error {
	if data.Id == "" {
		return fmt.Errorf("E_USAGE: task id is required")
	}
	items := loadScheduledTaskItems()
	found := false
	for i := range items {
		if items[i].Id == data.Id {
			// Ownership and creation time are immutable: an agent must not be
			// able to relabel an agent task as user-created to dodge the quota,
			// and update is not an upsert (that would also bypass the quota gate).
			data.CreatedBy = items[i].CreatedBy
			if items[i].CreatedAt != "" {
				data.CreatedAt = items[i].CreatedAt
			}
			items[i] = data
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("E_NOT_FOUND: task %q not found", data.Id)
	}
	if err := wconfig.SetBaseConfigValue(map[string]any{wconfig.ConfigKey_ScheduledTasksItems: items}); err != nil {
		return err
	}
	if schedScheduler != nil {
		_ = schedScheduler.UpdateTask(&data)
	}
	return nil
}

func (ws *WshServer) ScheduledTaskDeleteCommand(ctx context.Context, taskId string) error {
	items := loadScheduledTaskItems()
	filtered := make([]wconfig.ScheduledTaskType, 0, len(items))
	for _, t := range items {
		if t.Id != taskId {
			filtered = append(filtered, t)
		}
	}
	if err := wconfig.SetBaseConfigValue(map[string]any{wconfig.ConfigKey_ScheduledTasksItems: filtered}); err != nil {
		return err
	}
	if schedScheduler != nil {
		_ = schedScheduler.RemoveTask(taskId)
	}
	return nil
}

func (ws *WshServer) ScheduledTaskRunNowCommand(ctx context.Context, taskId string) error {
	if schedScheduler == nil {
		return fmt.Errorf("E_INTERNAL: scheduler not initialized")
	}
	return schedScheduler.RunNow(taskId)
}

// ScheduledTaskRunCommand runs a task now and waits for it to finish. It is
// deliberately synchronous (unlike RunNow) so `wsh scheduledtask run` and the
// MCP run tool observe the real outcome: exit code, duration and log path.
func (ws *WshServer) ScheduledTaskRunCommand(ctx context.Context, taskId string) (*wshrpc.ScheduledTaskRunResult, error) {
	if schedRunner == nil {
		return nil, fmt.Errorf("E_INTERNAL: scheduler not initialized")
	}
	items := loadScheduledTaskItems()
	for i := range items {
		if items[i].Id == taskId {
			res := schedRunner.RunTask(&items[i])
			return scheduledRunResultToWsh(res), nil
		}
	}
	return nil, fmt.Errorf("E_NOT_FOUND: task %q not found", taskId)
}

// scheduledRunResultToWsh converts the runner's result into the wire shape,
// bounding Output so a huge agent log cannot balloon the RPC payload.
func scheduledRunResultToWsh(res *scheduler.RunResult) *wshrpc.ScheduledTaskRunResult {
	if res == nil {
		return &wshrpc.ScheduledTaskRunResult{Status: scheduler.RunStatusError, Error: "nil run result"}
	}
	const maxOutputBytes = 64 * 1024
	out := res.Output
	if len(out) > maxOutputBytes {
		out = out[:maxOutputBytes] + "...(truncated)"
	}
	return &wshrpc.ScheduledTaskRunResult{
		TaskId:     res.TaskId,
		Status:     res.Status,
		Error:      res.Error,
		DurationMs: res.DurationMs,
		ExitCode:   res.ExitCode,
		OutputPath: res.OutputPath,
		Output:     out,
	}
}

func (ws *WshServer) ScheduledTaskHistoryCommand(ctx context.Context, taskId string) ([]wconfig.ScheduledTaskRunRecord, error) {
	if schedStore == nil {
		return nil, nil
	}
	return schedStore.GetRuns(taskId, 50), nil
}
