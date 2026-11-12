// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setting 原语（jsdom）：
//
//   1. 行：组内无线（不发丝线）、58px 最小行高类、disabled 降透明度，attrs 透传到行 DOM。
//   2. RadioCard：选中态类 + 勾点；flag / warn 渲染；radio input 真实存在（键盘可达）；
//      点 label 等价于点 radio（验证台用 .click() 打在行容器上）。
//   3. RadioRow：选中态点，整行 label 可点。
//   4. SaveBar：dirty=false 时 Save 禁用 —— 一屏一个保存位置的红线。
//   5. AdvancedSection：aria-expanded 与开合渲染一致。
//   6. SignalBars：level → data-signal-level + aria-label。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AdvancedSection,
    RadioCard,
    RadioCardGroup,
    RadioRow,
    RadioRowGroup,
    SaveBar,
    SettingGroup,
    SettingRow,
    SignalBars,
} from "./setting-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
});

function render(node: React.ReactNode) {
    act(() => {
        root?.render(node);
    });
}

describe("SettingRow", () => {
    it("renders title + description and passes attrs through to the row DOM", () => {
        render(
            <SettingRow
                title="File path"
                description="A commontext.json inside a synced folder."
                attrs={{ "data-sync-row": "folder-path" }}
            >
                <span>ctrl</span>
            </SettingRow>
        );
        const row = container!.querySelector('[data-sync-row="folder-path"]');
        expect(row).not.toBeNull();
        expect(row!.textContent).toContain("File path");
        expect(row!.textContent).toContain("commontext.json");
        expect(row!.className).toContain("min-h-[58px]");
        // 组内无发丝线：原语不允许出现 divide-y
        expect(row!.className).not.toContain("divide-y");
    });

    it("dims the whole row when disabled", () => {
        render(<SettingRow title="t" description="d" disabled={true} />);
        expect(container!.firstElementChild!.className).toContain("opacity-45");
    });
});

describe("SettingGroup", () => {
    it("renders the title outside the card and extra beside it", () => {
        render(
            <SettingGroup title="Status" extra={<span>live</span>}>
                <SettingRow title="row" description="" />
            </SettingGroup>
        );
        const group = container!.querySelector("[data-setting-group]")!;
        const heading = group.querySelector("h2")!;
        expect(heading.textContent).toContain("Status");
        expect(heading.textContent).toContain("live");
        // 卡在 h2 之后，不在 h2 之内
        expect(heading.parentElement).toBe(group);
    });
});

describe("RadioCard", () => {
    it("marks the selected card and keeps a real radio input for keyboard access", () => {
        render(
            <RadioCardGroup name="transport">
                <RadioCard
                    name="transport"
                    value="folder"
                    selected={true}
                    onSelect={() => {}}
                    title="Local folder"
                    description="commontext.json in a synced folder."
                    flag="recommended"
                    warn="Set a file path first."
                />
                <RadioCard name="transport" value="git" selected={false} onSelect={() => {}} title="Git" />
            </RadioCardGroup>
        );
        const cards = container!.querySelectorAll("label");
        expect(cards.length).toBe(2);
        expect(cards[0].className).toContain("border-accent");
        expect(cards[0].className).toContain("bg-actionsoft");
        expect(cards[1].className).not.toContain("bg-actionsoft");
        expect(cards[0].textContent).toContain("recommended");
        expect(cards[0].textContent).toContain("Set a file path first.");
        const input = cards[0].querySelector('input[type="radio"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.checked).toBe(true);
        expect((cards[1].querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(false);
    });

    it("selects via a click on the card body (label semantics), not just the hidden input", () => {
        const onSelect = vi.fn();
        render(
            <RadioCardGroup name="transport">
                <RadioCard
                    name="transport"
                    value="server"
                    selected={false}
                    onSelect={onSelect}
                    title="Self-hosted service"
                    attrs={{ "data-sync-transport": "server" }}
                />
            </RadioCardGroup>
        );
        const card = container!.querySelector('[data-sync-transport="server"]') as HTMLElement;
        expect(card).not.toBeNull();
        act(() => {
            card.click();
        });
        expect(onSelect).toHaveBeenCalledWith("server");
    });
});

describe("RadioRow", () => {
    it("selects when the row is clicked and reflects the selected dot", () => {
        const onSelect = vi.fn();
        render(
            <RadioRowGroup name="policy">
                <RadioRow name="policy" value="row-merge" selected={true} onSelect={onSelect} title="Merge per row" />
                <RadioRow name="policy" value="newest" selected={false} onSelect={onSelect} title="Newest wins" />
            </RadioRowGroup>
        );
        const rows = container!.querySelectorAll("label");
        expect(rows[0].className).toContain("cursor-pointer");
        act(() => {
            rows[1].click();
        });
        expect(onSelect).toHaveBeenCalledWith("newest");
    });
});

describe("SaveBar", () => {
    it("disables Save when the draft is clean", () => {
        const onSave = vi.fn();
        render(<SaveBar dirty={false} onSave={onSave} hint="Draft" />);
        const btn = container!.querySelector("button:last-of-type") as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        act(() => {
            btn.click();
        });
        expect(onSave).not.toHaveBeenCalled();
    });

    it("enables Save when dirty and wires Discard", () => {
        const onSave = vi.fn();
        const onDiscard = vi.fn();
        render(<SaveBar dirty={true} onSave={onSave} onDiscard={onDiscard} />);
        const buttons = container!.querySelectorAll("button");
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent).toBe("Discard");
        act(() => {
            buttons[0].click();
            buttons[1].click();
        });
        expect(onDiscard).toHaveBeenCalled();
        expect(onSave).toHaveBeenCalled();
    });
});

describe("AdvancedSection", () => {
    it("renders children only when open, and reflects aria-expanded", () => {
        const onToggle = vi.fn();
        render(
            <AdvancedSection title="Advanced" open={false} onToggle={onToggle}>
                <div data-advanced-child="">hidden</div>
            </AdvancedSection>
        );
        let head = container!.querySelector("[data-setting-advanced] button") as HTMLButtonElement;
        expect(head.getAttribute("aria-expanded")).toBe("false");
        expect(container!.querySelector("[data-advanced-child]")).toBeNull();
        act(() => {
            head.click();
        });
        expect(onToggle).toHaveBeenCalledTimes(1);
        // 重新以 open=true 渲染，子内容出现
        render(
            <AdvancedSection title="Advanced" open={true} onToggle={onToggle}>
                <div data-advanced-child="">shown</div>
            </AdvancedSection>
        );
        head = container!.querySelector("[data-setting-advanced] button") as HTMLButtonElement;
        expect(head.getAttribute("aria-expanded")).toBe("true");
        expect(container!.querySelector("[data-advanced-child]")?.textContent).toBe("shown");
    });
});

describe("SignalBars", () => {
    it("maps level to data-signal-level and aria-label", () => {
        render(<SignalBars level={4} label="reachable" />);
        const el = container!.querySelector("[data-signal-level]") as HTMLElement;
        expect(el.getAttribute("data-signal-level")).toBe("4");
        expect(el.getAttribute("role")).toBe("img");
        expect(el.getAttribute("aria-label")).toBe("reachable");
    });
});
