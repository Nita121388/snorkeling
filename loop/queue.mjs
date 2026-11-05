#!/usr/bin/env node
// queue.mjs — 队列唯一写者 + 只读查询（看板走这里的 --json 契约）
// 用法见 RUNBOOK §8 / implement.md T3。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { LOOP_DIR, REPO_ROOT, safeResolve, assertTrellisWritable } from './lib/paths.mjs';
import { loadQueue, saveQueue, createItem, updateItem, dropItem, PRIORITIES, ORIGINS } from './lib/queue-store.mjs';
import { prdHash, fileHash } from './lib/hash.mjs';
import { classify } from './lib/classify.mjs';
import { gateStateOf, gateProgress, requiredGates, HUMAN_GATES, GATE_LABEL, TASK_TYPES } from './lib/gates.mjs';
import { deriveRunStates, RUN_STATES } from './lib/derive.mjs';
import { appendEvent, readEvents, verifyLedger, nowIso } from './lib/ledger-io.mjs';
import { gateCases, classifyCases } from './lib/fixtures.mjs';
import { parseInbox, markDone, readInbox, writeInbox, archiveDone } from './lib/inbox.mjs';
import { sedimentGate } from './lib/sediment.mjs';

const QUEUE_FILE = join(LOOP_DIR, 'queue.json');
const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'help';
function flag(name, def = null) {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return def;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : true;
}
const has = (n) => argv.includes(`--${n}`) || argv.some((a) => a.startsWith(`--${n}=`));
function die(msg) {
    console.error(`✗ ${msg}`);
    process.exit(1);
}

// ---------- 派生上下文（hash 冻结） ----------
function taskDir(task) {
    if (!task) return null;
    return safeResolve(REPO_ROOT, `.trellis/tasks/${task}`);
}

export function ctxOf(pkg) {
    const dir = taskDir(pkg?.task);
    const ctx = {};
    if (dir && existsSync(join(dir, 'prd.md'))) ctx.prdHash = prdHash(join(dir, 'prd.md'));
    if (dir && existsSync(join(dir, 'implement.md'))) ctx.planHash = fileHash(join(dir, 'implement.md'));
    if (pkg?.rubricPath) {
        const rp = safeResolve(REPO_ROOT, pkg.rubricPath);
        if (existsSync(rp)) ctx.rubricHash = fileHash(rp);
    }
    return ctx;
}

const PRI_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const byRank = (a, b) => (PRI_RANK[a.priority] ?? 2) - (PRI_RANK[b.priority] ?? 2) || (a.order ?? 0) - (b.order ?? 0);

function view(pkg, states) {
    const ctx = ctxOf(pkg);
    const g = gateStateOf(pkg, ctx);
    const prog = gateProgress(pkg, ctx);
    const st = states?.get(pkg.id) ?? { runState: 'idle', parkReason: null, lastTs: null, commit: null };
    return {
        id: pkg.id,
        task: pkg.task,
        title: pkg.title,
        type: pkg.type,
        typeSource: pkg.typeSource,
        priority: pkg.priority ?? 'P2',
        order: pkg.order ?? 0,
        gateState: g.state,
        blockedBy: g.blockedBy,
        blockedReason: g.reason,
        drift: g.drift,
        gatesDone: prog.done,
        gatesTotal: prog.total,
        requiredGates: requiredGates(pkg.type),
        humanGates: requiredGates(pkg.type).filter((x) => HUMAN_GATES.has(x)),
        runState: st.runState,
        parkReason: st.parkReason,
        lastTs: st.lastTs,
        commit: st.commit,
        releaseCandidate: pkg.releaseCandidate === true,
        origin: pkg.origin ?? 'internal',
        reply: pkg.reply ?? 'none',
        pendingRedProof: !(typeof pkg?.gates?.g2?.redProof === 'string' && pkg.gates.g2.redProof.trim() && pkg.gates.g2.redProof !== 'PENDING'),
    };
}

