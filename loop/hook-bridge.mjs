#!/usr/bin/env node
// hook-bridge.mjs — Trellis 生命周期钩子 → LEDGER 事件（自动记账，人无需手记）
// 注册位置：.trellis/config.yaml 的 hooks: 段（shell=True, cwd=repo root, TASK_JSON_PATH env）
// 设计：design.md §7。**绝不失败到影响 task.py**：任何异常写 .hook-errors.log 后 exit 0。
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { LOOP_DIR, REPO_ROOT, safeResolve } from './lib/paths.mjs';
import { appendEvent, readEvents, nowIso } from './lib/ledger-io.mjs';
import { deriveRunStates } from './lib/derive.mjs';

const EVENT_MAP = {
    created: { action: 'create', to: 'idle' },
    started: { action: 'start', to: 'queued' },
    archived: { action: 'archive', to: null },
};

function logError(detail) {
    try {
        appendFileSync(join(LOOP_DIR, '.hook-errors.log'), `${nowIso()} ${detail}\n`, 'utf8');
    } catch {
        /* 连日志都写不了也不能影响 task.py */
    }
    console.error(`[loop-hook] ${detail}`);
}

function loadQueueIfAny() {
    const f = join(LOOP_DIR, 'queue.json');
    if (!existsSync(f)) return null;
    try {
        return JSON.parse(readFileSync(f, 'utf8'));
    } catch (e) {
        logError(`queue.json 解析失败：${e.message}`);
        return null;
    }
}

function idempotentSkip(task, action) {
    // 同一任务同一动作在同一分钟内只记一次（防重试/重复触发）
    const cut = new Date(Date.now() - 60 * 1000).toISOString();
    return readEvents().some((e) => e.task === task && e.action === action && String(e.ts) >= cut);
}

function main() {
    const event = process.argv[2] ?? '';
    const map = EVENT_MAP[event];
    if (!map) {
        logError(`未知事件：${event}（可选 ${Object.keys(EVENT_MAP).join('/')}）`);
        return;
    }

    const taskJsonPath = process.env.TASK_JSON_PATH;
    if (!taskJsonPath || !existsSync(taskJsonPath)) {
        logError(`${event}: TASK_JSON_PATH 缺失或不存在（${taskJsonPath ?? 'undefined'}）`);
        return;
    }

    let task;
    try {
        task = JSON.parse(readFileSync(taskJsonPath, 'utf8'));
    } catch (e) {
        logError(`${event}: task.json 解析失败：${e.message}`);
        return;
    }

    const taskDir = basename(join(taskJsonPath, '..'));
    if (idempotentSkip(taskDir, map.action)) {
        console.error(`[loop-hook] skip duplicate ${taskDir}/${map.action}`);
        return;
    }

    const queue = loadQueueIfAny();
    const pkg = queue?.packages?.find((p) => p.task === taskDir) ?? null;

    let to = map.to;
    if (event === 'archived') {
        // 归档：已验收 → released；否则不改状态（由人判断是否算完成）
        const states = deriveRunStates(readEvents());
        const cur = states.get(pkg?.id ?? '__none__')?.runState;
        to = cur === 'accepted' ? 'released' : null;
    }

    const ev = appendEvent({
        shift: 'hook',
        id: pkg?.id ?? null,
        task: taskDir,
        action: map.action,
        from: null,
        to,
        evidence: null,
        commit: task?.commit ?? null,
        verdict: event === 'archived' && to === null ? `archived-unreleased:${task?.status ?? '?'}` : null,
    });
    console.error(`[loop-hook] ${taskDir} ${ev.action}${ev.to ? ` → ${ev.to}` : ''}`);
}

try {
    main();
} catch (e) {
    logError(`未捕获异常：${e?.stack ?? e}`);
}
process.exit(0);
