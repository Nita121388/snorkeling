// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/scheduler"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func GetWatcherFullConfig() wconfig.FullConfigType {
	return wconfig.ReadFullConfig()
}

// ScheduledTask global instances set on startup via InitScheduledTasks.
var (
	schedScheduler scheduler.PlatformScheduler
	schedRunner    *scheduler.DefaultTaskRunner
	schedStore     *scheduler.RunStore
)

func InitScheduledTasks() {
	schedRunner = &scheduler.DefaultTaskRunner{}
	schedStore = scheduler.NewRunStore()
	schedScheduler = scheduler.NewInProcessScheduler(schedRunner)
	_ = schedScheduler.Start()
	// Load persisted tasks and add them to scheduler
	items := loadScheduledTaskItems()
	for i := range items {
		_ = schedScheduler.AddTask(&items[i])
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
		return data, fmt.Errorf("task id is required")
	}
	items := loadScheduledTaskItems()
	for i := range items {
		if items[i].Id == data.Id {
			return data, fmt.Errorf("task with id %q already exists", data.Id)
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
		return fmt.Errorf("task id is required")
	}
	items := loadScheduledTaskItems()
	found := false
	for i := range items {
		if items[i].Id == data.Id {
			items[i] = data
			found = true
			break
		}
	}
	if !found {
		items = append(items, data)
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
		return fmt.Errorf("scheduler not initialized")
	}
	return schedScheduler.RunNow(taskId)
}

func (ws *WshServer) ScheduledTaskHistoryCommand(ctx context.Context, taskId string) ([]wconfig.ScheduledTaskRunRecord, error) {
	return schedStore.GetRuns(taskId, 50), nil
}
