// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunningDot, SessionRow, hiddenTagCount, visibleTagsFor } from "./session-row";

type ElementProps = {
    className?: string;
    children?: ReactNode;
    "aria-label"?: string;
    onClick?: (event: { stopPropagation: () => void }) => void;
};

type TooltipProps = {
    children?: ReactNode;
    content?: ReactNode;
    divClassName?: string;
    hideOnClick?: boolean;
    openDelay?: number;
    placement?: string;
};

function childSpanClasses(node: ReactElement<ElementProps>): string[] {
    const children = node.props.children;
    if (!Array.isArray(children)) return [];
    return children
        .filter((c): c is ReactElement<{ className?: string }> => isValidElement<{ className?: string }>(c))
        .map((c) => c.props.className ?? "");
}

describe("RunningDot", () => {
    it("renders a single breathing dot (no loading spinner) when the session is running", () => {
        const onJumpToBlock = vi.fn();
        const dot = RunningDot({
            runningState: { status: "running", blockId: "block-1", tabId: "tab-1" },
            onJumpToBlock,
        });

        expect(dot).not.toBeNull();
        if (!isValidElement<TooltipProps>(dot)) return;
        expect(dot.props.placement).toBe("top");
        expect(dot.props.openDelay).toBe(200);
        expect(dot.props.hideOnClick).toBe(true);
        expect(dot.props.divClassName?.split(/\s+/)).toContain("inline-flex");
        expect(dot.props.divClassName?.split(/\s+/)).not.toContain("block");
        const tooltipMarkup = renderToStaticMarkup(dot.props.content);
        expect(tooltipMarkup).toContain("This session has a live block in the app.");
        expect(tooltipMarkup).toContain("Click to jump to block");

        const button = dot.props.children;
        expect(isValidElement<ElementProps>(button)).toBe(true);
        if (!isValidElement<ElementProps>(button)) return;
        expect(button.props.className).toContain("h-4");
        expect(button.props.className).toContain("w-4");
        expect(button.props["aria-label"]).toBe("Jump to live block");

        // 视觉契约：**不再**是 animate-spin + 4 个绿点。
        // `animate-spin` 在本仓的既定语义是「请求未完成」，用在长期运行态上是语义错位；
        // 绿色在 agent-status 体系里属于 done，运行中用 --agent-working-color 蓝。
        // 这些断言是防回退的锁，改视觉前先读 session-row.tsx 里 RunningDot 的注释。
        expect(button.props.className).not.toContain("animate-spin");

        const dotSpan = button.props.children;
        expect(isValidElement<ElementProps>(dotSpan)).toBe(true);
        if (!isValidElement<ElementProps>(dotSpan)) return;
        expect(dotSpan.props.className).toContain("session-row-live-dot");
        expect(dotSpan.props.className).not.toContain("bg-success");
        expect(dotSpan.props.className).not.toContain("absolute");

        const stopPropagation = vi.fn();
        button.props.onClick?.({ stopPropagation });
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(onJumpToBlock).toHaveBeenCalledWith({ status: "running", blockId: "block-1", tabId: "tab-1" });
    });

    it("renders nothing when the session is not running", () => {
        expect(RunningDot({ runningState: null, onJumpToBlock: () => {} })).toBeNull();
    });
});

describe("session tag folding", () => {
    const tags = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

    it("shows only the first four tags while collapsed", () => {
        expect(visibleTagsFor(tags, false)).toEqual(["alpha", "beta", "gamma", "delta"]);
        expect(hiddenTagCount(tags, false)).toBe(2);
    });

    it("shows every tag once expanded and hides the +N control", () => {
        expect(visibleTagsFor(tags, true)).toEqual(tags);
        expect(hiddenTagCount(tags, true)).toBe(0);
    });

    it("does not overflow at exactly the visible limit", () => {
        const four = ["a", "b", "c", "d"];
        expect(visibleTagsFor(four, false)).toEqual(four);
        expect(hiddenTagCount(four, false)).toBe(0);
    });

    it("handles empty and oversized lists", () => {
        expect(visibleTagsFor([], false)).toEqual([]);
        expect(hiddenTagCount([], false)).toBe(0);
        expect(hiddenTagCount(["a"], false)).toBe(0);
    });
});

