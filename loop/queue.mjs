#!/usr/bin/env node
// queue.mjs — 队列唯一写者 + 只读查询（看板走这里的 --json 契约）
// 用法见 RUNBOOK §8 / implement.md T3。
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { LOOP_DIR, REPO_ROOT, safeResolve, assertTrellisWritable } from './lib/paths.mjs';
import { prdHash, fileHash } from './lib/hash.mjs';
import { classify } from './lib/classify.mjs';
import { gateStateOf, gateProgress, requiredGates, HUMAN_GATES, GATE_LABEL, TASK_TYPES } from './lib/gates.mjs';
import { deriveRunStates, RUN_STATES } from './lib/derive.mjs';
import { appendEvent, readEvents, verifyLedger, nowIso } from './lib/ledger-io.mjs';
import { gateCases, classifyCases } from './lib/fixtures.mjs';

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

// ---------- queue.json IO ----------
export function loadQueue() {
    if (!existsSync(QUEUE_FILE)) return { version: 1, project: 'unknown', packages: [], dropped: [] };
    return JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
}

function saveQueue(q) {
    q.updatedAt = nowIso();
    const tmp = join(dirname(QUEUE_FILE), `.queue.json.tmp-${process.pid}`);
    writeFileSync(tmp, JSON.stringify(q, null, 2) + '\n', 'utf8');
    renameSync(tmp, QUEUE_FILE); // 同盘 rename = 原子
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
    const q = loadQueue();
    if (q.packages.some((p) => p.id === id) || (q.dropped ?? []).some((p) => p.id === id)) die(`id 已存在（不可复用）：${id}`);
    const pkg = {
        id,
        task: flag('task', null),
        title: flag('title', id),
        type,
        typeSource: 'manual',
        order: Number(flag('order', 100)),
        accept: [],
        touch: [],
        rollback: null,
        budget: { minutes: 40, retries: 2 },
        gates: {},
        releaseCandidate: false,
        createdAt: nowIso(),
    };
    q.packages.push(pkg);
    saveQueue(q);
    console.log(`+ ${id} (${type})`);
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
    const rows = q.packages.map((p) => view(p, states)).sort((a, b) => a.order - b.order);
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
    const rows = q.packages.map((p) => view(p, states)).sort((a, b) => a.order - b.order);
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
    pkg.overriddenBy = { at: nowIso(), by, from: pkg.type };
    pkg.type = type;
    pkg.typeSource = 'override';
    saveQueue(q);
    appendEvent({ id: pkg.id, task: pkg.task, action: 'note', shift: 'pm', verdict: `type-override:${type}` });
    console.log(`✓ ${pkg.id} type → ${type} (by ${by})`);
}

function cmdDrop() {
    const q = loadQueue();
    const pkg = requirePkg(q, flag('id'));
    const reason = flag('reason');
    if (!reason || reason === true) die('--reason 必填（丢弃必须留原因）');
    q.packages = q.packages.filter((p) => p !== pkg);
    q.dropped = q.dropped ?? [];
    q.dropped.push({ id: pkg.id, task: pkg.task, reason: String(reason), at: nowIso() });
    saveQueue(q);
    appendEvent({ id: pkg.id, task: pkg.task, action: 'drop', to: 'dropped', shift: 'pm', verdict: String(reason) });
    console.log(`✗ ${pkg.id} 已丢弃：${reason}`);
}

function cmdRender() {
    const q = loadQueue();
    const states = deriveRunStates(readEvents());
    const rows = q.packages.map((p) => view(p, states)).sort((a, b) => a.order - b.order);
    const md =
        `<!-- generated by loop/queue.mjs render — do not edit -->\n\n` +
        `# QUEUE\n\n> 生成于 ${nowIso()} · 真相源 \`loop/queue.json\`（人/看板经 \`queue.mjs\` 写）\n\n` +
        `| 包 | 类型 | 门 | 门状态 | 运行 | 说明 |\n|---|---|---|---|---|---|\n` +
        rows
            .map(
                (r) =>
                    `| \`${r.id}\` | ${r.type} | ${r.gatesDone}/${r.gatesTotal} | ${r.gateState}${r.drift ? ' ⚠drift' : ''} | ${r.runState} | ${r.blockedBy ? `${GATE_LABEL[r.blockedBy]}：${r.blockedReason}` : r.title ?? ''} |`
            )
            .join('\n') +
        `\n`;
    writeFileSync(join(LOOP_DIR, 'QUEUE.md'), md, 'utf8');
    console.log(`wrote loop/QUEUE.md (${rows.length} packages)`);
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
  add --id <id> --type <type> [--task <taskdir>] [--title <t>] [--order N]
  gate --id <id> --gate g1..g7 [--by <who>] [--red-proof <out>] [--ref <dir>] [--rubric <path>] [--fail]
  approve --id <id>              # 门未清零则拒绝（exit 1）
  list [--json]
  derive [--json]
  override-type --id <id> --type <t> --by <who>
  drop --id <id> --reason <text>
  render
  verify-ledger
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
    case 'self-test':
        cmdSelfTest();
        break;
    default:
        process.stdout.write(help);
}
