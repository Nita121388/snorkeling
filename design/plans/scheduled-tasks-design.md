# Scheduled Tasks Design Document

> **Feature**: Support scheduled/periodic agent tasks  
> **Date**: 2026-09-08  
> **Status**: Draft  

---

## 1. Problem Statement

Users want to run agent tasks on a schedule — e.g., daily code review, periodic monitoring, weekly reports. Currently Snorkeling supports manual agent launch only. We need:

1. **Cross-platform scheduling** (Windows/macOS/Linux)
2. **Configurable**: which agent, which model, what prompt/task
3. **Pi-first**: prioritize Pi agent support
4. **Agent-created**: agents themselves can create/manage scheduled tasks

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │ Scheduled Tasks   │  │  Task Detail / Editor Modal │  │
│  │ List View         │  │  (agent, model, schedule)   │  │
│  └──────────────────┘  └─────────────────────────────┘  │
│           │                        │                      │
│           └─────── wsh RPC ────────┘                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Backend (Go) — Wave Server                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │              SchedulerService                       │ │
│  │  ┌──────────────┐  ┌───────────────────────────┐  │ │
│  │  │ ScheduleStore │  │ PlatformScheduler          │  │ │
│  │  │ (SQLite)      │  │ (cron / launchd / schtasks)│  │ │
│  │  └──────────────┘  └───────────────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
│                          │                               │
│              ┌───────────┴───────────┐                  │
│              ▼                       ▼                  │
│  ┌──────────────────┐  ┌────────────────────────┐      │
│  │ AgentLauncher     │  │  JobController          │      │
│  │ (existing)        │  │  (terminal execution)   │      │
│  └──────────────────┘  └────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Data Model

### 3.1 ScheduledTask Schema (settings.json)

```jsonc
// schema/scheduledtasks.json
{
  "$defs": {
    "ScheduledTaskType": {
      "type": "object",
      "properties": {
        "id":                { "type": "string", "format": "uuid" },
        "name":              { "type": "string" },
        "enabled":           { "type": "boolean", "default": true },

        // Agent selection
        "agentProfile":      { "type": "string", "description": "Agent profile name: pi, codex, claude, etc." },
        "agentCmd":          { "type": "string", "description": "Override command (if not using profile)" },
        "agentArgs":         { "type": "array", "items": { "type": "string" } },

        // Model selection (Pi-first)
        "provider":          { "type": "string", "description": "AI provider: pi, openai, anthropic, etc." },
        "model":             { "type": "string", "description": "Model ID, e.g. deepseek-v4-pro, gpt-5, etc." },
        "thinking":          { "type": "string", "enum": ["off", "minimal", "low", "medium", "high", "max"] },

        // Task definition
        "prompt":            { "type": "string", "description": "The task prompt/message to send" },
        "systemPrompt":      { "type": "string", "description": "Optional system prompt override" },
        "workdir":           { "type": "string", "description": "Working directory for the agent" },
        "connection":        { "type": "string", "description": "Connection target (local or ssh name)" },

        // Schedule definition
        "schedule": {
          "type": "object",
          "properties": {
            "type":           { "type": "string", "enum": ["cron", "interval", "once", "daily", "weekly"] },
            "cronExpr":       { "type": "string", "description": "Cron expression (5/6 field), for type=cron" },
            "intervalMs":     { "type": "integer", "description": "Interval in ms, for type=interval" },
            "timeOfDay":      { "type": "string", "description": "HH:MM, for type=daily/weekly" },
            "dayOfWeek":      { "type": "integer", "enum": [0,1,2,3,4,5,6], "description": "0=Sun, for type=weekly" },
            "runAt":          { "type": "string", "format": "date-time", "description": "ISO timestamp, for type=once" },
            "timezone":       { "type": "string", "description": "IANA timezone, default system" }
          },
          "required": ["type"]
        },

        // Notification
        "notifyOnComplete":  { "type": "boolean", "default": false },
        "notifyOnError":     { "type": "boolean", "default": true },
        "notificationMode":  { "type": "string", "enum": ["os", "bell", "both", "none"], "default": "os" },

        // Metadata
        "createdAt":         { "type": "string", "format": "date-time" },
        "updatedAt":         { "type": "string", "format": "date-time" },
        "lastRunAt":         { "type": "string", "format": "date-time" },
        "lastRunStatus":     { "type": "string", "enum": ["success", "error", "timeout", "cancelled"] },
        "runCount":          { "type": "integer", "default": 0 },
        "tags":              { "type": "array", "items": { "type": "string" } },
        "createdBy":         { "type": "string", "enum": ["user", "agent"], "description": "Who created this task" }
      },
      "required": ["id", "name", "agentProfile", "prompt", "schedule"]
    }
  }
}
```