describe("note / tag row markup", () => {
    /** Find the tag overflow control (+N / 收起) in the rendered row. */
    function findOverflowControl(markup: string): RegExpMatchArray | null {
        return markup.match(/<button[^>]*>(\+\d+|Show less)<\/button>/);
    }

    function renderRow(note: string | null, sessionTags: string[], expandAllTags = false): string {
        const session = { key: "k", id: "k", source: "pi", note, tags: sessionTags } as unknown as SessionSummary;
        // SessionRow owns hooks, so it must be rendered as an element (not called).
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
                expandAllTags={expandAllTags}
            />
        );
    }

    it("uses div[role=button] for the note row so the tag button can nest", () => {
        // Six tags → the +N overflow control renders as a real <button> inside the
        // note row, which is why the note row itself must not be a <button>.
        const markup = renderRow("#tag hello", ["a", "b", "c", "d", "e", "f"]);
        expect(markup).toContain('role="button"');
        expect(markup).toContain('tabindex="0"');
        // The nested tag overflow control must be a real button inside it.
        expect(markup).toMatch(/<div[^>]*role="button"[^>]*>[\s\S]*<button/);
    });

    it("renders the +N control when tags exceed the folded limit", () => {
        const markup = renderRow("note", ["a", "b", "c", "d", "e", "f"]);
        expect(findOverflowControl(markup)?.[1]).toBe("+2");
    });

    it("renders no +N control at or below the folded limit", () => {
        const markup = renderRow("note", ["a", "b", "c", "d"]);
        expect(findOverflowControl(markup)).toBeNull();
    });

    it("colors the note text with the same accent as the tag badges", () => {
        const markup = renderRow("plain note body", ["a"]);
        const noteSpan = markup.match(/<span class="[^"]*text-accent[^"]*">plain note body<\/span>/);
        expect(noteSpan).not.toBeNull();
        const tagSpan = markup.match(/<span class="[^"]*text-accent[^"]*">a<\/span>/);
        expect(tagSpan).not.toBeNull();
    });

    it("carries an accessible name on the +N control so it is not a bare +2", () => {
        const markup = renderRow("note", ["a", "b", "c", "d", "e", "f"]);
        expect(markup).toMatch(/aria-label="Show \d+ more tag\(s\)"/);
    });

    it("renders every tag when the global expand-all preference is on", () => {
        const markup = renderRow("note", ["a", "b", "c", "d", "e", "f"], true);
        for (const tag of ["a", "b", "c", "d", "e", "f"]) {
            expect(markup).toContain(`>${tag}</span>`);
        }
        // Expanded by preference: the control now offers to fold, not to expand.
        expect(findOverflowControl(markup)?.[1]).toBe("Show less");
    });

    it("keeps folding when the global preference is off", () => {
        const markup = renderRow("note", ["a", "b", "c", "d", "e", "f"], false);
        expect(findOverflowControl(markup)?.[1]).toBe("+2");
        expect(markup).not.toContain(">e</span>");
        expect(markup).not.toContain(">f</span>");
    });

    it("renders no Show less when tags fit inside the folded limit", () => {
        // 单标签/少标签行没有可折叠内容，全局展开时也不该长出一个点了没反应的按钮。
        const markup = renderRow("note", ["a"], true);
        expect(findOverflowControl(markup)).toBeNull();
        expect(markup).not.toContain("Show less");
    });

    it("wraps the tag row when the global preference is on", () => {
        // 全局展开必须让容器 flex-wrap：否则第 5 个之后的 chip 被 min-w-0 裁掉，
        // 视觉上「点了展开但没展开」。
        const wrapped = renderRow("note", ["a", "b", "c", "d", "e", "f"], true);
        const folded = renderRow("note", ["a", "b", "c", "d", "e", "f"], false);
        const rowClass = /<span class="([^"]*flex-wrap[^"]*)">/.exec(wrapped)?.[1];
        expect(rowClass).toBeTruthy();
        expect(folded).not.toMatch(/<span class="[^"]*flex-wrap[^"]*">/);
    });

    it("does not render a note row when there is no note and no tags", () => {
        const markup = renderRow(null, []);
        expect(markup).not.toContain('role="button"');
        expect(markup).not.toContain("Add a note");
    });
});

