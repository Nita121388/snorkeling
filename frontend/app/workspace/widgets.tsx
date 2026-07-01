// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openCommonTextSearch } from "@/app/commontext/commontext-events";
import { Tooltip } from "@/app/element/tooltip";
import * as WOS from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TabTargetModal } from "@/app/tab/tab-target-modal";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import {
    AgentDefaultLaunchTargetMetaKey,
    AgentLaunchTarget,
    AgentProfileOption,
    canSetLaunchTargetDefault,
    createAgentBlockDefForProfile,
    createAgentBlockDefForTarget,
    createTerminalBlockDefForTarget,
    DefaultAgentWidgetId,
    DefaultTerminalWidgetId,
    getAgentProfileDetectionCommands,
    getAgentProfileOptions,
    getCurrentTabAgentLaunchTargets,
    getCurrentTabTerminalLaunchTargets,
    getLaunchCreatableTargets,
    getLaunchTargetDefaultKey,
    resolveDefaultLaunchTarget,
    TerminalDefaultLaunchTargetMetaKey,
} from "@/app/workspace/agent-launch";
import { runWidgetAction } from "@/app/workspace/widget-actions";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { modalsModel } from "@/store/modalmodel";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import {
    autoUpdate,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

export type WidgetsEnv = WaveEnvSubset<{
    isDev: WaveEnv["isDev"];
    electron: {
        openBuilder: WaveEnv["electron"]["openBuilder"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
    };
    rpc: {
        ListAllAppsCommand: WaveEnv["rpc"]["ListAllAppsCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        hasConfigErrors: WaveEnv["atoms"]["hasConfigErrors"];
        workspaceId: WaveEnv["atoms"]["workspaceId"];
        workspace: WaveEnv["atoms"]["workspace"];
        staticTabId: WaveEnv["atoms"]["staticTabId"];
    };
    services: {
        client: WaveEnv["services"]["client"];
        object: WaveEnv["services"]["object"];
    };
    wos: WaveEnv["wos"];
    createBlock: WaveEnv["createBlock"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

type WidgetEntry = {
    id: string;
    config: WidgetConfigType;
};

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetEntry[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.entries(wmap).map(([id, config]) => ({ id, config }));
    wlist.sort((a, b) => {
        return (a.config["display:order"] ?? 0) - (b.config["display:order"] ?? 0);
    });
    return wlist;
}

type WidgetPropsType = {
    widgetId: string;
    widget: WidgetConfigType;
    mode: "normal" | "compact" | "supercompact";
    onWidgetSelect: (widgetId: string, widget: WidgetConfigType, e: React.MouseEvent<HTMLDivElement>) => void;
    onWidgetContextMenu?: (widgetId: string, widget: WidgetConfigType, e: React.MouseEvent<HTMLDivElement>) => void;
    onWidgetHover?: (widgetId: string, widget: WidgetConfigType, e: React.PointerEvent<HTMLDivElement>) => void;
};

const Widget = memo(
    ({ widgetId, widget, mode, onWidgetSelect, onWidgetContextMenu, onWidgetHover }: WidgetPropsType) => {
        const [isTruncated, setIsTruncated] = useState(false);
        const labelRef = useRef<HTMLDivElement>(null);
        const icon = widgetId === "defwidget@sessions" && widget.icon === "messages-square" ? "comments" : widget.icon;
        const isTargetWidget = widgetId === DefaultTerminalWidgetId || widgetId === DefaultAgentWidgetId;

        useEffect(() => {
            if (mode === "normal" && labelRef.current) {
                const element = labelRef.current;
                setIsTruncated(element.scrollWidth > element.clientWidth);
            }
        }, [mode, widget.label]);

        const shouldDisableTooltip = mode !== "normal" ? false : !isTruncated;

        return (
            <Tooltip
                content={widget.description || widget.label}
                placement="left"
                disable={shouldDisableTooltip || isTargetWidget}
                divClassName={clsx(
                    "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                    mode === "supercompact" ? "text-sm" : "text-lg",
                    widget["display:hidden"] && "hidden"
                )}
                divOnClick={(e) => onWidgetSelect(widgetId, widget, e)}
                divOnContextMenu={(e) => onWidgetContextMenu?.(widgetId, widget, e)}
                divOnPointerEnter={isTargetWidget ? (e) => onWidgetHover?.(widgetId, widget, e) : undefined}
            >
                <div style={{ color: widget.color }}>
                    <i className={makeIconClass(icon, true, { defaultIcon: "browser" })}></i>
                </div>
                {mode === "normal" && !isBlank(widget.label) ? (
                    <div
                        ref={labelRef}
                        className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
                    >
                        {widget.label}
                    </div>
                ) : null}
            </Tooltip>
        );
    }
);

function calculateGridSize(appCount: number): number {
    if (appCount <= 4) return 2;
    if (appCount <= 9) return 3;
    if (appCount <= 16) return 4;
    if (appCount <= 25) return 5;
    return 6;
}

function SettingsTooltipContent({ hasConfigErrors }: { hasConfigErrors: boolean }) {
    if (!hasConfigErrors) {
        return "Settings & Help";
    }
    return (
        <div className="flex flex-col p-1">
            <div className="mb-1">Settings &amp; Help</div>
            <div className="flex items-center gap-1 mt-0.5 text-error">
                <i className="fa fa-solid fa-circle-exclamation"></i>
                <span>Config Errors</span>
            </div>
        </div>
    );
}

type FloatingWindowPropsType = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement;
    hasConfigErrors?: boolean;
};

const AppsFloatingWindow = memo(({ isOpen, onClose, referenceElement }: FloatingWindowPropsType) => {
    const [apps, setApps] = useState<AppInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const env = useWaveEnv<WidgetsEnv>();

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: onClose,
        placement: "left-start",
        middleware: [offset(8), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
        elements: {
            reference: referenceElement,
        },
    });

    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);
    const handleOpenBuilder = useCallback(() => {
        env.electron.openBuilder(null);
        onClose();
    }, [onClose, env]);

    useEffect(() => {
        if (!isOpen) return;

        const fetchApps = async () => {
            setLoading(true);
            try {
                const allApps = await env.rpc.ListAllAppsCommand(TabRpcClient);
                const localApps = allApps
                    .filter((app) => !app.appid.startsWith("draft/"))
                    .sort((a, b) => {
                        const aName = a.appid.replace(/^local\//, "");
                        const bName = b.appid.replace(/^local\//, "");
                        return aName.localeCompare(bName);
                    });
                setApps(localApps);
            } catch (error) {
                console.error("Failed to fetch apps:", error);
                setApps([]);
            } finally {
                setLoading(false);
            }
        };

        fetchApps();
    }, [isOpen]);

    if (!isOpen) return null;

    const gridSize = calculateGridSize(apps.length);

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                className="bg-modalbg border border-border rounded-lg shadow-xl z-50 overflow-hidden"
            >
                <div className="p-4">
                    {loading ? (
                        <div className="flex items-center justify-center p-8">
                            <i className="fa fa-solid fa-spinner fa-spin text-2xl text-muted"></i>
                        </div>
                    ) : apps.length === 0 ? (
                        <div className="text-muted text-sm p-4 text-center">No local apps found</div>
                    ) : (
                        <div
                            className="grid gap-3"
                            style={{
                                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                                maxWidth: `${gridSize * 80}px`,
                            }}
                        >
                            {apps.map((app) => {
                                const appMeta = app.manifest?.appmeta;
                                const displayName = app.appid.replace(/^local\//, "");
                                const icon = appMeta?.icon || "cube";
                                const iconColor = appMeta?.iconcolor || "white";

                                return (
                                    <div
                                        key={app.appid}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                        onClick={() => {
                                            const blockDef: BlockDef = {
                                                meta: {
                                                    view: "tsunami",
                                                    controller: "tsunami",
                                                    "tsunami:appid": app.appid,
                                                },
                                            };
                                            env.createBlock(blockDef);
                                            onClose();
                                        }}
                                    >
                                        <div style={{ color: iconColor }} className="text-3xl mb-1">
                                            <i className={makeIconClass(icon, false)}></i>
                                        </div>
                                        <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                            {displayName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    className="w-full px-4 py-2 border-t border-border text-xs text-secondary text-center hover:bg-hoverbg hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
                    onClick={handleOpenBuilder}
                >
                    <i className="fa fa-solid fa-hammer"></i>
                    Build/Edit Apps
                </button>
            </div>
        </FloatingPortal>
    );
});

type AgentTargetFloatingWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement;
    targets: AgentLaunchTarget[];
    settings?: SettingsType;
    magnified?: boolean;
    profileOptions: AgentProfileOption[];
    defaultTargetKey?: string;
    defaultProfileName?: string;
    canCreateToExistingTab: boolean;
    createToCurrentTab: (blockDef: BlockDef, magnified: boolean) => Promise<string>;
    onCreateToNewTab: (blockDef: BlockDef, magnified: boolean) => Promise<void>;
    onCreateToExistingTab: (request: CreateToExistingTabRequest) => void;
    onSetDefaultTarget: (target: AgentLaunchTarget) => void;
    onSetDefaultProfile: (profileName: string) => void;
};

type TerminalTargetFloatingWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement;
    targets: AgentLaunchTarget[];
    settings?: SettingsType;
    magnified?: boolean;
    baseBlockDef?: BlockDef;
    defaultTargetKey?: string;
    canCreateToExistingTab: boolean;
    createToCurrentTab: (blockDef: BlockDef, magnified: boolean) => Promise<string>;
    onCreateToNewTab: (blockDef: BlockDef, magnified: boolean) => Promise<void>;
    onCreateToExistingTab: (request: CreateToExistingTabRequest) => void;
    onSetDefaultTarget: (target: AgentLaunchTarget) => void;
};

type CreateToExistingTabRequest = {
    title: string;
    subtitle: string;
    blockDef: BlockDef;
    magnified: boolean;
};

const DefaultCreateBlockRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

type DefaultCheckButtonProps = {
    checked: boolean;
    ariaLabel: string;
    title: string;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    className?: string;
};

function DefaultCheckButton({ checked, ariaLabel, title, onClick, className }: DefaultCheckButtonProps) {
    return (
        <button
            type="button"
            className={clsx(
                "w-5 h-5 shrink-0 inline-flex items-center justify-center cursor-pointer transition-opacity",
                checked
                    ? "text-accent"
                    : "opacity-0 group-hover:opacity-100",
                className
            )}
            aria-label={ariaLabel}
            title={title}
            onClick={onClick}
        >
            {checked ? (
                <i className="fa-solid fa-check text-accent text-[9px]" />
            ) : (
                <span className="w-3.5 h-3.5 rounded-[2px] border border-secondary/40" />
            )}
        </button>
    );
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && !isBlank(error.message)) {
        return error.message;
    }
    return String(error ?? "unknown error");
}

function showLaunchError(label: string, error: unknown) {
    console.error(`Failed to launch ${label.toLowerCase()}:`, error);
    modalsModel.pushModal("MessageModal", {
        children: `Failed to launch ${label}: ${getErrorMessage(error)}`,
    });
}

function showSettingsError(label: string, error: unknown) {
    console.error(`Failed to save ${label.toLowerCase()}:`, error);
    modalsModel.pushModal("MessageModal", {
        children: `Failed to save ${label}: ${getErrorMessage(error)}`,
    });
}

function showNoDetectedAgentError() {
    modalsModel.pushModal("MessageModal", {
        children: "No detected agent command is available.",
    });
}

const AgentProfileColors: Record<string, string> = {
    codex: "#74a7cb",
    claude: "#cc685c",
    gemini: "#8e7cc3",
    opencode: "#e0b956",
};

function launchTargetSourceLabel(target: AgentLaunchTarget): string {
    switch (target.source) {
        case "files":
            return "Files";
        case "agent":
            return "Agent";
        case "home":
            return "Home";
        default:
            return "Terminal";
    }
}

const AgentTargetFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
        targets,
        settings,
        magnified,
        profileOptions,
        defaultTargetKey,
        defaultProfileName,
        canCreateToExistingTab,
        createToCurrentTab,
        onCreateToNewTab,
        onCreateToExistingTab,
        onSetDefaultTarget,
        onSetDefaultProfile,
    }: AgentTargetFloatingWindowProps) => {
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(8), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });
        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        const initialProfileName =
            defaultProfileName != null && profileOptions.some((profile) => profile.name === defaultProfileName)
                ? defaultProfileName
                : (profileOptions[0]?.name ?? "");
        const [selectedProfile, setSelectedProfile] = useState(initialProfileName);
        const [selectedIdx, setSelectedIdx] = useState(0);

        useEffect(() => {
            if (profileOptions.some((profile) => profile.name === selectedProfile)) {
                return;
            }
            setSelectedProfile(initialProfileName);
        }, [initialProfileName, profileOptions, selectedProfile]);

        const effectiveSelectedProfile = profileOptions.some((profile) => profile.name === selectedProfile)
            ? selectedProfile
            : initialProfileName;

        const clampedSelectedIdx = Math.min(selectedIdx, targets.length - 1);
        const selectedTarget = clampedSelectedIdx >= 0 ? targets[clampedSelectedIdx] : null;

        if (!isOpen) {
            return null;
        }

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl z-50 min-w-[280px] max-w-[340px] overflow-hidden"
                >
                    {/* header */}
                    <div className="px-3 py-2 text-sm font-medium text-foreground border-b border-border/60">
                        New Agent
                    </div>

                    <div className="px-3 pt-2 pb-1.5 border-b border-border/60">
                        <div className="text-xxs text-muted mb-1.5">Select an agent type</div>
                        {profileOptions.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted">No detected agents</div>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {profileOptions.map((profile) => {
                                    const isSelected = effectiveSelectedProfile === profile.name;
                                    const isDefault = (defaultProfileName ?? "") === profile.name;
                                    const color = AgentProfileColors[profile.name] ?? "#888";
                                    return (
                                        <div
                                            key={profile.name}
                                            className={clsx(
                                                "group inline-flex items-center h-[26px] rounded transition-colors",
                                                isSelected
                                                    ? "text-foreground"
                                                    : "text-secondary hover:text-foreground hover:bg-hoverbg"
                                            )}
                                            style={
                                                isSelected
                                                    ? {
                                                          background: `${color}22`,
                                                          color,
                                                          boxShadow: `inset 0 0 0 1px ${color}44`,
                                                      }
                                            : { background: "transparent" }
                                            }
                                        >
                                            <button
                                                type="button"
                                                className="inline-flex items-center gap-1.5 h-full pl-2.5 pr-1.5 rounded-l text-xs font-medium border-none bg-transparent cursor-pointer"
                                                onClick={() => setSelectedProfile(profile.name)}
                                            >
                                                <span
                                                    className="w-[6px] h-[6px] rounded-full shrink-0"
                                                    style={{ background: color }}
                                                />
                                                {profile.label}
                                            </button>
                                            <DefaultCheckButton
                                                checked={isDefault}
                                                ariaLabel={`Set ${profile.label} as default agent`}
                                                title="Set default agent"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onSetDefaultProfile(profile.name);
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* path list */}
                    <div className="max-h-[260px] overflow-y-auto">
                        <div className="px-3 pt-2 pb-1 text-xxs text-muted">
                            Select a path.
                        </div>
                        {targets.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-muted text-center">No paths found</div>
                        ) : (
                            targets.map((target, idx) => {
                                const isSelected = idx === clampedSelectedIdx;
                                const isDefault = getLaunchTargetDefaultKey(target) === defaultTargetKey;
                                const canSetDefault = canSetLaunchTargetDefault(target);
                                return (
                                    <div
                                        key={target.blockId}
                                        role="button"
                                        tabIndex={0}
                                        className={clsx(
                                            "group w-full px-3 py-2 text-left transition-colors cursor-pointer border-b border-border/30 last:border-b-0",
                                            isSelected ? "bg-accent/10" : "hover:bg-hoverbg"
                                        )}
                                        onClick={() => setSelectedIdx(idx)}
                                        onPointerEnter={() => setSelectedIdx(idx)}
                                        onFocus={() => setSelectedIdx(idx)}
                                        onKeyDown={(event) => {
                                            if (event.currentTarget !== event.target) return;
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                setSelectedIdx(idx);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-4 shrink-0 text-center text-muted">
                                                {target.source === "home" ? (
                                                    <i className="fa-sharp fa-regular fa-house text-[11px]" />
                                                ) : target.source === "terminal" || target.source === "agent" ? (
                                                    <i className="fa-sharp fa-regular fa-terminal text-[11px]" />
                                                ) : (
                                                    <i className="fa-sharp fa-regular fa-folder text-[11px]" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs text-foreground truncate">
                                                    {target.detail || target.label}
                                                </div>
                                                {!target.isLocal ? (
                                                    <div className="mt-0.5 text-xxs text-secondary/70 truncate">
                                                        {target.label}
                                                    </div>
                                                ) : null}
                                            </div>
                                            {canSetDefault ? (
                                                <DefaultCheckButton
                                                    checked={isDefault}
                                                    ariaLabel="Set default launch target"
                                                    title="Set default launch target"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onSetDefaultTarget(target);
                                                    }}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {selectedTarget != null ? (
                        <div className="p-2 border-t border-border/60 flex flex-col gap-1">
                            <button
                                type="button"
                                className="w-full flex items-center justify-center gap-1.5 h-7 rounded-md bg-accent text-[#111] text-xs font-medium transition-colors hover:bg-accent/90 cursor-pointer border-none"
                                onClick={() => {
                                    if (isBlank(effectiveSelectedProfile)) {
                                        showNoDetectedAgentError();
                                        return;
                                    }
                                    const blockDef = createAgentBlockDefForTarget(
                                        settings,
                                        selectedTarget,
                                        effectiveSelectedProfile
                                    );
                                    fireAndForget(async () => {
                                        try {
                                            await createToCurrentTab(blockDef, Boolean(magnified));
                                            onClose();
                                        } catch (error) {
                                            showLaunchError("Agent", error);
                                        }
                                    });
                                }}
                            >
                                <i className="fa-sharp fa-regular fa-plus text-[10px]" />
                                Current Tab
                            </button>
                            <div className="flex gap-1.5">
                                <button
                                    type="button"
                                    className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border border-border/60 bg-transparent text-secondary text-xs transition-colors hover:bg-hoverbg hover:text-foreground cursor-pointer"
                                    onClick={() => {
                                        if (isBlank(effectiveSelectedProfile)) {
                                            showNoDetectedAgentError();
                                            return;
                                        }
                                        const blockDef = createAgentBlockDefForTarget(
                                            settings,
                                            selectedTarget,
                                            effectiveSelectedProfile
                                        );
                                        fireAndForget(async () => {
                                            try {
                                                await onCreateToNewTab(blockDef, Boolean(magnified));
                                                onClose();
                                            } catch (error) {
                                                showLaunchError("Agent", error);
                                            }
                                        });
                                    }}
                                >
                                    <i className="fa-sharp fa-regular fa-window-restore text-[10px]" />
                                    New Tab
                                </button>
                                <button
                                    type="button"
                                    className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border border-border/60 bg-transparent text-secondary text-xs transition-colors hover:bg-hoverbg hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-50"
                                    disabled={!canCreateToExistingTab}
                                    onClick={() => {
                                        if (isBlank(effectiveSelectedProfile)) {
                                            showNoDetectedAgentError();
                                            return;
                                        }
                                        const blockDef = createAgentBlockDefForTarget(
                                            settings,
                                            selectedTarget,
                                            effectiveSelectedProfile
                                        );
                                        onCreateToExistingTab({
                                            title: "Create Agent",
                                            subtitle: selectedTarget.detail || selectedTarget.label,
                                            blockDef,
                                            magnified: Boolean(magnified),
                                        });
                                        onClose();
                                    }}
                                >
                                    <i className="fa-sharp fa-regular fa-window-restore text-[10px]" />
                                    Existing Tab...
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </FloatingPortal>
        );
    }
);

const TerminalTargetFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
        targets,
        magnified,
        baseBlockDef,
        defaultTargetKey,
        canCreateToExistingTab,
        createToCurrentTab,
        onCreateToNewTab,
        onCreateToExistingTab,
        onSetDefaultTarget,
    }: TerminalTargetFloatingWindowProps) => {
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(8), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });
        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        const [selectedIdx, setSelectedIdx] = useState(0);
        const clampedSelectedIdx = Math.min(selectedIdx, targets.length - 1);
        const selectedTarget = clampedSelectedIdx >= 0 ? targets[clampedSelectedIdx] : null;

        if (!isOpen) {
            return null;
        }

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl z-50 min-w-[280px] max-w-[340px] overflow-hidden"
                >
                    {/* header */}
                    <div className="px-3 py-2 text-sm font-medium text-foreground border-b border-border/60">
                        New Terminal
                    </div>

                    {/* path list */}
                    <div className="max-h-[300px] overflow-y-auto">
                        {targets.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-muted text-center">No paths found</div>
                        ) : (
                            targets.map((target, idx) => {
                                const isSelected = idx === clampedSelectedIdx;
                                const isDefault = getLaunchTargetDefaultKey(target) === defaultTargetKey;
                                const canSetDefault = canSetLaunchTargetDefault(target);
                                return (
                                    <div
                                        key={target.blockId}
                                        role="button"
                                        tabIndex={0}
                                        className={clsx(
                                            "group w-full px-3 py-2 text-left transition-colors cursor-pointer border-b border-border/30 last:border-b-0",
                                            isSelected ? "bg-accent/10" : "hover:bg-hoverbg"
                                        )}
                                        onClick={() => setSelectedIdx(idx)}
                                        onPointerEnter={() => setSelectedIdx(idx)}
                                        onFocus={() => setSelectedIdx(idx)}
                                        onKeyDown={(event) => {
                                            if (event.currentTarget !== event.target) return;
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                setSelectedIdx(idx);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-4 shrink-0 text-center text-muted">
                                                {target.source === "home" ? (
                                                    <i className="fa-sharp fa-regular fa-house text-[11px]" />
                                                ) : target.source === "terminal" || target.source === "agent" ? (
                                                    <i className="fa-sharp fa-regular fa-terminal text-[11px]" />
                                                ) : (
                                                    <i className="fa-sharp fa-regular fa-folder text-[11px]" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs text-foreground truncate">
                                                    {target.detail || target.label}
                                                </div>
                                                {!target.isLocal ? (
                                                    <div className="mt-0.5 text-xxs text-secondary/70 truncate">
                                                        {target.label}
                                                    </div>
                                                ) : null}
                                            </div>
                                            {canSetDefault ? (
                                                <DefaultCheckButton
                                                    checked={isDefault}
                                                    ariaLabel="Set default launch target"
                                                    title="Set default launch target"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onSetDefaultTarget(target);
                                                    }}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {selectedTarget != null ? (
                        <div className="p-2 border-t border-border/60 flex flex-col gap-1">
                            <button
                                type="button"
                                className="w-full flex items-center justify-center gap-1.5 h-7 rounded-md bg-accent text-[#111] text-xs font-medium transition-colors hover:bg-accent/90 cursor-pointer border-none"
                                onClick={() => {
                                    const blockDef = createTerminalBlockDefForTarget(selectedTarget, baseBlockDef);
                                    fireAndForget(async () => {
                                        try {
                                            await createToCurrentTab(blockDef, Boolean(magnified));
                                            onClose();
                                        } catch (error) {
                                            showLaunchError("Terminal", error);
                                        }
                                    });
                                }}
                            >
                                <i className="fa-sharp fa-regular fa-plus text-[10px]" />
                                Current Tab
                            </button>
                            <div className="flex gap-1.5">
                                <button
                                    type="button"
                                    className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border border-border/60 bg-transparent text-secondary text-xs transition-colors hover:bg-hoverbg hover:text-foreground cursor-pointer"
                                    onClick={() => {
                                        const blockDef = createTerminalBlockDefForTarget(selectedTarget, baseBlockDef);
                                        fireAndForget(async () => {
                                            try {
                                                await onCreateToNewTab(blockDef, Boolean(magnified));
                                                onClose();
                                            } catch (error) {
                                                showLaunchError("Terminal", error);
                                            }
                                        });
                                    }}
                                >
                                    <i className="fa-sharp fa-regular fa-window-restore text-[10px]" />
                                    New Tab
                                </button>
                                <button
                                    type="button"
                                    className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border border-border/60 bg-transparent text-secondary text-xs transition-colors hover:bg-hoverbg hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-50"
                                    disabled={!canCreateToExistingTab}
                                    onClick={() => {
                                        const blockDef = createTerminalBlockDefForTarget(selectedTarget, baseBlockDef);
                                        onCreateToExistingTab({
                                            title: "Create Terminal",
                                            subtitle: selectedTarget.detail || selectedTarget.label,
                                            blockDef,
                                            magnified: Boolean(magnified),
                                        });
                                        onClose();
                                    }}
                                >
                                    <i className="fa-sharp fa-regular fa-window-restore text-[10px]" />
                                    Existing Tab...
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </FloatingPortal>
        );
    }
);

const SettingsFloatingWindow = memo(
    ({ isOpen, onClose, referenceElement, hasConfigErrors }: FloatingWindowPropsType) => {
        const env = useWaveEnv<WidgetsEnv>();
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(8), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        if (!isOpen) return null;

        const menuItems = [
            {
                icon: "gear",
                label: "Settings",
                hasError: hasConfigErrors,
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                        },
                    };
                    env.createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "lightbulb",
                label: "Tips",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "tips",
                        },
                    };
                    env.createBlock(blockDef, true, true);
                    onClose();
                },
            },
            {
                icon: "lock",
                label: "Secrets",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                            file: "secrets",
                        },
                    };
                    env.createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "quote-left",
                label: "Common Text",
                onClick: () => {
                    openCommonTextSearch();
                    onClose();
                },
            },
            {
                icon: "book-open",
                label: "Release Notes",
                onClick: () => {
                    modalsModel.pushModal("UpgradeOnboardingPatch", { isReleaseNotes: true });
                    onClose();
                },
            },
            {
                icon: "circle-question",
                label: "Help",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "help",
                        },
                    };
                    env.createBlock(blockDef);
                    onClose();
                },
            },
        ];

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-2 z-50"
                >
                    {menuItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-hoverbg cursor-pointer transition-colors text-secondary hover:text-white"
                            onClick={item.onClick}
                        >
                            <div className="text-lg w-5 flex justify-center">
                                <i className={makeIconClass(item.icon, false)}></i>
                            </div>
                            <div className="text-sm whitespace-nowrap">{item.label}</div>
                            {item.hasError && (
                                <i className="fa fa-solid fa-circle-exclamation text-error text-[14px] ml-auto"></i>
                            )}
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const env = useWaveEnv<WidgetsEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const settings = fullConfig?.settings;
    const hasConfigErrors = useAtomValue(env.atoms.hasConfigErrors);
    const workspaceId = useAtomValue(env.atoms.workspaceId);
    const workspace = useAtomValue(env.atoms.workspace);
    const currentTabId = useAtomValue(env.atoms.staticTabId);
    const currentTab = useAtomValue(env.wos.getWaveObjectAtom<Tab>(WOS.makeORef("tab", currentTabId)));
    const [mode, setMode] = useState<"normal" | "compact" | "supercompact">("normal");
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const featureWaveAppBuilder = settings?.["feature:waveappbuilder"] ?? false;
    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([_key, widget]) => shouldIncludeWidgetForWorkspace(widget, workspaceId))
    );
    const widgets = sortByDisplayOrder(filteredWidgets);

    const [isAppsOpen, setIsAppsOpen] = useState(false);
    const appsButtonRef = useRef<HTMLDivElement>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsButtonRef = useRef<HTMLDivElement>(null);
    const [isAgentTargetOpen, setIsAgentTargetOpen] = useState(false);
    const [agentTargets, setAgentTargets] = useState<AgentLaunchTarget[]>([]);
    const [agentWidgetMagnified, setAgentWidgetMagnified] = useState<boolean>(false);
    const [agentReferenceElement, setAgentReferenceElement] = useState<HTMLElement | null>(null);
    const [isTerminalTargetOpen, setIsTerminalTargetOpen] = useState(false);
    const [terminalTargets, setTerminalTargets] = useState<AgentLaunchTarget[]>([]);
    const [terminalWidgetMagnified, setTerminalWidgetMagnified] = useState<boolean>(false);
    const [terminalReferenceElement, setTerminalReferenceElement] = useState<HTMLElement | null>(null);
    const [terminalBaseBlockDef, setTerminalBaseBlockDef] = useState<BlockDef | undefined>(undefined);
    const agentHoverTimerRef = useRef<number | null>(null);
    const terminalHoverTimerRef = useRef<number | null>(null);
    const [agentCommandPaths, setAgentCommandPaths] = useState<Record<string, string | null>>({});
    const [createToExistingTabRequest, setCreateToExistingTabRequest] = useState<CreateToExistingTabRequest | null>(
        null
    );

    const agentProfileOptions = useMemo(
        () => getAgentProfileOptions(settings, agentCommandPaths),
        [settings, agentCommandPaths]
    );
    const configuredAgentDefaultProfileName = isBlank(settings?.["agent:defaultprofile"])
        ? undefined
        : settings!["agent:defaultprofile"]!.trim().toLowerCase();
    const agentDefaultProfileName = useMemo(() => {
        if (
            configuredAgentDefaultProfileName != null &&
            agentProfileOptions.some((profile) => profile.name === configuredAgentDefaultProfileName)
        ) {
            return configuredAgentDefaultProfileName;
        }
        return agentProfileOptions[0]?.name;
    }, [configuredAgentDefaultProfileName, agentProfileOptions]);
    const agentDefaultTargetKey = currentTab?.meta?.[AgentDefaultLaunchTargetMetaKey];
    const terminalDefaultTargetKey = currentTab?.meta?.[TerminalDefaultLaunchTargetMetaKey];
    const canCreateToExistingTab = (workspace?.tabids ?? []).some((tabId) => tabId !== currentTabId);
    const sourceTabName = currentTab?.name || "Tab";

    useEffect(() => {
        const detectionCommands = getAgentProfileDetectionCommands(settings);
        const entries = Object.entries(detectionCommands);
        let cancelled = false;
        if (entries.length === 0) {
            setAgentCommandPaths({});
            return () => {
                cancelled = true;
            };
        }

        fireAndForget(async () => {
            const detectedEntries = await Promise.all(
                entries.map(async ([profileName, command]) => {
                    try {
                        const path = await env.services.client.FindCommand(command);
                        return [profileName, isBlank(path) ? null : path] as const;
                    } catch (error) {
                        console.warn(`Failed to detect agent command ${command}:`, error);
                        return [profileName, null] as const;
                    }
                })
            );
            if (!cancelled) {
                setAgentCommandPaths(Object.fromEntries(detectedEntries));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [env.services.client, settings]);

    const closeAgentTargetSelector = useCallback(() => {
        setIsAgentTargetOpen(false);
        setAgentReferenceElement(null);
        setAgentTargets([]);
    }, []);

    const closeTerminalTargetSelector = useCallback(() => {
        setIsTerminalTargetOpen(false);
        setTerminalReferenceElement(null);
        setTerminalTargets([]);
        setTerminalBaseBlockDef(undefined);
    }, []);

    const createBlockInCurrentTab = useCallback(
        (blockDef: BlockDef, magnified: boolean) => env.createBlock(blockDef, magnified),
        [env]
    );

    const createBlockInNewTab = useCallback(
        async (blockDef: BlockDef, magnified: boolean) => {
            if (isBlank(workspace?.oid)) {
                throw new Error("No workspace available");
            }
            const result = await env.services.object.CreateBlockInNewTab(
                workspace.oid,
                sourceTabName,
                blockDef,
                DefaultCreateBlockRuntimeOpts,
                magnified
            );
            env.electron.setActiveTab(result.tabid);
        },
        [env, workspace?.oid, sourceTabName]
    );

    const createBlockInExistingTab = useCallback(
        async (targetTabId: string, request: CreateToExistingTabRequest) => {
            await env.services.object.CreateBlockInTab(
                targetTabId,
                request.blockDef,
                DefaultCreateBlockRuntimeOpts,
                false,
                request.magnified
            );
            env.electron.setActiveTab(targetTabId);
        },
        [env]
    );

    const openCreateToExistingTabModal = useCallback((request: CreateToExistingTabRequest) => {
        setCreateToExistingTabRequest(request);
    }, []);

    const closeCreateToExistingTabModal = useCallback(() => {
        setCreateToExistingTabRequest(null);
    }, []);

    const launchTerminalTarget = useCallback(
        (target: AgentLaunchTarget | null, baseBlockDef: BlockDef | undefined, magnified: boolean) => {
            const blockDef = target == null ? baseBlockDef : createTerminalBlockDefForTarget(target, baseBlockDef);
            if (blockDef == null) {
                console.warn("Terminal widget has no blockdef");
                return;
            }
            fireAndForget(async () => {
                try {
                    await createBlockInCurrentTab(blockDef, magnified);
                } catch (error) {
                    showLaunchError("Terminal", error);
                }
            });
        },
        [createBlockInCurrentTab]
    );

    const launchAgentTarget = useCallback(
        (target: AgentLaunchTarget | null, magnified: boolean, profileName?: string) => {
            const selectedProfileName = profileName ?? agentDefaultProfileName;
            if (selectedProfileName == null) {
                showNoDetectedAgentError();
                return;
            }
            const blockDef =
                target == null
                    ? createAgentBlockDefForProfile(selectedProfileName, settings)
                    : createAgentBlockDefForTarget(settings, target, selectedProfileName);
            fireAndForget(async () => {
                try {
                    await createBlockInCurrentTab(blockDef, magnified);
                } catch (error) {
                    showLaunchError("Agent", error);
                }
            });
        },
        [agentDefaultProfileName, createBlockInCurrentTab, settings]
    );

    const setDefaultAgentTarget = useCallback(
        (target: AgentLaunchTarget) => {
            if (!canSetLaunchTargetDefault(target)) {
                return;
            }
            const targetKey = getLaunchTargetDefaultKey(target);
            const isCurrentlyDefault = targetKey === agentDefaultTargetKey;
            fireAndForget(async () => {
                try {
                    await env.services.object.UpdateObjectMeta(WOS.makeORef("tab", currentTabId), {
                        [AgentDefaultLaunchTargetMetaKey]: isCurrentlyDefault ? (null as unknown as string) : targetKey,
                    } as MetaType);
                } catch (error) {
                    showSettingsError("Agent default target", error);
                }
            });
        },
        [currentTabId, env, agentDefaultTargetKey]
    );

    const setDefaultTerminalTarget = useCallback(
        (target: AgentLaunchTarget) => {
            if (!canSetLaunchTargetDefault(target)) {
                return;
            }
            const targetKey = getLaunchTargetDefaultKey(target);
            const isCurrentlyDefault = targetKey === terminalDefaultTargetKey;
            fireAndForget(async () => {
                try {
                    await env.services.object.UpdateObjectMeta(WOS.makeORef("tab", currentTabId), {
                        [TerminalDefaultLaunchTargetMetaKey]: isCurrentlyDefault ? (null as unknown as string) : targetKey,
                    } as MetaType);
                } catch (error) {
                    showSettingsError("Terminal default target", error);
                }
            });
        },
        [currentTabId, env, terminalDefaultTargetKey]
    );

    const setDefaultAgentProfile = useCallback(
        (profileName: string) => {
            fireAndForget(async () => {
                try {
                    await env.rpc.SetConfigCommand(TabRpcClient, {
                        "agent:defaultprofile": profileName,
                    } as SettingsType);
                } catch (error) {
                    showSettingsError("Agent default profile", error);
                }
            });
        },
        [env]
    );

    const openAgentTargetPopup = useCallback(
        (widget: WidgetConfigType, referenceElement: HTMLElement) => {
            closeTerminalTargetSelector();
            const launchTargets = getLaunchCreatableTargets(getCurrentTabAgentLaunchTargets());
            setAgentTargets(launchTargets);
            setAgentWidgetMagnified(Boolean(widget.magnified));
            setAgentReferenceElement(referenceElement);
            setIsAgentTargetOpen(true);
        },
        [closeTerminalTargetSelector]
    );

    const openTerminalTargetPopup = useCallback(
        (widget: WidgetConfigType, referenceElement: HTMLElement) => {
            closeAgentTargetSelector();
            const launchTargets = getLaunchCreatableTargets(getCurrentTabTerminalLaunchTargets());
            setTerminalTargets(launchTargets);
            setTerminalWidgetMagnified(Boolean(widget.magnified));
            setTerminalReferenceElement(referenceElement);
            setTerminalBaseBlockDef(widget.blockdef);
            setIsTerminalTargetOpen(true);
        },
        [closeAgentTargetSelector]
    );

    const handleWidgetSelect = useCallback(
        (widgetId: string, widget: WidgetConfigType, e: React.MouseEvent<HTMLDivElement>) => {
            if (runWidgetAction(widget.action)) {
                closeAgentTargetSelector();
                closeTerminalTargetSelector();
                return;
            }

            const shouldCreateDefault = isAgentTargetOpen || isTerminalTargetOpen;

            if (widgetId === DefaultTerminalWidgetId) {
                const launchTargets = getCurrentTabTerminalLaunchTargets();
                const defaultTarget = resolveDefaultLaunchTarget(launchTargets, terminalDefaultTargetKey);
                if (!shouldCreateDefault) {
                    openTerminalTargetPopup(widget, e.currentTarget);
                    return;
                }
                closeAgentTargetSelector();
                closeTerminalTargetSelector();
                launchTerminalTarget(defaultTarget, widget.blockdef, Boolean(widget.magnified));
                return;
            }

            if (widgetId === DefaultAgentWidgetId) {
                const launchTargets = getCurrentTabAgentLaunchTargets();
                const defaultTarget = resolveDefaultLaunchTarget(launchTargets, agentDefaultTargetKey);
                if (agentProfileOptions.length === 0) {
                    closeAgentTargetSelector();
                    closeTerminalTargetSelector();
                    showNoDetectedAgentError();
                    return;
                }
                if (!shouldCreateDefault) {
                    openAgentTargetPopup(widget, e.currentTarget);
                    return;
                }
                closeAgentTargetSelector();
                closeTerminalTargetSelector();
                launchAgentTarget(defaultTarget, Boolean(widget.magnified));
                return;
            }

            closeAgentTargetSelector();
            closeTerminalTargetSelector();
            const blockDef = widget.blockdef;
            if (blockDef == null) {
                console.warn(`Widget ${widgetId} has no blockdef`);
                return;
            }
            fireAndForget(async () => {
                await env.createBlock(blockDef, widget.magnified);
            });
        },
        [
            agentDefaultTargetKey,
            agentProfileOptions.length,
            closeAgentTargetSelector,
            closeTerminalTargetSelector,
            env,
            isAgentTargetOpen,
            isTerminalTargetOpen,
            launchAgentTarget,
            launchTerminalTarget,
            openAgentTargetPopup,
            openTerminalTargetPopup,
            terminalDefaultTargetKey,
        ]
    );

    const handleWidgetContextMenu = useCallback(
        (widgetId: string, widget: WidgetConfigType, e: React.MouseEvent<HTMLDivElement>) => {
            if (widgetId === DefaultTerminalWidgetId) {
                e.preventDefault();
                e.stopPropagation();
                openTerminalTargetPopup(widget, e.currentTarget);
                return;
            }

            if (widgetId === DefaultAgentWidgetId) {
                e.preventDefault();
                e.stopPropagation();
                if (agentProfileOptions.length === 0) {
                    showNoDetectedAgentError();
                    return;
                }
                openAgentTargetPopup(widget, e.currentTarget);
                return;
            }

            const widgetAny = widget as any;
            if (widgetAny._defaultContextMenu == null) {
                return;
            }
            env.showContextMenu(widgetAny._defaultContextMenu, e);
        },
        [agentProfileOptions.length, openAgentTargetPopup, openTerminalTargetPopup, env]
    );

    const handleWidgetHover = useCallback(
        (widgetId: string, widget: WidgetConfigType, e: React.PointerEvent<HTMLDivElement>) => {
            const referenceElement = e.currentTarget;

            if (widgetId === DefaultTerminalWidgetId) {
                if (terminalHoverTimerRef.current != null) {
                    window.clearTimeout(terminalHoverTimerRef.current);
                }
                terminalHoverTimerRef.current = window.setTimeout(() => {
                    openTerminalTargetPopup(widget, referenceElement);
                }, 150);
                return;
            }

            if (widgetId === DefaultAgentWidgetId) {
                if (agentHoverTimerRef.current != null) {
                    window.clearTimeout(agentHoverTimerRef.current);
                }
                agentHoverTimerRef.current = window.setTimeout(() => {
                    if (agentProfileOptions.length > 0) {
                        openAgentTargetPopup(widget, referenceElement);
                    }
                }, 150);
            }
        },
        [agentProfileOptions.length, openAgentTargetPopup, openTerminalTargetPopup]
    );

    const checkModeNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const normalHeight = measurementRef.current.scrollHeight;
        const gracePeriod = 10;

        let newMode: "normal" | "compact" | "supercompact" = "normal";

        if (normalHeight > containerHeight - gracePeriod) {
            newMode = "compact";

            // Calculate total widget count for supercompact check
            const totalWidgets = (widgets?.length || 0) + 1;
            const minHeightPerWidget = 32;
            const requiredHeight = totalWidgets * minHeightPerWidget;

            if (requiredHeight > containerHeight) {
                newMode = "supercompact";
            }
        }

        if (newMode !== mode) {
            setMode(newMode);
        }
    }, [mode, widgets]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            checkModeNeeded();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [checkModeNeeded]);

    useEffect(() => {
        checkModeNeeded();
    }, [widgets, checkModeNeeded]);

    useEffect(() => {
        return () => {
            if (agentHoverTimerRef.current != null) {
                window.clearTimeout(agentHoverTimerRef.current);
            }
            if (terminalHoverTimerRef.current != null) {
                window.clearTimeout(terminalHoverTimerRef.current);
            }
        };
    }, []);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: "Edit widgets.json",
                click: () => {
                    fireAndForget(async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "waveconfig",
                                file: "widgets.json",
                            },
                        };
                        await env.createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        env.showContextMenu(menu, e);
    };

    return (
        <>
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none shrink-0"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {widgets?.map((data) => (
                                <Widget
                                    key={`widget-${data.id}`}
                                    widgetId={data.id}
                                    widget={data.config}
                                    mode={mode}
                                    onWidgetSelect={handleWidgetSelect}
                                    onWidgetContextMenu={handleWidgetContextMenu}
                                    onWidgetHover={handleWidgetHover}
                                />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {env.isDev() || featureWaveAppBuilder ? (
                                <div
                                    ref={appsButtonRef}
                                    className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                    onClick={() => setIsAppsOpen(!isAppsOpen)}
                                >
                                    <Tooltip content="Local WaveApps" placement="left" disable={isAppsOpen}>
                                        <div>
                                            <i className={makeIconClass("cube", true)}></i>
                                        </div>
                                    </Tooltip>
                                </div>
                            ) : null}
                            <div
                                ref={settingsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            >
                                <Tooltip
                                    content={<SettingsTooltipContent hasConfigErrors={hasConfigErrors} />}
                                    placement="left"
                                    disable={isSettingsOpen}
                                >
                                    <div className="relative">
                                        <i className={makeIconClass("gear", true)}></i>
                                        {hasConfigErrors && (
                                            <i className="fa fa-solid fa-circle-exclamation text-error absolute top-0 right-0 text-[10px] pointer-events-none"></i>
                                        )}
                                    </div>
                                </Tooltip>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {widgets?.map((data) => (
                            <Widget
                                key={`widget-${data.id}`}
                                widgetId={data.id}
                                widget={data.config}
                                mode={mode}
                                onWidgetSelect={handleWidgetSelect}
                                onWidgetContextMenu={handleWidgetContextMenu}
                                onWidgetHover={handleWidgetHover}
                            />
                        ))}
                        <div className="flex-grow" />
                        {env.isDev() || featureWaveAppBuilder ? (
                            <div
                                ref={appsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => setIsAppsOpen(!isAppsOpen)}
                            >
                                <Tooltip content="Local WaveApps" placement="left" disable={isAppsOpen}>
                                    <div className="flex flex-col items-center w-full">
                                        <div>
                                            <i className={makeIconClass("cube", true)}></i>
                                        </div>
                                        {mode === "normal" && (
                                            <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                                apps
                                            </div>
                                        )}
                                    </div>
                                </Tooltip>
                            </div>
                        ) : null}
                        <div
                            ref={settingsButtonRef}
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        >
                            <Tooltip
                                content={<SettingsTooltipContent hasConfigErrors={hasConfigErrors} />}
                                placement="left"
                                disable={isSettingsOpen}
                            >
                                <div className="flex flex-col items-center w-full">
                                    <div className="relative">
                                        <i className={makeIconClass("gear", true)}></i>
                                        {hasConfigErrors && (
                                            <i
                                                className={`fa fa-solid fa-circle-exclamation text-error absolute top-0 right-[-4px] pointer-events-none ${mode === "normal" ? "text-[14px]" : "text-[12px]"}`}
                                            ></i>
                                        )}
                                    </div>
                                    {mode === "normal" && (
                                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                            settings
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </div>
                    </>
                )}
                {env.isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Wave Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            {(env.isDev() || featureWaveAppBuilder) && appsButtonRef.current && (
                <AppsFloatingWindow
                    isOpen={isAppsOpen}
                    onClose={() => setIsAppsOpen(false)}
                    referenceElement={appsButtonRef.current}
                />
            )}
            {settingsButtonRef.current && (
                <SettingsFloatingWindow
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    referenceElement={settingsButtonRef.current}
                    hasConfigErrors={hasConfigErrors}
                />
            )}
            {agentReferenceElement != null && (
                <AgentTargetFloatingWindow
                    isOpen={isAgentTargetOpen}
                    onClose={closeAgentTargetSelector}
                    referenceElement={agentReferenceElement}
                    targets={agentTargets}
                    settings={settings}
                    magnified={agentWidgetMagnified}
                    profileOptions={agentProfileOptions}
                    defaultTargetKey={agentDefaultTargetKey}
                    defaultProfileName={agentDefaultProfileName}
                    canCreateToExistingTab={canCreateToExistingTab}
                    createToCurrentTab={createBlockInCurrentTab}
                    onCreateToNewTab={createBlockInNewTab}
                    onCreateToExistingTab={openCreateToExistingTabModal}
                    onSetDefaultTarget={setDefaultAgentTarget}
                    onSetDefaultProfile={setDefaultAgentProfile}
                />
            )}
            {terminalReferenceElement != null && (
                <TerminalTargetFloatingWindow
                    isOpen={isTerminalTargetOpen}
                    onClose={closeTerminalTargetSelector}
                    referenceElement={terminalReferenceElement}
                    targets={terminalTargets}
                    settings={settings}
                    magnified={terminalWidgetMagnified}
                    baseBlockDef={terminalBaseBlockDef}
                    defaultTargetKey={terminalDefaultTargetKey}
                    canCreateToExistingTab={canCreateToExistingTab}
                    createToCurrentTab={createBlockInCurrentTab}
                    onCreateToNewTab={createBlockInNewTab}
                    onCreateToExistingTab={openCreateToExistingTabModal}
                    onSetDefaultTarget={setDefaultTerminalTarget}
                />
            )}
            {createToExistingTabRequest != null ? (
                <TabTargetModal
                    workspace={workspace}
                    currentTabId={currentTabId}
                    title={createToExistingTabRequest.title}
                    subtitle={createToExistingTabRequest.subtitle || sourceTabName}
                    actionLabel="Create"
                    workingLabel="Creating..."
                    onClose={closeCreateToExistingTabModal}
                    onSelect={(targetTabId) => createBlockInExistingTab(targetTabId, createToExistingTabRequest)}
                />
            ) : null}
            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                {widgets?.map((data) => (
                    <Widget
                        key={`measurement-widget-${data.id}`}
                        widgetId={data.id}
                        widget={data.config}
                        mode="normal"
                        onWidgetSelect={handleWidgetSelect}
                        onWidgetContextMenu={handleWidgetContextMenu}
                        onWidgetHover={handleWidgetHover}
                    />
                ))}
                <div className="flex-grow" />
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">settings</div>
                </div>
                {env.isDev() ? (
                    <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                        <div>
                            <i className={makeIconClass("cube", true)}></i>
                        </div>
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center">apps</div>
                    </div>
                ) : null}
                {env.isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Wave Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
        </>
    );
});

export { Widgets };
