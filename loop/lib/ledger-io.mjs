// LEDGER 读写（append-only 事件流）。被 ledger.mjs / queue.mjs / hook-bridge.mjs 共用。
import { readdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOOP_DIR } from './paths.mjs';

export const REQUIRED_FIELDS = ['ts', 'action'];

export function ledgerFiles(dir = LOOP_DIR) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => /^LEDGER-\d{4}-\d{2}\.jsonl$/.test(f))
        .sort()
        .map((f) => join(dir, f));
}

export function ledgerFileFor(ts, dir = LOOP_DIR) {
    const month = String(ts).slice(0, 7);
    return join(dir, `LEDGER-${month}.jsonl`);
}

/** 读取全部事件；`strict` 时遇到坏行抛错（verify-ledger 用）。 */
export function readEvents({ dir = LOOP_DIR, strict = false } = {}) {
    const events = [];
    for (const file of ledgerFiles(dir)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
            const t = line.trim();
            if (!t) return;
            try {
                const ev = JSON.parse(t);
                events.push(ev);
            } catch (e) {
                if (strict) throw new Error(`${file}:${i + 1} 不是合法 JSON：${e.message}`);
            }
        });
    }
    return events;
}

export function validateEvent(ev) {
    const problems = [];
    for (const f of REQUIRED_FIELDS) if (!ev[f]) problems.push(`缺字段 ${f}`);
    if ('from' in ev && ev.from !== null && typeof ev.from !== 'string') problems.push('from 必须是 string|null');
    if ('to' in ev && ev.to !== null && typeof ev.to !== 'string') problems.push('to 必须是 string|null');
    return problems;
}

export function verifyLedger(dir = LOOP_DIR) {
    const problems = [];
    for (const file of ledgerFiles(dir)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
            const t = line.trim();
            if (!t) return;
            let ev;
            try {
                ev = JSON.parse(t);
            } catch (e) {
                problems.push(`${file}:${i + 1} 非法 JSON：${e.message}`);
                return;
            }
            for (const p of validateEvent(ev)) problems.push(`${file}:${i + 1} ${p}`);
        });
    }
    return problems;
}

/** 追加一行。单行 < 4KB，appendFile 在多写者下安全。字段顺序固定，方便 diff。 */
export function appendEvent(ev, dir = LOOP_DIR) {
    const ts = ev.ts ?? nowIso();
    const full = {
        ts,
        shift: ev.shift ?? 'hook',
        id: ev.id ?? null,
        task: ev.task ?? null,
        action: ev.action,
        from: ev.from ?? null,
        to: ev.to ?? null,
        evidence: ev.evidence ?? null,
        commit: ev.commit ?? null,
        verdict: ev.verdict ?? null,
    };
    const line = JSON.stringify(full);
    if (line.length >= 4096) throw new Error('ledger event 行过长（>=4KB），请把内容放报告而不是台账');
    appendFileSync(ledgerFileFor(ts, dir), line + '\n', 'utf8');
    return full;
}

export function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