### 3.2 Settings Key

```
scheduledtasks:items  → ScheduledTaskType[]
```

Add to `wconfig/metaconsts.go`:
```go
ConfigKey_ScheduledTasksClear = "scheduledtasks:*"
ConfigKey_ScheduledTasksItems = "scheduledtasks:items"
```

---

## 4. Backend Components

### 4.1 Platform Scheduler (`pkg/scheduler/`)

Cross-platform scheduler abstraction:

```
pkg/scheduler/
├── scheduler.go          # Interface + factory
├── cronexpr.go           # Cron expression parser (pure Go)
├── scheduler_unix.go     # Unix: in-process timer (reliable when app running)
├── scheduler_windows.go  # Windows: in-process + optional schtasks integration
├── scheduler_darwin.go   # macOS: in-process + optional launchd integration
├── runner.go             # Task execution runner
└── store.go              # SQLite persistence for run history
```

**Interface:**
```go
type PlatformScheduler interface {
    Start() error
    Stop() error
    AddTask(task *ScheduledTask) error
    RemoveTask(taskID string) error
    UpdateTask(task *ScheduledTask) error
    GetNextRunTime(task *ScheduledTask) time.Time
    RunNow(taskID string) error  // manual trigger
}
```

**Strategy:**
- **Primary**: In-process Go timer (goroutine + `time.Ticker`). Works when Snorkeling is running.
- **Optional**: OS-native scheduler integration for "run even when app is closed" (Phase 2).
  - Windows: `schtasks.exe` or COM `ITaskService`
  - macOS: `launchd` plist
  - Linux: `systemd` timer or crontab entry

### 4.2 Task Runner (`pkg/scheduler/runner.go`)

Executes a scheduled task by:
1. Resolving the agent profile (Pi, Codex, Claude, etc.)
2. Building the launch command with model flag
3. Creating a block in the workspace (or headless mode)
4. Sending the prompt via RPC
5. Collecting results and updating status

```go
func (r *Runner) RunTask(ctx context.Context, task *ScheduledTask) (*RunResult, error) {
    // 1. Resolve agent command
    profile := resolveProfile(task.AgentProfile)
    cmd := buildCommand(profile, task)

    // 2. Create terminal block (visible) or run headless
    if task.Visible {
        block, err := createAgentBlock(task)
        // ... inject prompt via wsh
    } else {
        // Headless: use pi --mode rpc or codex --print
        result, err := runHeadless(ctx, cmd, task.Prompt)
    }

    // 3. Notify
    if task.NotifyOnComplete {
        notifyUser(task, result)
    }

    // 4. Record run
    recordRun(task, result)
}
```

### 4.3 wsh RPC Commands

New commands in `pkg/wshrpc/wshrpctypes_const.go`:

```go
const (
    Command_ScheduledTaskList    = "scheduledtasklist"
    Command_ScheduledTaskGet     = "scheduledtaskget"
    Command_ScheduledTaskCreate  = "scheduledtaskcreate"
    Command_ScheduledTaskUpdate  = "scheduledtaskupdate"
    Command_ScheduledTaskDelete  = "scheduledtaskdelete"
    Command_ScheduledTaskRunNow  = "scheduledtaskrunnow"
    Command_ScheduledTaskHistory = "scheduledtaskhistory"
)
```

### 4.4 Agent-Created Tasks (Self-Service)

Agents (Pi, Codex, etc.) can create tasks via the `wsh` CLI or RPC:

```bash
# From within an agent session:
wsh scheduledtask create \
  --name "Daily Code Review" \
  --agent pi \
  --model deepseek-v4-pro \
  --schedule "cron:0 9 * * 1-5" \
  --prompt "Review uncommitted changes and suggest improvements" \
  --notify

# Or via Pi's tool system (Phase 2):
# Pi can call wsh scheduledtask create programmatically
```

**Agent-created task metadata:**
- `createdBy: "agent"` — marks tasks created by agents
- Stored in same settings, visible in UI
- Agent can also list/update/delete its own tasks

---

## 5. Frontend Components

### 5.1 Scheduled Tasks List View

New view type: `"scheduledtasks"` — accessible from sidebar or command palette.

