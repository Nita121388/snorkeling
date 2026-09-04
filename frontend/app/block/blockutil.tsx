// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Tooltip } from "@/app/element/tooltip";
import { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { IconButton, ToggleIconButton } from "@/element/iconbutton";
import { MagnifyIcon } from "@/element/magnify";
import { MenuButton } from "@/element/menubutton";
import { copyText } from "@/util/clipboard";
import { cn } from "@/util/util";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";

export type TabBackgroundEnv = WaveEnvSubset<{
    getTabMetaKeyAtom: MetaKeyAtomFnType<"bg:activebordercolor" | "bg:bordercolor" | "tab:background">;
    getConfigBackgroundAtom: WaveEnv["getConfigBackgroundAtom"];
}>;

export const colorRegex = /^((#[0-9a-f]{6,8})|([a-z]+))$/;
export const NumActiveConnColors = 8;

export function blockViewToIcon(view: string): string {
    if (view == "term") {
        return "terminal";
    }
    if (view == "preview") {
        return "file";
    }
    if (view == "web") {
        return "globe";
    }
    if (view == "waveai") {
        return "sparkles";
    }
    if (view == "help") {
        return "circle-question";
    }
    if (view == "tips") {
        return "lightbulb";
    }
    if (view == "processviewer") {
        return "microchip";
    }
    if (view == "sessionoverview") {
        return "list-tree";
    }
    if (view == "vcs") {
        return "code-branch";
    }
    if (view == "vcscommits") {
        return "clock-rotate-left";
    }
    if (view == "vcsdiff") {
        return "file-code";
    }
    if (view == "vcshistory") {
        return "clock-rotate-left";
    }
    return "square";
}

export function blockViewToName(view: string): string {
    if (util.isBlank(view)) {
        return "(No View)";
    }
    if (view == "term") {
        return "Terminal";
    }
    if (view == "preview") {
        return "Preview";
    }
    if (view == "web") {
        return "Web";
    }
    if (view == "waveai") {
        return "WaveAI";
    }
    if (view == "help") {
        return "Help";
    }
    if (view == "tips") {
        return "Tips";
    }
    if (view == "processviewer") {
        return "Processes";
    }
    if (view == "sessionoverview") {
        return "Overview";
    }
    if (view == "vcs") {
        return "Version Control";
    }
    if (view == "vcscommits") {
        return "Repo Commits";
    }
    if (view == "vcsdiff") {
        return "File Diff";
    }
    if (view == "vcshistory") {
        return "File History";
    }
    return view;
}

export function processTitleString(titleString: string): React.ReactNode[] {
    if (titleString == null) {
        return null;
    }
    const tagRegex = /<(\/)?([a-z]+)(?::([#a-z0-9@-]+))?>/g;
    let lastIdx = 0;
    let match;
    const partsStack = [[]];
    while ((match = tagRegex.exec(titleString)) != null) {
        const lastPart = partsStack[partsStack.length - 1];
        const before = titleString.substring(lastIdx, match.index);
        lastPart.push(before);
        lastIdx = match.index + match[0].length;
        const [_, isClosing, tagName, tagParam] = match;
        if (tagName == "icon" && !isClosing) {
            if (tagParam == null) {
                continue;
            }
            const iconClass = util.makeIconClass(tagParam, false);
            if (iconClass == null) {
                continue;
            }
            lastPart.push(<i key={match.index} className={iconClass} />);
            continue;
        }
        if (tagName == "c" || tagName == "color") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            if (tagParam == null) {
                continue;
            }
            if (!tagParam.match(colorRegex)) {
                continue;
            }
            const children = [];
            const rtag = React.createElement("span", { key: match.index, style: { color: tagParam } }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
        if (tagName == "i" || tagName == "b") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            const children = [];
            const rtag = React.createElement(tagName, { key: match.index }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
    }
    partsStack[partsStack.length - 1].push(titleString.substring(lastIdx));
    return partsStack[0];
}

export function getBlockHeaderIcon(blockIcon: string, overrideIconColor?: string): React.ReactNode {
    let blockIconElem: React.ReactNode = null;
    if (util.isBlank(blockIcon)) {
        blockIcon = "square";
    }
    let iconColor = overrideIconColor;
    if (iconColor && !iconColor.match(colorRegex)) {
        iconColor = null;
    }
    let iconStyle = null;
    if (!util.isBlank(iconColor)) {
        iconStyle = { color: iconColor };
    }
    const iconClass = util.makeIconClass(blockIcon, true);
    if (iconClass != null) {
        blockIconElem = <i key="icon" style={iconStyle} className={clsx(`block-frame-icon`, iconClass)} />;
    }
    return blockIconElem;
}

export function getViewIconElem(
    viewIconUnion: string | IconButtonDecl,
    overrideIconColor?: string
): React.ReactElement {
    if (viewIconUnion == null || typeof viewIconUnion === "string") {
        const viewIcon = viewIconUnion as string;
        return <div className="block-frame-view-icon">{getBlockHeaderIcon(viewIcon, overrideIconColor)}</div>;
    } else {
        return <IconButton decl={viewIconUnion} className="block-frame-view-icon" />;
    }
}

export function useTabBackground(
    waveEnv: TabBackgroundEnv,
    tabId: string | null
): [string, string, BackgroundConfigType] {
    const tabActiveBorderColorDirect = jotai.useAtomValue(waveEnv.getTabMetaKeyAtom(tabId, "bg:activebordercolor"));
    const tabBorderColorDirect = jotai.useAtomValue(waveEnv.getTabMetaKeyAtom(tabId, "bg:bordercolor"));
    const tabBg = jotai.useAtomValue(waveEnv.getTabMetaKeyAtom(tabId, "tab:background"));
    const configBg = jotai.useAtomValue(waveEnv.getConfigBackgroundAtom(tabBg));
    const tabActiveBorderColor = tabActiveBorderColorDirect ?? configBg?.["bg:activebordercolor"];
    const tabBorderColor = tabBorderColorDirect ?? configBg?.["bg:bordercolor"];
    return [tabBorderColor, tabActiveBorderColor, configBg];
}

export const Input = React.memo(
    ({ decl, className, preview }: { decl: HeaderInput; className: string; preview: boolean }) => {
        const { value, ref, isDisabled, onChange, onKeyDown, onFocus, onBlur } = decl;
        return (
            <div className="input-wrapper">
                <input
                    ref={
                        !preview
                            ? ref
                            : undefined /* don't wire up the input field if the preview block is being rendered */
                    }
                    disabled={isDisabled}
                    className={className}
                    value={value}
                    onChange={(e) => onChange(e)}
                    onKeyDown={(e) => onKeyDown(e)}
                    onFocus={(e) => onFocus(e)}
                    onBlur={(e) => onBlur(e)}
                    onDragStart={(e) => e.preventDefault()}
                />
            </div>
        );
    }
);

type MagnifyButtonDeclOptions = {
    magnified: boolean;
    toggleMagnify: () => void;
    disabled: boolean;
    title?: string;
};

export function makeMagnifyButtonDecl({
    magnified,
    toggleMagnify,
    disabled,
    title,
}: MagnifyButtonDeclOptions): IconButtonDecl {
    return {
        elemtype: "iconbutton",
        icon: <MagnifyIcon enabled={magnified} />,
        title: title ?? (magnified ? "Minimize" : "Magnify"),
        click: toggleMagnify,
        disabled,
    };
}

export const OptMagnifyButton = React.memo(
    ({ magnified, toggleMagnify, disabled, title, className }: MagnifyButtonDeclOptions & { className?: string }) => {
        const magnifyDecl = makeMagnifyButtonDecl({ magnified, toggleMagnify, disabled, title });
        return <IconButton key="magnify" decl={magnifyDecl} className={cn("block-frame-magnify", className)} />;
    }
);

export const HeaderCopyTextElem = React.memo(({ elem, preview }: { elem: HeaderCopyText; preview: boolean }) => {
    const [status, setStatus] = React.useState<"idle" | "copied" | "failed">("idle");
    const displayText = elem.displayText || util.basename(elem.text);
    const tooltipText = elem.tooltipText || elem.text;

    console.log("[HeaderCopyTextElem] rendering", { elemtype: elem.elemtype, text: elem.text, displayText, preview });

    React.useEffect(() => {
        if (status === "idle") return;
        const handle = window.setTimeout(
            () => setStatus("idle"),
            status === "copied" ? 1200 : 1600
        );
        return () => window.clearTimeout(handle);
    }, [status]);

    const handleClick = (e: React.MouseEvent) => {
        console.log("[HeaderCopyTextElem] click", { text: elem.text });
        e.stopPropagation();
        copyText(elem.text)
            .then(() => {
                console.log("[HeaderCopyTextElem] copy success");
                setStatus("copied");
            })
            .catch((err) => {
                console.log("[HeaderCopyTextElem] copy failed", err);
                setStatus("failed");
            });
    };

    const actionText = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Click to copy";

    return (
        <Tooltip
            placement="top"
            forceOpen={status !== "idle"}
            openDelay={200}
            content={
                <div className="max-w-[420px] whitespace-pre-wrap break-words text-[11px] leading-4">
                    <div className={cn(status === "failed" ? "text-error" : "text-secondary")}>{tooltipText}</div>
                    <div
                        className={cn(
                            "mt-1 inline-flex items-center gap-1 text-[10px] uppercase",
                            status === "copied" && "text-accent",
                            status === "failed" && "text-error",
                            status === "idle" && "text-secondary"
                        )}
                    >
                        {status === "copied" ? (
                            <i className="fa-sharp fa-solid fa-check text-[9px]" />
                        ) : status === "failed" ? (
                            <i className="fa-sharp fa-solid fa-triangle-exclamation text-[9px]" />
                        ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent/90 ring-2 ring-accent/20" />
                        )}
                        <span>{actionText}</span>
                    </div>
                </div>
            }
        >
            <span
                className={clsx(
                    "inline-flex min-w-0 max-w-full cursor-pointer items-center rounded px-1 py-0.5 text-secondary transition-colors hover:bg-hover hover:text-primary",
                    status === "copied" && "bg-accent/10 text-accent",
                    status === "failed" && "bg-error/10 text-error",
                    elem.className
                )}
                title={actionText}
                onClick={handleClick}
            >
                <span className="min-w-0 truncate">&lrm;{displayText}</span>
            </span>
        </Tooltip>
    );
});
HeaderCopyTextElem.displayName = "HeaderCopyTextElem";

export const HeaderTextElem = React.memo(({ elem, preview }: { elem: HeaderElem; preview: boolean }) => {
    if (elem.elemtype == "iconbutton") {
        const iconButton = <IconButton decl={elem} className={clsx("block-frame-header-iconbutton", elem.className)} />;
        if (elem.tooltipNode != null) {
            return (
                <Tooltip
                    placement="top"
                    content={elem.tooltipNode}
                    forceOpen={elem.tooltipProps?.forceOpen}
                    openDelay={elem.tooltipProps?.openDelay ?? 200}
                    hideOnClick={elem.tooltipProps?.hideOnClick}
                    divClassName={elem.tooltipProps?.divClassName}
                >
                    {iconButton}
                </Tooltip>
            );
        }
        return iconButton;
    } else if (elem.elemtype == "toggleiconbutton") {
        return <ToggleIconButton decl={elem} className={clsx("block-frame-header-iconbutton", elem.className)} />;
    } else if (elem.elemtype == "input") {
        return <Input decl={elem} className={clsx("block-frame-input", elem.className)} preview={preview} />;
    } else if (elem.elemtype == "text") {
        const textDiv = (
            <div
                className={clsx("block-frame-text ellipsis", elem.className, { "flex-nogrow": elem.noGrow })}
                title={elem.title}
            >
                <span ref={preview ? null : elem.ref} onClick={(e) => elem?.onClick?.(e)}>
                    &lrm;{elem.text}
                </span>
            </div>
        );
        if (elem.tooltipNode != null) {
            return (
                <Tooltip
                    placement="top"
                    content={elem.tooltipNode}
                    forceOpen={elem.tooltipProps?.forceOpen}
                    openDelay={elem.tooltipProps?.openDelay ?? 200}
                    hideOnClick={elem.tooltipProps?.hideOnClick}
                    divClassName={elem.tooltipProps?.divClassName}
                >
                    {textDiv}
                </Tooltip>
            );
        }
        return textDiv;
    } else if (elem.elemtype == "textbutton") {
        return (
            <Button className={elem.className} onClick={(e) => elem.onClick(e)} title={elem.title}>
                {elem.text}
            </Button>
        );
    } else if (elem.elemtype == "div") {
        return (
            <div
                className={clsx("block-frame-div", elem.className)}
                onMouseOver={elem.onMouseOver}
                onMouseOut={elem.onMouseOut}
            >
                {elem.children.map((child, childIdx) => (
                    <HeaderTextElem elem={child} key={childIdx} preview={preview} />
                ))}
            </div>
        );
    } else if (elem.elemtype == "copytext") {
        return <HeaderCopyTextElem elem={elem} preview={preview} />;
    } else if (elem.elemtype == "menubutton") {
        return <MenuButton className="block-frame-menubutton" {...(elem as MenuButtonProps)} />;
    }
    return null;
});
HeaderTextElem.displayName = "HeaderTextElem";

export function renderHeaderElements(headerTextUnion: HeaderElem[], preview: boolean): React.ReactElement[] {
    const headerTextElems: React.ReactElement[] = [];
    for (let idx = 0; idx < headerTextUnion.length; idx++) {
        const elem = headerTextUnion[idx];
        const renderedElement = <HeaderTextElem elem={elem} key={idx} preview={preview} />;
        if (renderedElement) {
            headerTextElems.push(renderedElement);
        }
    }
    return headerTextElems;
}

export function computeConnColorNum(connStatus: ConnStatus): number {
    const connColorNum = (connStatus?.activeconnnum ?? 1) % NumActiveConnColors;
    if (connColorNum == 0) {
        return NumActiveConnColors;
    }
    return connColorNum;
}
