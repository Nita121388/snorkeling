// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import {
    AgentProfileInfo,
    invalidateAgentCatalog,
    loadAgentCatalog,
    pickDefaultModel,
} from "@/app/workspace/agent-catalog";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ScheduledTasksView } from "./scheduledtasks-view";
import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import * as jotai from "jotai";

type ScheduledTasksEnv = WaveEnvSubset<{
    rpc: {
        ScheduledTaskListCommand: WaveEnv["rpc"]["ScheduledTaskListCommand"];
        ScheduledTaskCreateCommand: WaveEnv["rpc"]["ScheduledTaskCreateCommand"];
        ScheduledTaskUpdateCommand: WaveEnv["rpc"]["ScheduledTaskUpdateCommand"];
        ScheduledTaskDeleteCommand: WaveEnv["rpc"]["ScheduledTaskDeleteCommand"];
        ScheduledTaskRunNowCommand: WaveEnv["rpc"]["ScheduledTaskRunNowCommand"];
        ScheduledTaskHistoryCommand: WaveEnv["rpc"]["ScheduledTaskHistoryCommand"];
        AgentProfileListCommand: WaveEnv["rpc"]["AgentProfileListCommand"];
    };
}>;

function nowIso(): string {
    return new Date().toISOString();
}

function newTaskId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return "task-" + Date.now();
    }
}

// The catalog is the source of truth for which agents exist and which models each
// agent offers. makeDefaultDraft() resolves the default profile/model from it; the
// atoms are loaded by refreshCatalog() before the editor opens.
let agentCatalogSnapshot: AgentProfileInfo[] = [];

function defaultProfileName(): string {
    return agentCatalogSnapshot[0]?.name ?? "";
}

function makeDefaultDraft(): ScheduledTaskType {
    const profile = agentCatalogSnapshot.find((p) => p.name === defaultProfileName()) ?? null;
    return {
        id: "",
        name: "",
        enabled: true,
        agentProfile: defaultProfileName(),
        model: pickDefaultModel(profile),
        prompt: "",
        workdir: "",
        connection: "local",
        schedule: { type: "daily", timeOfDay: "09:00", timezone: "Asia/Shanghai" },
        notifyOnComplete: true,
        notifyOnError: true,
        notificationMode: "os",
        createdBy: "user",
    };
}