**Location**: `frontend/app/view/scheduledtasks/`

```
scheduledtasks/
├── scheduledtasks-view.tsx       # Main list view
├── scheduledtasks-model.ts       # ViewModel
├── scheduledtask-row.tsx         # Single task row
├── scheduledtask-editor-modal.tsx # Create/edit modal
├── scheduledtask-history-modal.tsx # Run history
├── schedule-picker.tsx           # Schedule type selector (cron/interval/daily/etc.)
├── model-picker.tsx              # Model selection (Pi-first)
└── agent-picker.tsx              # Agent profile selection
```

### 5.2 Task Editor Modal

Key UI sections:
1. **Agent & Model** — dropdown for agent profile (Pi highlighted), model picker
2. **Task Prompt** — textarea for the prompt
3. **Schedule** — type selector + type-specific fields
   - Cron: expression input with preview ("Next 5 runs")
   - Interval: duration picker
   - Daily/Weekly: time picker
   - Once: datetime picker
4. **Working Directory** — path input with connection selector
5. **Notifications** — toggle for complete/error notifications
6. **Tags** — tag input

### 5.3 Schedule Picker Component

```
┌─────────────────────────────────────┐
│ Schedule Type: [Cron ▾]             │
│                                     │
│ ┌─ Cron Expression ──────────────┐ │
│ │ ┌─┬─┬─┬─┬─┬─┐                 │ │
│ │ │0│0│9│*│*│1-5│  → Weekdays 9AM│ │
│ │ └─┴─┴─┴─┴─┴─┘                 │ │
│ └────────────────────────────────┘ │
│                                     │
│ Timezone: [System ▾]               │
│                                     │
│ Preview:                           │
│   Next run: Mon Sep 9 09:00        │
│   Mon Sep 9, Tue Sep 10, ...       │
└─────────────────────────────────────┘
```

### 5.4 Sidebar Entry

Add "Scheduled" entry to the right sidebar (WidgetsBar), alongside Agent/Sessions.

```tsx
// In WidgetsBar component
<SidebarEntry
    icon="clock"
    label="Scheduled"
    view="scheduledtasks"
    badge={activeTaskCount}
/>
```

---

## 6. Agent Priority: Pi-First

### 6.1 Default Agent Profiles (Updated)

```ts
const BuiltinAgentProfiles: Record<string, AgentProfileConfig> = {
    pi: {           // ← Moved to first position
        cmd: "pi",
        modelflag: "--model",
        // Pi-specific defaults
        args: ["--mode", "rpc"],
    },
    codex: {
        cmd: "codex",
        modelflag: "--model",
    },
    claude: {
        cmd: "claude",
        modelflag: "--model",
    },
    gemini: {
        cmd: "gemini",
        modelflag: "--model",
    },
    opencode: {
        cmd: "opencode",
        modelflag: "--model",
    },
};
```

### 6.2 Model Quick-Select for Pi

The model picker prioritizes commonly-used Pi models:

```ts
const PiModelQuickSelect = [
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek" },
    { id: "gpt-5", label: "GPT-5", provider: "openai" },
    { id: "claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
    // ... dynamic list from Pi's available models
];
```

### 6.3 Pi Vendor Integration

Leverage existing cc-switch vendor system:

```go
// When agent is Pi, check for Pi vendor config
if task.AgentProfile == "pi" && task.PiVendorId != "" {
    vendor := ccswitch.GetPiVendor(task.PiVendorId)
    // Apply vendor-specific env, API keys, endpoint
}
```

---

## 7. Cross-Platform Considerations

### 7.1 In-Process Scheduling (Phase 1)

All platforms use the same Go-based timer:

```go
type InProcessScheduler struct {
    tasks    map[string]*scheduledEntry
    ticker   *time.Ticker
    stopCh   chan struct{}
}

type scheduledEntry struct {
    task     *ScheduledTask
    nextRun  time.Time
    cancelFn context.CancelFunc
}
```

**Pros**: No OS-level dependencies, works everywhere, reliable when app is running.  
**Cons**: Tasks don't run if app is closed.

### 7.2 OS-Native Scheduling (Phase 2, Optional)

For users who want tasks to run even when Snorkeling is closed:

| Platform | Mechanism | Tool |
|----------|-----------|------|
| Windows  | Task Scheduler | `schtasks.exe` / COM `ITaskService` |
| macOS    | launchd | `launchctl` + plist |
| Linux    | systemd timer / cron | `systemd-run` / `crontab` |

