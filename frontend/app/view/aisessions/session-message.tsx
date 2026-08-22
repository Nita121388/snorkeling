// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { CopyIconButton } from "./controls";
import { formatDateTimeToSecond, isCollapsibleMessage, trimMessageText } from "./utils";

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
  collapsed,
  onToggleCollapsed,
  registerRef,
  searchQuery,
  searchActive = false,
  groupStart = true,
}: {
  message: Message;
  collapsed?: boolean;
  onToggleCollapsed: () => void;
  registerRef: (node: HTMLDivElement | null) => void;
  searchQuery?: string;
  searchActive?: boolean;
  /** 是否为同角色连续消息分组的开头（决定上间距 + 角色标签） */
  groupStart?: boolean;
}) {
  const isUser = message.role === "user";
  const collapsible = isCollapsibleMessage(message.text);
  const effectiveCollapsed = collapsed ?? collapsible;
  const normalizedSearchQuery = searchQuery?.trim().toLowerCase() ?? "";
  const searchMatched = normalizedSearchQuery !== "" && message.text.toLowerCase().includes(normalizedSearchQuery);
  const collapsedShownText = trimMessageText(message.text);
  const collapsedSearchShown =
    normalizedSearchQuery !== "" && collapsedShownText.toLowerCase().includes(normalizedSearchQuery);
  // 展开后用全文，不再受 trimMessageText 的 2400 字截断；只在折叠时截断
  const useFullText = !effectiveCollapsed || (searchActive && searchMatched && !collapsedSearchShown);
  // whitespace-pre-wrap 会原样保留首尾换行；纯文本消息原文常带前导/尾部空行，
  // 这里只去掉首尾空白，保留中间换行避免把消息内容压扁。
  const shownText = (useFullText ? message.text : collapsedShownText).replace(/^\s+|\s+$/g, "");
  const searchShown = normalizedSearchQuery !== "" && shownText.toLowerCase().includes(normalizedSearchQuery);
  const shouldClampText = effectiveCollapsed && !(searchActive && searchMatched && !collapsedSearchShown);
  return (
    <div
      ref={registerRef}
      id={`aisession-message-${message.seq}`}
      className={cn("group scroll-mt-3", isUser ? "flex justify-end" : "", groupStart ? "mt-4" : "mt-1")}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl",
          // 用户消息：软气泡右对齐；AI 消息：开放散文无框（原型规范）
          isUser ? "max-w-[85%] border border-accent/25 bg-accent/10 px-4 py-2.5" : "w-full px-1 py-0.5",
          searchActive && "ring-2 ring-accent/50"
        )}
      >
      {groupStart && !isUser ? (
        <div className="mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
          {message.role === "assistant" ? "Assistant" : message.role}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-1.5 text-xxs text-secondary">
        {collapsible ? (
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
            title={effectiveCollapsed ? "Expand message" : "Collapse message"}
            aria-label={effectiveCollapsed ? "Expand message" : "Collapse message"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed();
            }}
          >
            <i
              className={cn(
                "fa-sharp fa-solid text-[10px]",
                effectiveCollapsed ? "fa-chevron-down" : "fa-chevron-up"
              )}
            />
          </button>
        ) : null}
        <CopyIconButton
          text={message.text}
          label="Copy message"
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          size="xs"
        />
      </div>
      <div
        className={cn(
          "whitespace-pre-wrap break-words leading-relaxed",
          isUser ? "text-[13px] text-primary" : "text-xs text-primary/95",
          shouldClampText && "line-clamp-4"
        )}
      >
        <span
          className="mr-1.5 inline-flex h-5 min-w-[20px] shrink-0 cursor-pointer items-center justify-center rounded border border-border bg-bg px-1 text-[10px] leading-none text-secondary hover:bg-hover hover:text-primary"
          title={message.timestamp ? formatDateTimeToSecond(message.timestamp) : undefined}
          onClick={collapsible ? onToggleCollapsed : undefined}
        >
          {message.seq}
        </span>
        {searchMatched ? (
          <span className="inline-flex items-center gap-1 rounded border border-actionsoftborder bg-actionsoft px-1.5 py-0.5 text-[10px] text-actionsofttext">
            <i className="fa-sharp fa-solid fa-magnifying-glass" />
            {searchActive
              ? "Current match"
              : effectiveCollapsed && !searchShown
                ? "Match in collapsed text"
                : "Search match"}
          </span>
        ) : null}
        <HighlightedMessageText text={shownText} searchQuery={searchQuery} active={searchActive} />
      </div>
      </div>
    </div>
  );
}