export class ScheduledTasksViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    env: ScheduledTasksEnv;

    viewIcon = jotai.atom<string>("clock");
    viewName = jotai.atom<string>("Scheduled Tasks");
    manageConnection = jotai.atom<boolean>(false);

    tasksAtom: jotai.PrimitiveAtom<ScheduledTaskType[]>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    editorOpenAtom: jotai.PrimitiveAtom<boolean>;
    editingTaskAtom: jotai.PrimitiveAtom<ScheduledTaskType | null>;
    historyOpenAtom: jotai.PrimitiveAtom<boolean>;
    historyTaskAtom: jotai.PrimitiveAtom<ScheduledTaskType | null>;
    historyAtom: jotai.PrimitiveAtom<ScheduledTaskRunRecord[]>;
    statusAtom: jotai.PrimitiveAtom<string>;
    agentCatalogAtom: jotai.PrimitiveAtom<AgentProfileInfo[]>;
    catalogLoadingAtom: jotai.PrimitiveAtom<boolean>;

    disposed = false;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "scheduledtasks";
        this.blockId = blockId;
        this.env = waveEnv;

        this.tasksAtom = jotai.atom<ScheduledTaskType[]>([]) as jotai.PrimitiveAtom<ScheduledTaskType[]>;
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
        this.editorOpenAtom = jotai.atom<boolean>(false);
        this.editingTaskAtom = jotai.atom<ScheduledTaskType | null>(null) as jotai.PrimitiveAtom<ScheduledTaskType | null>;
        this.historyOpenAtom = jotai.atom<boolean>(false);
        this.historyTaskAtom = jotai.atom<ScheduledTaskType | null>(null) as jotai.PrimitiveAtom<ScheduledTaskType | null>;
        this.historyAtom = jotai.atom<ScheduledTaskRunRecord[]>([]) as jotai.PrimitiveAtom<ScheduledTaskRunRecord[]>;
        this.statusAtom = jotai.atom<string>("") as jotai.PrimitiveAtom<string>;
        this.agentCatalogAtom = jotai.atom<AgentProfileInfo[]>([]) as jotai.PrimitiveAtom<AgentProfileInfo[]>;
        this.catalogLoadingAtom = jotai.atom<boolean>(true) as jotai.PrimitiveAtom<boolean>;

        this.refresh();
        this.refreshCatalog();
    }

    get viewComponent(): ViewComponent {
        return ScheduledTasksView;
    }

    dispose(): void {
        this.disposed = true;
    }

    async refresh() {
        if (this.disposed) return;
        try {
            const tasks = await this.env.rpc.ScheduledTaskListCommand(TabRpcClient);
            if (this.disposed) return;
            globalStore.set(this.tasksAtom, tasks ?? []);
            globalStore.set(this.loadingAtom, false);
            globalStore.set(this.errorAtom, null);
        } catch (e) {
            if (this.disposed) return;
            globalStore.set(this.loadingAtom, false);
            globalStore.set(this.errorAtom, String(e));
        }
    }

    async refreshCatalog(force: boolean = false) {
        if (this.disposed) return;
        try {
            const profiles = await loadAgentCatalog(force);
            if (this.disposed) return;
            agentCatalogSnapshot = profiles;
            globalStore.set(this.agentCatalogAtom, profiles);
        } finally {
            if (!this.disposed) globalStore.set(this.catalogLoadingAtom, false);
        }
    }

    openCreate() {
        globalStore.set(this.editingTaskAtom, makeDefaultDraft());
        globalStore.set(this.editorOpenAtom, true);
        void this.refreshCatalog(true);
    }

    openEdit(task: ScheduledTaskType) {
        globalStore.set(this.editingTaskAtom, structuredClone(task));
        globalStore.set(this.editorOpenAtom, true);
        void this.refreshCatalog(true);
    }

    closeEditor() {
        globalStore.set(this.editorOpenAtom, false);
        globalStore.set(this.editingTaskAtom, null);
    }

    async save(draft: ScheduledTaskType): Promise<string> {
        if (this.disposed) return null;
        const now = nowIso();
        try {
            if (draft.id) {
                draft.updatedAt = now;
                await this.env.rpc.ScheduledTaskUpdateCommand(TabRpcClient, draft);
            } else {
                invalidateAgentCatalog();
                draft.id = newTaskId();
                draft.createdAt = now;
                draft.updatedAt = now;
                await this.env.rpc.ScheduledTaskCreateCommand(TabRpcClient, draft);
            }
            globalStore.set(this.editorOpenAtom, false);
            globalStore.set(this.editingTaskAtom, null);
            await this.refresh();
            return null;
        } catch (e) {
            return String(e);
        }
    }

    async toggleEnabled(task: ScheduledTaskType) {
        if (this.disposed) return;
        const updated = structuredClone(task);
        updated.enabled = !updated.enabled;
        try {
            await this.env.rpc.ScheduledTaskUpdateCommand(TabRpcClient, updated);
            await this.refresh();
        } catch (_) {
            await this.refresh();
        }
    }

    async deleteTask(task: ScheduledTaskType) {
        if (this.disposed) return;
        try {
            await this.env.rpc.ScheduledTaskDeleteCommand(TabRpcClient, task.id);
            await this.refresh();
        } catch (e) {
            globalStore.set(this.errorAtom, String(e));
        }
    }

    async runNow(task: ScheduledTaskType) {
        if (this.disposed) return;
        try {
            await this.env.rpc.ScheduledTaskRunNowCommand(TabRpcClient, task.id);
            globalStore.set(this.statusAtom, `Queued “${task.name}”`);
            setTimeout(() => {
                if (!this.disposed) globalStore.set(this.statusAtom, "");
            }, 3000);
        } catch (e) {
            globalStore.set(this.errorAtom, String(e));
        }
    }

    async openHistory(task: ScheduledTaskType) {
        if (this.disposed) return;
        globalStore.set(this.historyTaskAtom, task);
        globalStore.set(this.historyAtom, []);
        globalStore.set(this.historyOpenAtom, true);
        try {
            const runs = await this.env.rpc.ScheduledTaskHistoryCommand(TabRpcClient, task.id);
            if (this.disposed) return;
            globalStore.set(this.historyAtom, runs ?? []);
        } catch (e) {
            if (this.disposed) return;
            globalStore.set(this.errorAtom, String(e));
        }
    }

    closeHistory() {
        globalStore.set(this.historyOpenAtom, false);
        globalStore.set(this.historyTaskAtom, null);
        globalStore.set(this.historyAtom, []);
    }
}