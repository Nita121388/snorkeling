// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useContext } from "react";
import clsx from "clsx";
import {
    getOrderedListItemId,
    getSourceLine,
    OrderedListContext,
    splitOrderedListItemChildren,
    srcLineAttrs,
} from "./shared";

export const MarkdownOrderedList = ({
    props,
    collapsible,
}: {
    props: React.OlHTMLAttributes<HTMLOListElement>;
    collapsible: boolean;
}) => (
    <OrderedListContext.Provider value={collapsible}>
        <ol {...props} {...srcLineAttrs(props)} />
    </OrderedListContext.Provider>
);

export const MarkdownUnorderedList = (props: React.HTMLAttributes<HTMLUListElement>) => (
    <OrderedListContext.Provider value={false}>
        <ul {...props} {...srcLineAttrs(props)} />
    </OrderedListContext.Provider>
);

export const CollapsibleOrderedListItem = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.LiHTMLAttributes<HTMLLIElement>;
    collapsed: boolean;
    onToggle: (itemId: string) => void;
}) => {
    const sourceLine = getSourceLine(props);
    const itemId = getOrderedListItemId(props);
    const { summaryChildren, bodyChildren } = splitOrderedListItemChildren(props.children);
    const canCollapse = bodyChildren.length > 0 && itemId.length > 0;
    if (!canCollapse) {
        return <li {...props} {...srcLineAttrs(props)} />;
    }
    return (
        <li
            {...props}
            {...srcLineAttrs(props)}
            className={clsx(props.className, "ordered-list-collapsible", { collapsed })}
        >
            <div className="ordered-list-summary-row">
                <button
                    type="button"
                    className="ordered-list-collapse-button"
                    title={collapsed ? "Expand list item" : "Collapse list item"}
                    aria-label={collapsed ? "Expand list item" : "Collapse list item"}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggle(itemId);
                    }}
                >
                    <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
                </button>
                <div className="ordered-list-summary-content">{summaryChildren}</div>
            </div>
            {collapsed ? null : <div className="ordered-list-collapse-body">{bodyChildren}</div>}
        </li>
    );
};

export const MarkdownListItem = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.LiHTMLAttributes<HTMLLIElement>;
    collapsed: boolean;
    onToggle: (itemId: string) => void;
}) => {
    const orderedListCollapsible = useContext(OrderedListContext);
    if (orderedListCollapsible) {
        return <CollapsibleOrderedListItem props={props} collapsed={collapsed} onToggle={onToggle} />;
    }
    return <li {...props} {...srcLineAttrs(props)} />;
};

// Clickable task-list checkbox (Note surface). The parent <li> carries data-source-line;
// the click flips `[ ]` ⇄ `[x]` on exactly that source line via the caller's commit path —
// no editor session, no full-document re-serialization. Only mounted when the Markdown
// instance got onInlineEditCommit, so read-only contexts (vdom, AI panels) keep the default
// disabled checkbox.
export const MarkdownTaskCheckbox = ({
    props,
    onToggle,
}: {
    props: React.InputHTMLAttributes<HTMLInputElement>;
    onToggle: (line: number) => void;
}) => {
    return (
        <input
            type="checkbox"
            checked={Boolean(props.checked)}
            readOnly
            className="markdown-task-checkbox"
            aria-label="Toggle task"
            onClick={(e) => {
                e.preventDefault(); // checkbox state derives from source text, not the DOM
                e.stopPropagation(); // don't bubble into the click-to-edit handler
                const li = (e.target as HTMLElement).closest("li[data-source-line]");
                const line = Number((li as HTMLElement | null)?.dataset?.sourceLine);
                if (Number.isFinite(line) && line > 0) {
                    onToggle(line);
                }
            }}
        />
    );
};