// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { srcLineAttrs } from "./shared";

export type HeadingProps = {
    props: React.HTMLAttributes<HTMLHeadingElement>;
    hnum: number;
    collapsed: boolean;
    onToggle: (headingId: string) => void;
};

export const CollapsibleHeading = ({ props, hnum, collapsed, onToggle }: HeadingProps) => {
    const headingId = typeof props.id === "string" ? props.id : "";
    return (
        <div
            id={props.id}
            className={clsx("heading", `is-${hnum}`, { collapsed })}
            data-heading-level={hnum}
            data-heading-id={headingId}
            {...srcLineAttrs(props)}
        >
            <button
                type="button"
                className="heading-collapse-button"
                title={collapsed ? "Expand section" : "Collapse section"}
                aria-label={collapsed ? "Expand section" : "Collapse section"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (headingId) {
                        onToggle(headingId);
                    }
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <span className="heading-title">{props.children}</span>
        </div>
    );
};