describe("created / updated date meta", () => {
    function renderMeta(createdAt: number, updatedAt: number, extra: Partial<SessionSummary> = {}): string {
        const session = {
            key: "k",
            id: "k",
            source: "pi",
            createdAt,
            updatedAt,
            ...extra,
        } as unknown as SessionSummary;
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
            />
        );
    }

    it("renders both the created and the updated date down to the minute when they differ", () => {
        const created = new Date(2020, 0, 2, 9, 0, 0).getTime();
        const updated = new Date(2021, 5, 7, 10, 30, 0).getTime();
        const markup = renderMeta(created, updated);
        // 跨年 → 带年份；时间点精确到分钟；完整时间（到秒）在 title 上。
        expect(markup).toContain("Created 2020-01-02 09:00");
        expect(markup).toContain("2021-06-07 10:30");
        expect(markup).toContain("Created: 2020-01-02 09:00:00");
        expect(markup).toContain("Updated: 2021-06-07 10:30:00");
    });

    it("encodes freshness as the length of a recency bar, not as text opacity", () => {
        const created = new Date(2020, 0, 2, 9, 0, 0).getTime();
        const updated = new Date(2021, 5, 7, 10, 30, 0).getTime();
        // 两年前 → 最陈旧的第 5 档，进度条只剩 6% 的残余。
        const stale = renderMeta(created, updated);
        expect(stale).toContain("width:6%");
        // 刚刚更新 → 满格。
        const fresh = renderMeta(created, Date.now());
        expect(fresh).toContain("width:100%");
    });

    it("keeps the relative age out of the row text but on the bar tooltip", () => {
        const created = new Date(2020, 0, 2, 9, 0, 0).getTime();
        const updated = new Date(2021, 5, 7, 10, 30, 0).getTime();
        const markup = renderMeta(created, updated);
        // 行内文字只剩定点：把标签剥掉后不该再出现 “ago”。
        const textOnly = markup.replace(/<[^>]*>/g, "|");
        expect(textOnly).not.toMatch(/ago/);
        expect(textOnly).toContain("2021-06-07 10:30");
        // 悬停进度条时能读到“多久前” + 完整时间。
        expect(markup).toMatch(/title="Updated \d+d ago · 2021-06-07 10:30:00"/);
    });

    it("omits the created segment when both timestamps share one day", () => {
        const created = new Date(2021, 5, 7, 8, 0, 0).getTime();
        const updated = new Date(2021, 5, 7, 10, 30, 0).getTime();
        const markup = renderMeta(created, updated);
        expect(markup).not.toContain("Created ");
        expect(markup).toContain("2021-06-07");
    });

    it("does not render a created segment when createdAt is missing", () => {
        const updated = new Date(2021, 5, 7, 10, 30, 0).getTime();
        const markup = renderMeta(0, updated);
        expect(markup).not.toContain("Created ");
        expect(markup).toContain("2021-06-07");
    });
});

describe("metric heat cells", () => {
    function renderMetrics(extra: Partial<SessionSummary>): string {
        const session = {
            key: "k",
            id: "k",
            source: "pi",
            createdAt: 0,
            updatedAt: 0,
            ...extra,
        } as unknown as SessionSummary;
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
            />
        );
    }

    it("replaces the raw message count and size text with heat cells", () => {
        const markup = renderMetrics({ messageCount: 500, size: 2 * 1024 * 1024 });
        // 精确数值不再直接印在行里，而是挂到 aria-label/title 上。
        expect(markup).not.toContain("500 msgs");
        expect(markup).toContain("500 messages");
        expect(markup).toContain(`data-heat="metrics"`);
        expect(markup).toContain("bytes)");
        // 消息数 500 是最亮档：整格填满。
        expect(markup).toContain("height:100%");
    });

    it("still renders the message cell when size is unknown", () => {
        const markup = renderMetrics({ messageCount: 3 });
        expect(markup).toContain("3 messages");
        expect(markup).toContain("height:20%");
    });
});

