// queue.json 读写（唯一写者路径）。抽出来是为了可单测，且保证"解析失败绝不静默清空"。
// 参考 agent-autoloop 的失败策略：规则文件坏了 → 继续按旧规则跑 + 告警，
// 而不是当作"规则被删光"（那会让夜间队列凭空消失）。
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOOP_DIR } from './paths.mjs';
import { nowIso } from './ledger-io.mjs';

export const EMPTY_QUEUE = { version: 1, project: 'unknown', packages: [], dropped: [] };

export function queuePaths(dir = LOOP_DIR) {
    return {
        file: join(dir, 'queue.json'),
        lastGood: join(dir, '.queue.last-good.json'),
    };
}

function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * 读队列。
 * - 文件不存在 → 空队列（首次使用，合法）
 * - 解析失败 → **回退到上次成功快照**并告警；没有快照则抛错（绝不静默返回空队列）
 *
 * @returns {{queue:object, source:'file'|'last-good'|'empty', warning:string|null}}
 */
export function loadQueueDetailed({ dir = LOOP_DIR } = {}) {
    const { file, lastGood } = queuePaths(dir);

    if (!existsSync(file)) return { queue: structuredClone(EMPTY_QUEUE), source: 'empty', warning: null };

    try {
        return { queue: readJson(file), source: 'file', warning: null };
    } catch (e) {
        const warning = `queue.json 解析失败（${e.message}）`;
        if (existsSync(lastGood)) {
            try {
                return { queue: readJson(lastGood), source: 'last-good', warning: `${warning} —— 按上次成功快照运行，勿据此入队` };
            } catch {
                /* 快照也坏了，落到下面的抛错 */
            }
        }
        throw new Error(`${warning}，且没有可用的 last-good 快照`);
    }
}

/** 便利包装：只要队列；告警走 onWarn（默认 console.error）。 */
export function loadQueue({ dir = LOOP_DIR, onWarn = console.error } = {}) {
    const { queue, warning } = loadQueueDetailed({ dir });
    if (warning) onWarn(`✗ ${warning}`);
    return queue;
}

/** 原子写 + 同步刷新 last-good 快照。 */
export function saveQueue(queue, { dir = LOOP_DIR } = {}) {
    const { file, lastGood } = queuePaths(dir);
    queue.updatedAt = nowIso();
    const body = JSON.stringify(queue, null, 2) + '\n';
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, file);
    try {
        writeFileSync(lastGood, body, 'utf8');
    } catch {
        /* 快照写不了不影响主流程 */
    }
    return queue;
}
