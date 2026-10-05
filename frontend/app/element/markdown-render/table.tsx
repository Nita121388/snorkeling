// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { srcLineAttrs } from "./shared";

export const CollapsibleTable = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.HTMLAttributes<HTMLTableElement>;
    collapsed: boolean;
    onToggle: () => void;
}) => {
    return (
        <div className={clsx("table-wrapper", { collapsed })} {...srcLineAttrs(props)}>
            <button
                type="button"
                className="table-collapse-button"
                title={collapsed ? "Expand table" : "Collapse table"}
                aria-label={collapsed ? "Expand table" : "Collapse table"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle();
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <table {...props} />
        </div>
    );
};