// ---------- git 信号 ----------
function git(args) {
    try {
        return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

function gitSignals(base) {
    const b = base ?? 'HEAD';
    const changed = new Set([...git(['diff', '--name-only', b]), ...git(['ls-files', '--others', '--exclude-standard'])]);
    const added = new Set([...git(['diff', '--name-only', '--diff-filter=A', b]), ...git(['ls-files', '--others', '--exclude-standard'])]);
    const hasRepro = [...added].some((f) => /^(scripts\/verify\/|.*\.test\.(mjs|ts)$)/.test(f));
    return { changedFiles: [...changed], addedFiles: [...added], hasRepro };
}

// ---------- 子命令 ----------
function cmdClassify() {
    const s = gitSignals(flag('base', null));
    const hints = {};
    if (flag('hint')) {
        // --hint type=redesign / --hint behaviorChange=true
        for (const pair of String(flag('hint')).split(',')) {
            const [k, v] = pair.split('=');
            hints[k] = v === 'true' ? true : v;
        }
    }
    if (has('uncertain')) hints.uncertain = true;
    if (has('behavior')) hints.behaviorChange = true;
    const r = classify({ ...s, hints });
    if (has('json')) process.stdout.write(JSON.stringify({ ...r, signalCount: s.changedFiles.length }, null, 2) + '\n');
    else {
        console.log(`type: ${r.type}  (rule: ${r.rule}${r.escalated ? ', escalated' : ''})`);
        console.log(`signals: ${s.changedFiles.length} changed / ${s.addedFiles.length} added / repro=${s.hasRepro}`);
        for (const f of s.changedFiles.slice(0, 12)) console.log(`  · ${f}`);
    }
}

function requirePkg(q, id) {
    const pkg = q.packages.find((p) => p.id === id);
    if (!pkg) die(`包不存在：${id}`);
    return pkg;
}

function cmdAdd() {
    const id = flag('id');
    const type = flag('type');
    if (!id) die('--id 必填');
    if (!type || !TASK_TYPES.includes(type)) die(`--type 必须是 ${TASK_TYPES.join('|')}`);
    const priority = String(flag('priority', 'P2'));
    const q = loadQueue();
    if (q.packages.some((p) => p.id === id) || (q.dropped ?? []).some((p) => p.id === id)) die(`id 已存在（不可复用）：${id}`);
    const item = createItem({
        id,
        title: String(flag('title', id)),
        type,
        priority,
        origin: String(flag('origin', 'self')),
        source: flag('source', null),
        task: flag('task', null),
        order: Number(flag('order', 100)),
        touch: has('touch') ? String(flag('touch')).split(',') : [],
        rollback: flag('rollback', null),
        background: String(flag('background', '')),
    });
    console.log(`+ ${id} (${type} ${item.priority}) → loop/items/${id}.md`);
    console.log('  下一步：补「背景」与「验收判据」两节，再登记 g2 红证');
}

function cmdSetPriority() {
    const id = flag('id');
    const priority = String(flag('priority', ''));
    const by = flag('by');
    if (!priority || !PRIORITIES.includes(priority)) die(`--priority 必须是 ${PRIORITIES.join('|')}`);
    if (!by) die('--by 必填（优先级手改要留痕）');
    const q = loadQueue();
    const pkg = requirePkg(q, id);
    const from = pkg.priority ?? 'P2';
    if (from === priority) return console.log(`= ${id} 已是 ${priority}`);
    updateItem(id, { priority });
    appendEvent({ id, task: pkg.task, action: 'note', shift: flag('shift', 'pm'), verdict: `priority:${from}->${priority}`, evidence: `by ${by}` });
    console.log(`✓ ${id} ${from} → ${priority}（已记入台账）`);
}

function writeConfirmedLine(prdPath, by, at) {
    const abs = safeResolve(REPO_ROOT, prdPath);
    assertTrellisWritable(prdPath);
    const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const line = `> **Confirmed: ${at.slice(0, 10)} @${by}**`;
    const lines = text.split('\n');
    const idx = lines.findIndex((l) => /^>\s*\*\*Confirmed:/.test(l));
    if (idx >= 0) lines[idx] = line;
    else lines.splice(1, 0, '', line);
    writeFileSync(abs, lines.join('\n'), 'utf8');
}

function cmdGate() {
    const id = flag('id');
    const gate = flag('gate');
    const by = flag('by');
    const verdict = flag('verdict', 'confirmed');
    if (!gate || !/^g[1-7]$/.test(String(gate))) die('--gate 必须是 g1..g7');
    const q = loadQueue();
    const pkg = requirePkg(q, id);
    const at = flag('at', nowIso());
    pkg.gates = pkg.gates ?? {};
    const cur = pkg.gates[gate] ?? {};

    switch (gate) {
        case 'g1': {
            if (!by) die('g1 需要 --by <who>');
            const dir = taskDir(pkg.task);
            if (!dir || !existsSync(join(dir, 'prd.md'))) die(`找不到 prd.md（task=${pkg.task}）`);
            pkg.gates.g1 = { at, by, verdict, prdHash: prdHash(join(dir, 'prd.md')) };
            writeConfirmedLine(`.trellis/tasks/${pkg.task}/prd.md`, by, at);
            break;
        }
        case 'g2': {
            const proof = flag('red-proof');
            if (!proof || proof === true) die('g2 需要 --red-proof "<实测输出>"');
            pkg.gates.g2 = { ...cur, redProof: String(proof), at };
            break;
        }
        case 'g3': {
            if (!by) die('g3 需要 --by <who>');
            const ref = flag('ref');
            if (!ref || ref === true) die('g3 需要 --ref <原型目录>');
            safeResolve(REPO_ROOT, String(ref));
            pkg.gates.g3 = { at, by, verdict, ref: String(ref) };
            break;
        }
        case 'g4': {
            if (!by) die('g4 需要 --by <who>');
            const rubric = flag('rubric', pkg.rubricPath);
            if (!rubric || rubric === true) die('g4 需要 --rubric <design-rubric.md 路径> 或在包上设 rubricPath');
            const abs = safeResolve(REPO_ROOT, String(rubric));
            if (!existsSync(abs)) die(`rubric 不存在：${rubric}`);
            pkg.gates.g4 = { at, by, verdict, rubricHash: fileHash(abs), ref: String(rubric) };
            break;
        }
        case 'g5': {
            pkg.gates.g5 = { ok: !has('fail'), executedAt: at, by: by ?? 'compliance' };
            break;
        }
        case 'g6': {
            if (!by) die('g6 需要 --by <who>');
            const dir = taskDir(pkg.task);
            if (!dir || !existsSync(join(dir, 'implement.md'))) die('g6 需要 implement.md');
            pkg.gates.g6 = { at, by, verdict, planHash: fileHash(join(dir, 'implement.md')) };
            break;
        }
        case 'g7': {
            if (!by) die('g7 需要 --by <who>');
            pkg.gates.g7 = { at, by, verdict };
            appendEvent({ id, task: pkg.task, action: 'accept', from: 'committed', to: 'accepted', shift: flag('shift', 'am'), verdict });
            break;
        }
        default:
            die('unreachable');
    }
    saveQueue(q);
    const g = gateStateOf(pkg, ctxOf(pkg));
    console.log(`✓ ${id} ${gate} ${GATE_LABEL[gate]} → ${g.state}`);
}

function cmdApprove() {
    const q = loadQueue();
    const pkg = requirePkg(q, flag('id'));
    const ctx = ctxOf(pkg);
    const g = gateStateOf(pkg, ctx);
    if (g.state !== 'clear') {
        console.error(`✗ 入队被拒：${pkg.id} 停在 ${g.state}（${GATE_LABEL[g.blockedBy]}：${g.reason}）`);
        const miss = requiredGates(pkg.type).filter((x) => ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].includes(x));
        console.error(`  该类型 ${pkg.type} 需要的门：${miss.join(', ')}`);
        process.exit(1);
    }
    appendEvent({ id: pkg.id, task: pkg.task, action: 'approve', from: null, to: 'queued', shift: flag('shift', 'pm') });
    console.log(`✓ ${pkg.id} 已入队`);
}

function cmdList() {
    const q = loadQueue();
    const states = deriveRunStates(readEvents());
    const rows = q.packages.map((p) => view(p, states)).sort(byRank);
    if (has('json')) return process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    const pad = (s, n) => String(s ?? '-').padEnd(n);
    for (const r of rows) {
        const door = `${r.gatesDone}/${r.gatesTotal}`;
        console.log(`${pad(r.id, 26)} ${pad(r.type, 12)} ${pad(r.gateState, 14)} ${pad(r.runState, 10)} ${door} ${r.drift ? 'DRIFT ' : ''}${r.pendingRedProof ? 'noRedProof' : ''}`);
        if (r.blockedBy) console.log(`${''.padEnd(26)} └ ${GATE_LABEL[r.blockedBy]}：${r.blockedReason}`);
    }
}

function cmdDerive() {
    const q = loadQueue();
    const states = deriveRunStates(readEvents());
    const rows = q.packages.map((p) => view(p, states)).sort(byRank);
    const summary = {
        total: rows.length,
        blocked: rows.filter((r) => r.gateState !== 'clear').length,
        queued: rows.filter((r) => r.gateState === 'clear' && ['idle', 'queued'].includes(r.runState)).length,
        running: rows.filter((r) => r.runState === 'running').length,
        toAccept: rows.filter((r) => ['green', 'committed'].includes(r.runState)).length,
        parked: rows.filter((r) => r.runState === 'parked').length,
        red: rows.filter((r) => r.runState === 'red').length,
        drift: rows.filter((r) => r.drift).length,
        pendingRedProof: rows.filter((r) => r.pendingRedProof).length,
        // 夜班能不能开：任何"门已清零但仍待跑"的包都不存在时才算安全（H 门未清零的包本来就不该在队列里）
    };
    summary.nightBlockedByHumanGate = rows.filter(
        (r) => r.gateState !== 'clear' && r.humanGates.includes(r.blockedBy) && ['idle', 'queued'].includes(r.runState)
    ).length;
    summary.canStartNight = summary.nightBlockedByHumanGate === 0;
    if (has('json')) return process.stdout.write(JSON.stringify({ summary, packages: rows }, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
}

function cmdOverrideType() {
    const q = loadQueue();
    const pkg = requirePkg(q, flag('id'));
    const type = flag('type');
    const by = flag('by');
    if (!type || !TASK_TYPES.includes(type)) die(`--type 必须是 ${TASK_TYPES.join('|')}`);
    if (!by) die('--by 必填（覆写必须留痕）');
    updateItem(pkg.id, { type, typeSource: 'override', overriddenBy: { at: nowIso(), by, from: pkg.type } });
    appendEvent({ id: pkg.id, task: pkg.task, action: 'note', shift: 'pm', verdict: `type-override:${type}`, evidence: `by ${by}` });
    console.log(`✓ ${pkg.id} type → ${type} (by ${by})`);
}

function cmdDrop() {
    const q = loadQueue();
    const pkg = requirePkg(q, flag('id'));
    const reason = flag('reason');
    if (!reason || reason === true) die('--reason 必填（丢弃必须留原因）');
    const to = dropItem(pkg.id, String(reason));
    appendEvent({ id: pkg.id, task: pkg.task, action: 'drop', to: 'dropped', shift: 'pm', verdict: String(reason) });
    console.log(`✗ ${pkg.id} 已丢弃：${reason}\n  归档 → ${to}`);
}

function cmdRender() {
    const q = loadQueue();
    const states = deriveRunStates(readEvents());
    const rows = q.packages.map((p) => view(p, states)).sort(byRank);
    const md =
        `<!-- generated by loop/queue.mjs render — do not edit -->\n\n` +
        `# QUEUE\n\n> 生成于 ${nowIso()} · 真相源 \`loop/queue.json\`（人/看板经 \`queue.mjs\` 写）\n\n` +
        `| 包 | 优先级 | 类型 | 门 | 门状态 | 运行 | 说明 |\n|---|---|---|---|---|---|---|\n` +
        rows
            .map(
                (r) =>
                    `| \`${r.id}\` | ${r.priority ?? 'P2'} | ${r.type} | ${r.gatesDone}/${r.gatesTotal} | ${r.gateState}${r.drift ? ' ⚠drift' : ''} | ${r.runState} | ${r.blockedBy ? `${GATE_LABEL[r.blockedBy]}：${r.blockedReason}` : r.title ?? ''} |`
            )
            .join('\n') +
        `\n`;
    writeFileSync(join(LOOP_DIR, 'QUEUE.md'), md, 'utf8');

    // INDEX.md：按优先级分组的层次结构（人的入口）
    const groups = new Map();
    for (const r of rows) {
        const p = r.priority ?? 'P2';
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(r);
    }
    const order = ['P0', 'P1', 'P2', 'P3'];
    const idx =
        `<!-- generated by loop/queue.mjs render — do not edit -->\n\n# 工作项索引\n\n> 生成于 ${nowIso()} · 真相源 \`loop/items/*.md\`（人写）+ \`loop/gates.json\`（机器写）\n` +
        order
            .filter((p) => groups.has(p))
            .map((p) => {
                const list = groups.get(p);
                const lines = list.map((r) => {
                    const door = r.gateState === 'clear' ? '门已清' : `${GATE_LABEL[r.blockedBy] ?? ''}待办`;
                    return `- [${r.runState === 'released' ? 'x' : ' '}] \`${r.id}\` — ${r.title ?? ''} · ${r.type} · ${r.origin} · ${door}`;
                });
                return `\n## ${p}（${list.length}）\n\n${lines.join('\n')}\n`;
            })
            .join('');
    writeFileSync(join(LOOP_DIR, 'INDEX.md'), idx, 'utf8');
    console.log(`wrote loop/QUEUE.md + loop/INDEX.md (${rows.length} packages)`);
}

// ---------- INBOX：人自己的随手记录 + 分诊 ----------
function cmdInbox() {
    const items = parseInbox(readInbox());
    if (has('json')) return process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    if (!items.length) return console.log('INBOX 空 ✓');
    for (const it of items) console.log(`${String(it.n).padStart(2)}. ${it.text}${it.source !== 'self' ? `  @${it.source}` : ''}`);
    console.log(`\n${items.length} 条待分诊。处置: triage --n <编号> --to-package [--id X --type t] | --to-task | --drop --reason <文本>`);
}

function generateId(n) {
    const d = new Date();
    const mmdd = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    return `N-${mmdd}-inbox${n}`;
}

function cmdTriage() {
    const n = Number(flag('n'));
    if (!Number.isInteger(n) || n < 1) die('--n <编号> 必填（先跑 queue.mjs inbox 看编号）');
    const md = readInbox();
    const item = parseInbox(md).find((i) => i.n === n);
    if (!item) die(`INBOX 没有第 ${n} 条未处置项`);

    const markResolved = (verdict, evidence = null) => {
        const r = markDone(md, n);
        if (!r) die(`勾掉第 ${n} 条失败（INBOX 可能被并发修改）`);
        writeInbox(archiveDone(r.text, {}).markdown);
        appendEvent({ id: null, action: 'note', shift: flag('shift', 'am'), verdict, evidence });
    };

    if (has('to-package')) {
        const type = flag('type');
        if (!type || !TASK_TYPES.includes(type)) die(`--to-package 需要 --type（${TASK_TYPES.join('|')}）`);
        const priority = String(flag('priority', 'P2'));
        const q = loadQueue();
        const id = String(flag('id', generateId(n)));
        if (q.packages.some((p) => p.id === id)) die(`包 id 已存在：${id}`);
        createItem({
            id,
            title: item.text,
            type,
            priority,
            origin: item.source === 'self' ? 'self' : item.source,
            source: `INBOX #${n}（${item.source}）`,
            task: flag('task', null),
            order: Number(flag('order', 100)),
            background: String(flag('note', '')),
        });
        markResolved(`inbox:to-package:${id}`, 'loop/items');
        return console.log(`✓ #${n} → loop/items/${id}.md（${type} ${priority}）`);
    }

    if (has('to-task')) {
        const slug = String(item.text).replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 30).replace(/^-|-$/g, '') || `inbox-${n}`;
        markResolved(`inbox:to-task:${slug}`);
        console.log(`✓ #${n} 已移入待建任务。执行下面这行（本工具不代你建任务）：\n\n  python .trellis/scripts/task.py create "${item.text}" --slug ${slug} -p P1 -d "来自 INBOX #${n}（${item.source}）"\n`);
        return;
    }

    if (has('drop')) {
        const reason = flag('reason');
        if (!reason || reason === true) die('--drop 需要 --reason <文本>（必有归宿）');
        markResolved(`drop:${reason}`);
        return console.log(`✗ #${n} 已丢弃：${reason}`);
    }

    die('必须选一个归宿：--to-package | --to-task | --drop --reason <文本>');
}

// ---------- G8 沉淀门 ----------
function cmdG8() {
    const g = sedimentGate(readEvents());
    if (has('json')) {
        process.stdout.write(JSON.stringify(g, null, 2) + '\n');
    } else if (g.ok) {
        console.log(`g8 ok ✓（${g.repeated.length} 个重复问题均有沉淀）`);
    } else {
        for (const m of g.missing) console.error(`✗ ${m.key} 重复 ${m.count} 次未沉淀（${m.ids.join(', ')}）`);
        console.error(`  修：node loop/ledger.mjs add --action note --verdict "sediment:${g.missing[0].key}" --evidence <规范路径>`);
    }
    process.exit(g.ok ? 0 : 1);
}

function cmdVerifyLedger() {
    const problems = verifyLedger();
    if (problems.length) {
        for (const p of problems) console.error(`✗ ${p}`);
        process.exit(1);
    }
    console.log('ledger ok');
}

function cmdSelfTest() {
    const expectBroken = has('expect') && flag('expect') === 'broken';
    if (expectBroken) process.env.LOOP_SLOPPY = '1';

    const results = [];
    const run = (name, fn) => {
        try {
            fn();
            results.push({ name, ok: true });
        } catch (e) {
            results.push({ name, ok: false, err: e.message });
        }
    };
    const eq = (a, b, m) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m ?? ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
    };

    for (const c of gateCases) {
        run(`gate: ${c.name}`, () => eq(gateStateOf(c.pkg, c.ctx).state, c.expect));
    }
    for (const c of classifyCases) {
        run(`classify: ${c.name}`, () => eq(classify(c.signals).type, c.expect));
    }
    run('queue.json 可解析且包 id 唯一', () => {
        const q = loadQueue();
        const ids = q.packages.map((p) => p.id);
        eq(new Set(ids).size, ids.length, 'id 重复');
    });
    run('每包 type 合法且 accept/touch 有结构', () => {
        const q = loadQueue();
        for (const p of q.packages) {
            if (!TASK_TYPES.includes(p.type)) throw new Error(`${p.id} type 非法`);
            if (!Array.isArray(p.accept)) throw new Error(`${p.id} accept 非数组`);
            if (!Array.isArray(p.touch) || p.touch.length === 0) throw new Error(`${p.id} touch 为空（等于无边界）`);
        }
    });
    run('approve 负向：缺门必须拒（推导）', () => {
        const bad = { id: 'selftest', type: 'arch', gates: {} };
        if (gateStateOf(bad, {}).state === 'clear') throw new Error('缺凭据却判 clear');
    });

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    for (const r of results.filter((x) => !x.ok)) console.error(`  ✗ ${r.name}: ${r.err}`);
    console.log(`queue self-test: ${passed} passed, ${failed} failed${expectBroken ? ' (expected-red)' : ''}`);
    process.exit(expectBroken ? (failed > 0 ? 0 : 1) : failed === 0 ? 0 : 1);
}

const help = `queue.mjs — loop 队列（唯一写者）

  classify [--base <ref>] [--hint k=v] [--uncertain] [--behavior] [--json]
  add --id <id> --type <type> [--priority P0..P3] [--origin self|issue|pr|community|social] [--task <d>] [--title <t>] [--order N]
  set-priority --id <id> --priority P0..P3 --by <who>   # 手改优先级，留痕入台账
  gate --id <id> --gate g1..g7 [--by <who>] [--red-proof <out>] [--ref <dir>] [--rubric <path>] [--fail]
  approve --id <id>              # 门未清零则拒绝（exit 1）
  list [--json]
  derive [--json]
  override-type --id <id> --type <t> --by <who>
  drop --id <id> --reason <text>
  render
  verify-ledger
  inbox [--json]                      # 你自己的随手记录（loop/INBOX.md）
  triage --n <编号> --to-package [--id X --type t] | --to-task | --drop --reason <文本>
  g8 [--json]                         # 沉淀门：同类问题第二次必须先写规范
  self-test [--expect=broken]

类型：${TASK_TYPES.join(' | ')}
`;

switch (cmd) {
    case 'classify':
        cmdClassify();
        break;
    case 'add':
        cmdAdd();
        break;
    case 'gate':
        cmdGate();
        break;
    case 'approve':
        cmdApprove();
        break;
    case 'list':
        cmdList();
        break;
    case 'derive':
        cmdDerive();
        break;
    case 'override-type':
        cmdOverrideType();
        break;
    case 'drop':
        cmdDrop();
        break;
    case 'render':
        cmdRender();
        break;
    case 'verify-ledger':
        cmdVerifyLedger();
        break;
    case 'inbox':
        cmdInbox();
        break;
    case 'triage':
        cmdTriage();
        break;
    case 'g8':
        cmdG8();
        break;
    case 'set-priority':
        cmdSetPriority();
        break;
    case 'self-test':
        cmdSelfTest();
        break;
    default:
        process.stdout.write(help);
}