**Implementation**: Generate a wrapper script + register with OS scheduler.

```bash
# Generated wrapper script (cross-platform)
#!/bin/bash
# ~/.snorkeling/scheduled/daily-review.sh
cd ~/myproject
wsh scheduledtask runnow --id "task-uuid" --prompt "Review changes"
```

### 7.3 App State Awareness

```go
// When app starts, sync in-process scheduler with stored tasks
func (s *InProcessScheduler) Start() error {
    tasks := s.store.GetAllEnabled()
    for _, task := range tasks {
        s.AddTask(task)
    }
    return nil
}

// When app stops, gracefully cancel all timers
func (s *InProcessScheduler) Stop() error {
    close(s.stopCh)
    // Wait for any running tasks to complete (with timeout)
    return nil
}
```

---

## 8. Implementation Phases

### Phase 1: Core (Week 1-2)

- [ ] Data model + settings schema
- [ ] Platform scheduler (in-process timers)
- [ ] Task runner (headless Pi/Codex execution)
- [ ] wsh RPC commands (CRUD + RunNow)
- [ ] Run history storage (SQLite)

### Phase 2: Frontend (Week 2-3)

- [ ] Scheduled Tasks list view
- [ ] Task editor modal
- [ ] Schedule picker (cron builder)
- [ ] Model/Agent picker (Pi-first)
- [ ] Run history modal
- [ ] Sidebar entry

### Phase 3: Agent Self-Service (Week 3-4)

- [ ] `wsh scheduledtask` CLI commands
- [ ] Pi tool integration (agent can call wsh)
- [ ] Agent-created task metadata
- [ ] Task ownership/filtering in UI

### Phase 4: OS Integration (Week 4+, Optional)

- [ ] Windows Task Scheduler integration
- [ ] macOS launchd integration
- [ ] Linux systemd/cron integration
- [ ] "Run when app is closed" toggle

---

## 9. Example Usage

### 9.1 Manual Creation via UI

```
User opens sidebar → clicks "Scheduled" → clicks "+ New Task"
→ Selects Agent: Pi, Model: deepseek-v4-pro
→ Types prompt: "Review the latest commit and suggest improvements"
→ Sets schedule: Daily at 9:00 AM, weekdays only
→ Enables notification on complete
→ Saves → Task appears in list
```

### 9.2 Agent-Created Task

```bash
# User asks Pi during a session:
> "每天早上9点帮我review一下代码"

# Pi can (Phase 3) call:
wsh scheduledtask create \
  --name "Daily Code Review" \
  --agent pi \
  --model deepseek-v4-pro \
  --schedule "cron:0 9 * * 1-5" \
  --prompt "Analyze uncommitted git changes and provide a structured review" \
  --notify
```

### 9.3 Programmatic via Settings

```json
// settings.json
{
  "scheduledtasks:items": [
    {
      "id": "task-001",
      "name": "Morning Standup Summary",
      "enabled": true,
      "agentProfile": "pi",
      "model": "deepseek-v4-pro",
      "prompt": "Summarize yesterday's git commits and today's planned work from the project README",
      "schedule": { "type": "daily", "timeOfDay": "08:30", "timezone": "Asia/Shanghai" },
      "workdir": "~/myproject",
      "notifyOnComplete": true,
      "createdBy": "user",
      "createdAt": "2026-09-08T10:00:00Z"
    }
  ]
}
```

---

## 10. Open Questions

1. **Headless vs Visible**: Should scheduled tasks run in a visible block or headless?  
   → Default headless for background tasks, with option to show in block.

2. **Concurrency**: Should multiple runs of the same task be allowed?  
   → Default: no (skip if previous run still active).

3. **Error Handling**: What happens if agent crashes mid-task?  
   → Record error, notify user, mark task as failed.

4. **Cost Tracking**: Should we track API cost per scheduled task?  
   → Phase 2 consideration.

5. **Task Templates**: Pre-built templates for common tasks (code review, monitoring, etc.)?  
   → Nice-to-have, can add later.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Timer drift on long-running tasks | Use `time.AfterFunc` with recalculation on each wake |
| App crash loses scheduled state | Persist to SQLite; resync on restart |
| Agent model rate limits | Implement backoff + configurable retry policy |
| Cross-platform cron differences | Phase 1 uses in-process; Phase 2 per-platform adapters |
| Security (agent runs arbitrary tasks) | Same trust model as manual agent launch; user explicitly creates tasks |

---

*End of design document.*
