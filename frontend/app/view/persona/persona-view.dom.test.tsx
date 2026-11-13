// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A4 roster block — DOM smoke tests (PRD 假设 1: 组件单测断言空态 / 行渲染).
//
// The view itself is a dumb renderer over the pure model, so the fake model here
// wires real jotai atoms (same derivation as PersonaViewModel) without touching
// the RPC layer.

// @vitest-environment jsdom

import { Provider, atom, createStore } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonaView, type PersonaViewModel } from "./persona";
import { PersonaCreateCommand, deriveRosterRows } from "./persona-model";

function makeEntry(overrides: Partial<PersonaOverviewEntry> = {}): PersonaOverviewEntry {
    return {
        persona: {
            schemaVersion: 1,
            id: "backup-guard",
            name: "备份卫",
            emoji: "🛡️",
            role: "管备份与归档",
            provider: "pi",
            model: "deepseek-v3",
            createdAt: "2026-11-01T00:00:00Z",
        },
        charter: "# 备份卫 — 职责书（CHARTER）\n\n## 职责\n\n- 管备份\n",
        storage: {
            id: "backup-guard",
            archiveBytes: 2048,
            archiveFiles: 3,
            historyBytes: 1024,
            historyFiles: 2,
            workBytes: 512,
            workFiles: 1,
            totalBytes: 3584,
            syncableBytes: 3072,
        },
        pendingProposals: 2,
        lastJournalLine: "- 2026-11-13 归档了一批备份",
        ...overrides,
    };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function makeModel(overview: AISessionsPersonaOverviewResponse) {
    const store = createStore();
    const overviewAtom = atom(overview);
    const selectedIdAtom = atom("");
    const rowsAtom = atom((get) => deriveRosterRows(get(overviewAtom)));
    const selectedRowAtom = atom((get) => {
        const rows = get(rowsAtom);
        return rows.find((row) => row.id === get(selectedIdAtom)) ?? rows[0] ?? null;
    });
    const model = {
        overviewAtom,
        loadingAtom: atom(false),
        errorAtom: atom(""),
        selectedIdAtom,
        rowsAtom,
        selectedRowAtom,
        env: { atoms: { fullConfigAtom: atom({}) } },
        select: (id: string) => store.set(selectedIdAtom, id),
        refresh: vi.fn(),
        launch: vi.fn(async () => "block-id"),
    } as unknown as PersonaViewModel;
    return { model, store };
}

function render(model: PersonaViewModel, store: ReturnType<typeof createStore>) {
    act(() => {
        root.render(
            <Provider store={store}>
                <PersonaView blockId="block-1" model={model} />
            </Provider>
        );
    });
}

function rowButtons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll("button")).filter((button) =>
        (button.textContent ?? "").includes("🛡️")
    ) as HTMLButtonElement[];
}

describe("PersonaView", () => {
    it("shows the CLI create guidance when the roster is empty", () => {
        const { model, store } = makeModel({ root: "/home/me/.snorkeling/personas", personas: [] });
        render(model, store);
        expect(container.textContent).toContain(PersonaCreateCommand);
        expect(container.textContent).toContain("0 total");
    });

    it("renders one list row per persona with role, provider/model, journal line and ⚡ count", () => {
        const { model, store } = makeModel({
            root: "/home/me/.snorkeling/personas",
            personas: [makeEntry()],
        });
        render(model, store);
        const rows = rowButtons();
        expect(rows).toHaveLength(1);
        const text = rows[0].textContent ?? "";
        expect(text).toContain("备份卫");
        expect(text).toContain("管备份与归档");
        expect(text).toContain("pi / deepseek-v3");
        expect(text).toContain("归档了一批备份");
        expect(text).toContain("⚡2");
        expect(container.textContent).toContain("1 total");
    });

    it("shows the CHARTER body and the copyable approval commands in the detail pane", () => {
        const { model, store } = makeModel({
            root: "/home/me/.snorkeling/personas",
            personas: [makeEntry()],
        });
        render(model, store);
        expect(container.textContent).toContain("CHARTER");
        expect(container.textContent).toContain("管备份");
        expect(container.textContent).toContain("wsh persona memory inbox backup-guard");
        expect(container.textContent).toContain("wsh persona memory approve backup-guard <stamp> --yes");
        expect(container.textContent).toContain("Confirm");
    });

    it("switches the detail pane when another row is selected", () => {
        const { model, store } = makeModel({
            root: "/home/me/.snorkeling/personas",
            personas: [
                makeEntry(),
                makeEntry({
                    persona: {
                        schemaVersion: 1,
                        id: "night-watch",
                        name: "守夜人",
                        emoji: "🌙",
                        role: "盯夜间任务",
                        createdAt: "2026-11-02T00:00:00Z",
                    },
                    pendingProposals: 0,
                    charter: "# 守夜人 — 职责书\n",
                }),
            ],
        });
        render(model, store);
        const target = Array.from(container.querySelectorAll("button")).find((button) =>
            (button.textContent ?? "").includes("守夜人")
        ) as HTMLButtonElement;
        expect(target).toBeTruthy();
        act(() => {
            target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(container.textContent).toContain("night-watch");
        expect(container.textContent).toContain("No pending memory proposals");
    });
});
