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
import type { ReactNode } from "react";
import { useRef } from "react";
import { CopyIconButton } from "./controls";
import { formatDateTimeToSecond } from "./utils";
import { useDomTextHighlight } from "./use-dom-highlight";

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

export function MessageCard({
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
      className={cn("group scroll-mt-3", isUser ? "flex flex-col items-end" : "", groupStart ? "mt-4" : "mt-1")}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl",
          // 用户消息：软气泡右对齐；AI 消息：开放散文无框（原型规范）
          isUser ? "max-w-[78%] rounded-br-md border border-accent/25 bg-accent/10 px-3.5 py-2.5" : "w-full px-1 py-0.5",
          searchActive && "ring-2 ring-accent/50"
        )}
      >
        {groupStart ? (
          <div className="mb-1 flex items-center gap-1.5 px-1">
            <span
              className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px]",
                isUser
                  ? "border border-border bg-surface-strong text-secondary"
                  : "bg-accent/15 text-accent"
              )}
            >
              <i className={cn("fa-sharp fa-solid", isUser ? "fa-user" : "fa-robot")} />
            </span>
            {isUser ? <span className="text-xs font-semibold text-primary/90">You</span> : null}
          </div>
        ) : null}
        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-primary">
            {searchMatched && !searchActive ? (
              <span className="mr-1.5 inline-flex items-center gap-1 rounded border border-actionsoftborder bg-actionsoft px-1.5 py-0.5 align-middle text-[10px] text-actionsofttext">
                <i className="fa-sharp fa-solid fa-magnifying-glass" />
                Search match
              </span>
            ) : null}
            <HighlightedMessageText text={shownText} searchQuery={searchQuery} active={searchActive} />
          </div>
        ) : (
          <div ref={mdContentRef} className="min-w-0 text-sm">
            <WaveStreamdown text={shownText} />
          </div>
        )}
      </div>
      {isUser ? (
        // 元信息（时间 + 复制）置于气泡外、下方、右对齐，不在边框内
        <div className="mt-1 flex items-center justify-end gap-1.5 px-1">
          {message.timestamp ? (
            <span className="text-[10px] text-secondary">{formatDateTimeToSecond(message.timestamp)}</span>
          ) : null}
          <CopyIconButton
            text={message.text}
            label="Copy message"
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            size="xs"
          />
        </div>
      ) : (
        // AI：meta 行（时间 + #seq + 复制）落在 prose 之外（左对齐）
        <div className="mt-1 flex items-center justify-start gap-1.5 px-1">
          {message.timestamp ? (
            <span className="text-[10px] text-secondary">{formatDateTimeToSecond(message.timestamp)}</span>
          ) : null}
          <span className="text-[10px] text-secondary/70">#{message.seq}</span>
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
}
