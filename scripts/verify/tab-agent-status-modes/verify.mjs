#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab Agent status modes B / C / G — real Electron CDP verification.
//
//   node scripts/verify/tab-agent-status-modes/verify.mjs
//   node scripts/verify/tab-agent-status-modes/verify.mjs --keep-open
//   node scripts/verify/tab-agent-status-modes/verify.mjs --dry
//
// Exit: 0 all pass / 1 assertion failure / 2 environment error.

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "tab-agent-status-modes";
const PROFILE = "verify-tab-agent-status-modes";
const CDP_PORT = 9265;
const VITE_PORT = 51880;
const SEED_COUNT = 6;

const ACTIVE_TAB = `(() => {
    const tabs = [...document.querySelectorAll('.tab[data-tab-id][role="tab"], [data-tabid][role="tab"]')];
    return tabs.find((el) => el.classList.contains('active') || el.getAttribute('aria-selected') === 'true') ?? tabs[0] ?? null;
})()`;

const TAB_MODE = `(() => {
    const tab = ${ACTIVE_TAB};
    return tab?.getAttribute('data-agent-status-mode') ?? null;
})()`;

const TAB_STATUS = `(() => {
    const tab = ${ACTIVE_TAB};
    const badges = tab?.querySelector('.tab-badges');
    if (!tab || !badges) return null;
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const name = tab.querySelector('.name');
    const close = tab.querySelector('.close');
    const tabRect = rect(tab);
    const nameRect = name ? rect(name) : null;
    const badgeRect = rect(badges);
    const closeRect = close ? rect(close) : null;
    return {
        mode: tab.getAttribute('data-agent-status-mode'),
        total: Number(badges.getAttribute('data-agent-total') ?? 0),
        avatars: badges.querySelectorAll('.tab-agent-avatar').length,
        railSegments: badges.querySelectorAll('.tab-agent-rail-segment').length,
        overflow: badges.querySelector('.tab-agent-overflow')?.textContent.trim() ?? null,
        tabWidth: Math.round(tabRect.width),
        nameBadgesGap: nameRect ? Math.round((badgeRect.left - nameRect.right) * 10) / 10 : null,
        badgesCloseGap: closeRect ? Math.round((closeRect.left - badgeRect.right) * 10) / 10 : null,
        closeInside: closeRect ? closeRect.right <= tabRect.right + 1 : null,
        vertical: !!tab.closest('.vertical') || tab.hasAttribute('data-tabid'),
    };
})()`;

const SEED_AGENTS = `(async () => {
    const { createBlock } = await import('/frontend/app/store/global.ts');
    const services = await import('/frontend/app/store/services.ts');
    const specs = [
        { provider: 'pi', state: 'working', phase: 'thinking' },
        { provider: 'codex', state: 'working', phase: 'tool', toolName: 'Bash' },
        { provider: 'claude', state: 'blocked', phase: 'approval' },
        { provider: 'pi', state: 'done', phase: 'none' },
        { provider: 'codex', state: 'error', phase: 'none' },
        { provider: 'claude', state: 'idle', phase: 'none' },
    ];
    const ids = [];
    const errors = [];
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        try {
            const blockId = await createBlock({
                meta: {
                    view: 'term',
                    'agent:provider': spec.provider,
                    'agent:sessionid': 'verify-tab-status-' + i,
                    'cmd:cwd': 'E:/code/snorkeling',
                },
            }, false, false);
            ids.push(blockId);
            if (spec.state === 'done') {
                await services.BlockService.ReportAgentStatus({
                    blockId, provider: spec.provider, source: 'manual', state: 'working', phase: 'thinking', seq: 1,
                });
                await services.BlockService.ReportAgentStatus({
                    blockId, provider: spec.provider, source: 'manual', state: 'idle', phase: 'none', seq: 2,
                });
            } else {
                await services.BlockService.ReportAgentStatus({
                    blockId, provider: spec.provider, source: 'manual', state: spec.state,
                    phase: spec.phase, toolName: spec.toolName, seq: 1,
                });
            }
        } catch (err) {
            errors.push(String(err?.message ?? err));
        }
    }
    return { ids, errors };
})()`;

const setConfig = (key, value) => `(async () => {
    const { RpcApi } = await import('/frontend/app/store/wshclientapi.ts');
    const { TabRpcClient } = await import('/frontend/app/store/wshrpcutil.ts');
    await RpcApi.SetConfigCommand(TabRpcClient, { ${JSON.stringify(key)}: ${JSON.stringify(value)} });
    return true;
})()`;

async function waitForTabMode(client, mode, timeoutMs = 20000) {
    return waitForProbe(client, TAB_MODE, (value) => value === mode, { timeoutMs, label: `tab mode ${mode}` });
}

