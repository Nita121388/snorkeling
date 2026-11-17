// v2 → v3：门凭据从「整份 gates.json」拆成「一个包一份 loop/gates/<id>.json」。
//
// 为什么：saveQueue 会把内存里的全量 gates 写回整份文件，两个 queue 进程并发时
// 后写的赢，别人刚签的门凭据静默消失（2026-11-17 夹具实测 10 轮丢 6 次）。
//
// 幂等：gates.json 不在了就直接返回；已存在的新格式文件绝不覆盖。
// 回退：旧文件移进 loop/.backup/gates-v2-<ts>/（不是删除）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ dir }) {
    const legacy = join(dir, 'gates.json');
    if (!existsSync(legacy)) return; // 已经迁过，或从未建过

    const out = join(dir, 'gates');
    mkdirSync(out, { recursive: true });
    const store = JSON.parse(readFileSync(legacy, 'utf8'));

    let wrote = 0;
    for (const [id, gates] of Object.entries(store.gates ?? {})) {
        const file = join(out, `${id}.json`);
        if (existsSync(file)) continue; // 新格式已在，不覆盖（否则重跑会拿旧数据打新数据）
        const tmp = `${file}.tmp-${process.pid}`;
        writeFileSync(tmp, JSON.stringify(gates, null, 2) + '\n', 'utf8');
        renameSync(tmp, file);
        wrote++;
    }

    const metaFile = join(out, '_meta.json');
    if (!existsSync(metaFile)) {
        const meta = { version: store.version ?? 2, project: store.project ?? 'unknown', updatedAt: store.updatedAt ?? null };
        writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    }

    // 丢弃记录转成追加日志（append-only，天然可合并）
    const droppedLog = join(out, '_dropped.jsonl');
    const seen = new Set();
    if (existsSync(droppedLog)) {
        for (const line of readFileSync(droppedLog, 'utf8').split('\n')) {
            const t = line.trim();
            if (!t) continue;
            try {
                const d = JSON.parse(t);
                if (d?.id) seen.add(d.id);
            } catch {
                /* 坏行跳过 */
            }
        }
    }
    for (const d of store.dropped ?? []) {
        if (!d?.id || seen.has(d.id)) continue;
        appendFileSync(droppedLog, JSON.stringify(d) + '\n', 'utf8');
        seen.add(d.id);
    }

    // 旧文件留一份可回退副本后移走：两份同时存在会让人以为还在用旧的
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = join(dir, '.backup', `gates-v2-${ts}`);
    mkdirSync(bak, { recursive: true });
    renameSync(legacy, join(bak, 'gates.json'));

    console.log(`  门凭据 ${wrote} 份 → loop/gates/<id>.json；旧文件已移到 ${bak}`);
}
