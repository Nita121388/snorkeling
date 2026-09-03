// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat message cards for the AI sessions detail pane.
// - Assistant messages: streaming-grade markdown via WaveStreamdown (open
//   prose, no bubble — mockup spec). Text-level search highlight uses the CSS
//   Custom Highlight API so we never fight React over wrapped <mark> nodes.
// - User messages: plain-text right-aligned bubble (chat convention: no md
//   parsing of user input), classic <mark> highlighting.
// Long-message auto-collapse was removed: it was built for history browsing;
// the realtime chat flow renders everything (pagination lives upstream).

import { WaveStreamdown } from "@/app/element/streamdown";
import { cn } from "@/util/util";
import type { CSSProperties, ReactNode } from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CopyIconButton } from "./controls";
import { formatDateTimeToSecond } from "./utils";
import { useDomTextHighlight } from "./use-dom-highlight";

// ── Thinking Ticker：思考过程单行滚动预览（Ref: Lyra ThinkingBlock.tsx Ticker） ──
const FADE = 24;
const LOOP_GAP = 44;
const SPEED = 46;

/** 将思考文本按段落分割为 runs */
function thinkingRuns(text: string): string[] {
    return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function Ticker({ text, mode }: { text: string; mode: "follow" | "loop" }) {
    const boxRef = useRef<HTMLSpanElement>(null);
    const trackRef = useRef<HTMLSpanElement>(null);
    const runs = useMemo(() => thinkingRuns(text), [text]);
    const [loop, setLoop] = useState<{ distance: number; duration: number } | null>(null);

    useLayoutEffect(() => {
        const outer = boxRef.current;
        const inner = trackRef.current;
        if (!outer || !inner) return;
        const measure = () => {
            if (mode === "follow") {
                const overflow = Math.max(0, inner.offsetWidth - outer.clientWidth);
                inner.style.transform = `translateX(${-overflow}px)`;
                const fade = overflow > 0 ? `${FADE}px` : "0px";
                outer.style.setProperty("--ly-fade-left", fade);
                outer.style.setProperty("--ly-fade-right", fade);
                return;
            }
            const width = Math.round((inner.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0);
            const overflow = width - outer.clientWidth;
            const distance = width + LOOP_GAP;
            const duration = Math.max(2200, Math.round((distance / SPEED) * 1000));
            setLoop((prev) => {
                if (overflow <= 1) return prev === null ? prev : null;
                return prev && Math.abs(prev.distance - distance) <= 1 ? prev : { distance, duration };
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(outer);
        return () => observer.disconnect();
    }, [runs, mode]);

    const looping = mode === "loop" && loop !== null;
    const copy = (hidden: boolean) => (
        <span aria-hidden={hidden || undefined} className="ly-think-runs">
            {runs.map((run, index) => (
                <span key={index}>{run}</span>
            ))}
        </span>
    );

    return (
        <span
            ref={boxRef}
            aria-hidden
            className={cn("ly-think-ticker")}
            style={
                looping
                    ? ({ "--ly-marquee": `-${loop.distance}px`, "--ly-scroll": `${loop.duration}ms` } as CSSProperties)
                    : undefined
            }
        >
            <span ref={trackRef} className={looping ? "ly-marquee-track" : "ly-think-track"}>
                {copy(false)}
                {looping && copy(true)}
            </span>
        </span>
    );
}

// ── 工具专属图标映射（Ref: Lyra ToolCard.tsx ICONS） ──
const TOOL_ICONS: Record<string, string> = {
    read: "fa-file-lines",
    write: "fa-file-circle-plus",
    edit: "fa-file-code",
    ls: "fa-folder-tree",
    glob: "fa-magnifying-glass",
    grep: "fa-magnifying-glass",
    bash: "fa-terminal",
    bash_output: "fa-terminal",
    todo_write: "fa-list-check",
    task: "fa-users",
    skill: "fa-wand-magic-sparkles",
    web_fetch: "fa-globe",
};
function toolIcon(name: string): string {
    return TOOL_ICONS[name] ?? "fa-terminal";
}

// ── 可展开详情容器：用 ResizeObserver 实测高度做过渡（Ref: Lyra ToolGroup） ──
function AnimatedExpand({ open, children }: { open: boolean; children: ReactNode }) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const measure = () => setHeight(el.scrollHeight);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [children, open]);

    return (
        <div
            style={{ height: open ? height : 0 }}
            className="overflow-hidden transition-[height] duration-200 ease-out"
        >
            <div ref={bodyRef} className="border-t border-border px-3 py-2">
                {children}
            </div>
        </div>
    );
}

// 思考块（Paseo 风格：与工具调用同式的可展开徽章行）。
// streaming=true 时默认展开看实时内容，行头用脉冲点+脉冲标签表示“正在思考”；
// 状态收尾/历史消息默认折叠为单行（chevron + 首行预览），点击展开全文。
// 工具调用行（流式 live 与落盘历史共用同一外观，保证 turn_end 交接时视觉不断裂）：
// chevron + 状态点/旋转圈 + 等宽工具名 + 单行预览，点击展开详情。
// running = spinner + ly-shimmer 扫光；完成后换静态状态点。
// animateStatus 仅在 live 完成瞬间播 ly-pop；历史回填不闪。
export function ToolCallRow({
  name,
  preview,
  status,
  exitCode,
  expanded,
  onToggle,
  animateStatus = false,
  children,
}: {
  name: string;
  preview: string;
  status?: "running" | "completed" | "failed";
  exitCode?: number;
  expanded: boolean;
  onToggle: () => void;
  animateStatus?: boolean;
  children?: ReactNode;
}) {
  const hasError = status === "failed" || Boolean(exitCode);
  const running = status === "running";
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [running]);
  return (
    <div className={cn("relative my-1 min-w-0 overflow-hidden rounded-lg text-xs", running && "ly-rail")}>
      <button
        type="button"
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-hover"
        onClick={onToggle}
      >
        <i
          className={cn(
            "fa-sharp fa-solid shrink-0 text-[9px] text-secondary transition-transform duration-200",
            expanded ? "fa-chevron-down" : "fa-chevron-right"
          )}
        />
        {running ? (
          <i className="fa-sharp fa-solid fa-spinner inline-flex h-1.5 w-1.5 shrink-0 animate-spin items-center justify-center text-[10px] text-accent" />
        ) : (
          <span
            className={cn(
              "inline-flex h-1.5 w-1.5 shrink-0 items-center justify-center rounded-full",
              hasError ? "bg-error shadow-[0_0_4px_var(--color-error)]" : "bg-accent/70",
              animateStatus && "ly-pop"
            )}
          />
        )}
        <i className={cn("fa-sharp fa-solid shrink-0 text-[10px]", toolIcon(name), running ? "text-accent animate-pulse" : "text-secondary/70")} />
        <span className="shrink-0 font-mono text-[11px] text-primary">{name || "tool"}</span>
        {exitCode != null && exitCode !== 0 ? (
          <span className="shrink-0 rounded bg-error/15 px-1 py-px text-[9px] font-medium text-error">
            exit {exitCode}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[11px] text-secondary">{preview}</span>
        {running && elapsed > 0 && (
          <span className="shrink-0 tabular-nums text-[10px] text-accent/80">{elapsed}s</span>
        )}
      </button>
      <AnimatedExpand open={expanded}>
        {children}
      </AnimatedExpand>
      {running ? <span className="ly-shimmer" /> : null}
    </div>
  );
}

export function ThinkingDisclosure({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const trimmed = text.trim();
  // 用户点击优先于默认状态；未操作时跟随 streaming（流式展开 / 完结折叠）。
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? streaming;
  if (!trimmed) return null;
  const preview = trimmed.split(/\r?\n/, 1)[0];
  return (
    <div className="my-1 min-w-0 text-xs">
      <button
        type="button"
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-hover"
        onClick={() => setUserToggled(!open)}
      >
        <i
          className={cn(
            "fa-sharp fa-solid shrink-0 text-[9px] text-secondary transition-transform duration-200",
            open ? "fa-chevron-down" : "fa-chevron-right"
          )}
        />
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            streaming ? "animate-pulse bg-accent shadow-[0_0_4px_var(--color-accent)]" : "bg-accent/70"
          )}
        />
        <span className={cn("shrink-0 font-mono text-[11px]", streaming ? "animate-pulse text-primary" : "text-primary")}>
          Thinking
        </span>
        {!open ? (
            <span className="min-w-0 flex-1 overflow-hidden">
                <Ticker key={streaming ? "follow" : "loop"} text={trimmed} mode={streaming ? "follow" : "loop"} />
            </span>
        ) : null}
      </button>
      <AnimatedExpand open={open}>
        <div className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded bg-panel p-2 text-[11px] leading-4 text-secondary font-sans">
          <WaveStreamdown text={trimmed} parseIncompleteMarkdown />
          {streaming ? <span className="ly-cursor" /> : null}
        </div>
      </AnimatedExpand>
    </div>
  );
}

export function HighlightedMessageText({
  text,
  searchQuery,
  active = false,
}: {
  text: string;
  searchQuery?: string;
  active?: boolean;
}) {
  const query = searchQuery?.trim() ?? "";
  if (query === "") {
    return <>{text}</>;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);
  let key = 0;
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const end = matchIndex + query.length;
    parts.push(
      <mark
        key={`match-${key++}`}
        className={cn("rounded bg-actionsoft px-0.5 text-inherit", active && "ring-1 ring-accent")}
      >
        {text.slice(matchIndex, end)}
      </mark>
    );
    cursor = end;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}

export const MessageCard = memo(function MessageCard({
  message,
  registerRef,
  searchQuery,
  searchActive = false,
  groupStart = true,
}: {
  message: Message;
  registerRef: (node: HTMLDivElement | null) => void;
  searchQuery?: string;
  searchActive?: boolean;
  /** 是否为同角色连续消息分组的开头（决定上间距 + 组头） */
  groupStart?: boolean;
}) {
  const isUser = message.role === "user";
  const normalizedSearchQuery = searchQuery?.trim().toLowerCase() ?? "";
  const searchMatched =
    normalizedSearchQuery !== "" && message.text.toLowerCase().includes(normalizedSearchQuery);
  // whitespace-pre-wrap 会原样保留首尾换行；消息原文常带前导/尾部空行，去一下。
  const shownText = message.text.replace(/^\s+|\s+$/g, "");
  // AI 消息是 markdown 渲染，文本级高亮走 CSS Custom Highlight API（不改 DOM）；
  // 用户消息仍是纯文本，直接 <mark> 包裹（HighlightedMessageText）。
  const mdContentRef = useRef<HTMLDivElement>(null);
  useDomTextHighlight(
    `aisession-search-${message.seq}`,
    mdContentRef,
    normalizedSearchQuery,
    !isUser && normalizedSearchQuery !== "",
    shownText
  );
  return (
    <div
      ref={registerRef}
      id={`aisession-message-${message.seq}`}
      className={cn("group scroll-mt-3 ly-enter", isUser ? "flex flex-col items-end" : "", groupStart ? "mt-4" : "mt-1")}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl",
          // 用户消息：软气泡右对齐；AI 消息：开放散文无框（原型规范）
          isUser ? "max-w-[78%] rounded-br-md border border-accent/25 bg-accent/10 px-3.5 py-2.5" : "w-full px-1 py-0.5",
          searchActive && "ring-2 ring-accent/50"
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-primary">
            {searchMatched && !searchActive ? (
              <span className="mr-1.5 inline-flex items-center gap-1 rounded border border-actionsoftborder bg-actionsoft px-1.5 py-0.5 align-middle text-[10px] text-actionsofttext">
                <i className="fa-sharp fa-solid fa-magnifying-glass" />
                Search match
              </span>
            ) : null}
            <HighlightedMessageText text={shownText} searchQuery={searchQuery} active={searchActive} />
          </div>
        ) : (
          <div ref={mdContentRef} className="min-w-0 text-[12px]">
            {/* 思考过程：从会话历史还原，以 Paseo 风格徽章行折叠展示（点击展开全文） */}
            {message.thinking ? <ThinkingDisclosure text={message.thinking} /> : null}
            <WaveStreamdown text={shownText} parseIncompleteMarkdown />
          </div>
        )}
      </div>
      {isUser ? (
        // 元信息（时间 + 复制）置于气泡外、下方、右对齐，不在边框内
        <div className="mt-1 flex items-center justify-end gap-1.5 px-1">
          {message.timestamp ? (
            <span className="text-[10px] text-secondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {formatDateTimeToSecond(message.timestamp)}
            </span>
          ) : null}
          <CopyIconButton
            text={message.text}
            label="Copy message"
            size="xs"
          />
        </div>
      ) : (
        // AI：meta 行（时间 + #seq + 复制）落在 prose 之外（左对齐）
        <div className="mt-1 flex items-center justify-start gap-1.5 px-1">
          {message.timestamp ? (
            <span className="text-[10px] text-secondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {formatDateTimeToSecond(message.timestamp)}
            </span>
          ) : null}
          <span className="text-[10px] text-secondary/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            #{message.seq}
          </span>
          <CopyIconButton
            text={message.text}
            label="Copy message"
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            size="xs"
          />
        </div>
      )}
    </div>
  );
}, (previous, next) =>
  previous.message === next.message &&
  previous.searchQuery === next.searchQuery &&
  previous.searchActive === next.searchActive &&
  previous.groupStart === next.groupStart
);
MessageCard.displayName = "MessageCard";