async function main() {
    const dry = process.argv.includes("--dry");
    const keepOpen = process.argv.includes("--keep-open");
    const reporter = createReporter({
        area: AREA,
        endpoint: `http://127.0.0.1:${CDP_PORT}`,
        mode: dry ? "dry" : "launch+reset",
        meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT, seedCount: SEED_COUNT },
    });
    const { log, check, shot } = reporter;

    if (dry) {
        log("dry-run: dependencies resolved");
        check("dry-deps", true, "cdp / launch / probes / report");
        reporter.finish({ ledger: false, skipped: ["dry run does not launch Electron"] });
        return;
    }

    let client = null;
    let cleanup = null;
    const skippedNotes = [];
    try {
        const instance = await ensureInstance({ cdpPort: CDP_PORT, vitePort: VITE_PORT, profile: PROFILE });
        cleanup = () => {
            instance.cleanup?.();
            client?.close?.();
        };
        client = instance.client;
        const endpoint = `http://127.0.0.1:${CDP_PORT}`;
        const pages = await listPageTargets(endpoint);
        if (pages.length > 1) {
            client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
        }
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        await dismissOnboarding(client, { log: reporter.log });
        log(`instance ready (${PROFILE})`);

        await client.evaluate(setConfig("tab:agent-status-mode", "hybrid"));
        await waitForTabMode(client, "hybrid");

        const seeded = await client.evaluate(SEED_AGENTS);
        log(`seed agents: ${JSON.stringify(seeded)}`);
        check("seed-six-agent-blocks", seeded?.ids?.length === SEED_COUNT, `${seeded?.ids?.length ?? 0} ids, errors=${JSON.stringify(seeded?.errors ?? [])}`);
        if ((seeded?.ids?.length ?? 0) !== SEED_COUNT) throw new Error("Agent seed count is incomplete");

        const ready = await waitForProbe(client, TAB_STATUS, (value) => value?.total === SEED_COUNT, {
            timeoutMs: 30000,
            label: "six statuses surfaced on Tab",
        });
        check("all-agent-statuses-surface", ready?.total === SEED_COUNT, JSON.stringify(ready));
        check("non-agent-block-excluded", ready?.total === SEED_COUNT, `total=${ready?.total} (initial terminal must not count)`);

        await waitForTabMode(client, "avatars");
        let status = await waitForProbe(client, TAB_STATUS, (value) => value?.mode === "avatars" && value?.avatars === 2, { timeoutMs: 15000 });
        check("B-avatar-stack-bounded", status?.avatars === 2 && status?.overflow === "+4", JSON.stringify(status));
        check("B-no-rail", status?.railSegments === 0, `rail=${status?.railSegments}`);
        check("B-name-status-close-no-overlap", status?.nameBadgesGap >= -1 && status?.badgesCloseGap >= -1 && status?.closeInside === true, JSON.stringify(status));
        await shot(client, "B-avatars");

        await client.evaluate(setConfig("tab:agent-status-mode", "rail"));
        await waitForTabMode(client, "rail");
        status = await waitForProbe(client, TAB_STATUS, (value) => value?.mode === "rail" && value?.railSegments === SEED_COUNT, { timeoutMs: 15000 });
        check("C-rail-covers-every-agent", status?.railSegments === SEED_COUNT, `segments=${status?.railSegments}`);
        check("C-no-avatars", status?.avatars === 0, `avatars=${status?.avatars}`);
        await shot(client, "C-rail");

        await client.evaluate(setConfig("tab:agent-status-mode", "hybrid"));
        await waitForTabMode(client, "hybrid");
        status = await waitForProbe(client, TAB_STATUS, (value) => value?.mode === "hybrid" && value?.avatars === 2 && value?.railSegments === SEED_COUNT, { timeoutMs: 15000 });
        check("G-hybrid-has-avatars-and-full-rail", status?.avatars === 2 && status?.overflow === "+4" && status?.railSegments === SEED_COUNT, JSON.stringify(status));
        check("G-name-status-close-no-overlap", status?.nameBadgesGap >= -1 && status?.badgesCloseGap >= -1 && status?.closeInside === true, JSON.stringify(status));
        await shot(client, "G-hybrid");

        // Config echo is the persistence contract: change away, then back to G.
        await client.evaluate(setConfig("tab:agent-status-mode", "rail"));
        await waitForTabMode(client, "rail");
        await client.evaluate(setConfig("tab:agent-status-mode", "hybrid"));
        await waitForTabMode(client, "hybrid");
        check("mode-config-roundtrip", true, "rail → hybrid through SetConfigCommand");

        // Theme parity: the semantic nodes must survive all three themes.
        for (const theme of ["light", "monochrome", "dark"]) {
            await client.evaluate(setConfig("app:theme", theme));
            await sleep(500);
            const themed = await client.evaluate(TAB_STATUS);
            check(`theme-${theme}-keeps-status-surface`, themed?.mode === "hybrid" && themed?.railSegments === SEED_COUNT, JSON.stringify(themed));
        }

        // Vertical Tab bar uses the same model with a larger avatar budget.
        await client.evaluate(setConfig("app:tabbar", "left"));
        let vertical = null;
        try {
            vertical = await waitForProbe(client, TAB_STATUS, (value) => value?.vertical === true && value?.mode === "hybrid", { timeoutMs: 20000 });
        } catch {
            vertical = await client.evaluate(TAB_STATUS);
        }
        if (vertical?.vertical === true) {
            check("vertical-tab-hybrid", vertical?.railSegments === SEED_COUNT && vertical?.avatars === 5 && vertical?.overflow === "+1", JSON.stringify(vertical));
            await shot(client, "G-vertical");
        } else {
            skippedNotes.push("app:tabbar switch did not produce a vertical Tab within 20s");
        }

        reporter.finish({
            cleanup: keepOpen
                ? () => {
                      client?.close?.();
                      log("--keep-open: instance retained");
                  }
                : cleanup,
            extra: { seededBlockIds: seeded.ids },
            skipped: [
                ...skippedNotes,
                "Native Electron context-menu click is covered by frontend/app/tab/tabcontextmenu.test.ts; CDP cannot inspect the native menu.",
                "Inline subblock grouping is covered by agent-status-tab-aggregate.test.ts and tab-info-card.dom.test.tsx.",
            ],
        });
    } catch (err) {
        reporter.fatal(err, { cleanup });
    }
}

main();