describe("right-side run badge wiring", () => {
    /**
     * 徽章挂在 `row-meta` 末尾并带 `ml-auto`：这是「左粗 / 右细」分工的几何契约。
     * 位置一旦退回标题行或左列，右侧就失去「行内唯一不被 hover 按钮打扰的位置」这个理由。
     */
    function renderRow(extra: Partial<SessionSummary> & { chatRunning?: boolean } = {}): string {
        const { chatRunning, ...sessionExtra } = extra;
        const session = {
            key: "k",
            id: "k",
            source: "pi",
            createdAt: 0,
            updatedAt: 0,
            ...sessionExtra,
        } as unknown as SessionSummary;
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
                chatRunning={chatRunning}
            />
        );
    }

    /**
     * 取 row-meta 那段 html（从 tabular-nums 到 row-meta 的收尾 </div> 之前）。
     *
     * 不能用 `line-clamp`（snippet）当右边界：没有 snippet 的行取不到它，
     * indexOf 返回 -1 → 切片退化成空串，断言会假红（实测踩到）。
     * 这里用 `data-heat` 之后的第一个 </div> 收尾。
     */
    function metaSegment(markup: string): string {
        const start = markup.indexOf("tabular-nums");
        if (start < 0) return "";
        const close = markup.indexOf("</div>", start);
        return close > start ? markup.slice(start, close) : markup.slice(start);
    }

    it("places the badge wrapper inside row-meta with ml-auto", () => {
        // 用 chatRunning 造出「确实有徽章」的行，否则 hasRunBadge=false 就不渲染 wrapper。
        const markup = renderRow({ messageCount: 10, chatRunning: true });
        const meta = metaSegment(markup);
        expect(meta).toContain("ml-auto");
        expect(meta).toContain("shrink-0");
        expect(meta).toContain("session-run-badge");
    });

    it("renders no badge when the session is idle", () => {
        const markup = renderRow({});
        expect(markup).not.toContain("session-run-badge");
        // 没内容时不留空 wrapper：否则末尾多一个零宽元素，`ml-auto` 也没意义。
        expect(markup).not.toContain("ml-auto inline-flex shrink-0");
    });

    it("shows the chat tone when only GUI chat is running", () => {
        const markup = renderRow({ chatRunning: true });
        expect(markup).toContain("session-run-badge");
        expect(markup).toContain("is-chat");
        expect(markup).toContain("Chat");
        // 旧的第二个 spinner 必须已经消失：同一行不该有两个「运行中」标记。
        expect(markup).not.toContain("GUI Chat");
        expect(markup).not.toContain("fa-spinner");
    });
});

describe("persona row chip (A1.5)", () => {
    function renderRow(extra: Partial<SessionSummary> = {}): string {
        const session = {
            key: "k",
            id: "k",
            source: "pi",
            createdAt: 0,
            updatedAt: 0,
            ...extra,
        } as unknown as SessionSummary;
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
            />
        );
    }

    it("renders 🎭 + persona name as a chip when a persona is supplied", () => {
        const markup = renderRow();
        const personaMarkup = renderToStaticMarkup(
            <SessionRow
                session={{ key: "k", id: "k", source: "pi", createdAt: 0, updatedAt: 0 } as unknown as SessionSummary}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
                persona={{ id: "demo", name: "Demo", emoji: "🦊" }}
            />
        );
        expect(personaMarkup).toContain('data-persona-id="demo"');
        expect(personaMarkup).toContain("🎭 Demo");
        // 无 persona 的行（同一条 markup 基线）不应出现行标。
        expect(markup).not.toContain("data-persona-id");
    });

    it("falls back to the bare id when the roster entry is unknown", () => {
        const personaMarkup = renderToStaticMarkup(
            <SessionRow
                session={{ key: "k", id: "k", source: "pi", createdAt: 0, updatedAt: 0 } as unknown as SessionSummary}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
                persona={{ id: "ghost", name: "ghost" }}
            />
        );
        expect(personaMarkup).toContain('data-persona-id="ghost"');
        expect(personaMarkup).toContain("🎭 ghost");
    });
});
