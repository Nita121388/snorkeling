// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { recordTEvent } from "@/app/store/global";
import { TermViewModel } from "@/app/view/term/term-model";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import * as util from "@/util/util";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    safePolygon,
    shift,
    useFloating,
    useHover,
    useInteractions,
} from "@floating-ui/react";
import * as jotai from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockEnv } from "./blockenv";

function isTermViewModel(viewModel: ViewModel): viewModel is TermViewModel {
    return viewModel?.viewType === "term";
}

function LearnMoreButton() {
    const { t } = useTranslation("block");
    const waveEnv = useWaveEnv<BlockEnv>();
    return (
        <button
            className="text-muted text-xs hover:underline cursor-pointer text-left"
            onClick={() => waveEnv.electron.openExternal("https://docs.waveterm.dev/durable-sessions")}
        >
            {t("block:durable.learnMore")}
        </button>
    );
}

interface StandardSessionContentProps {
    viewModel: TermViewModel;
    onClose: () => void;
}

function StandardSessionContent({ viewModel, onClose }: StandardSessionContentProps) {
    const { t } = useTranslation("block");
    const handleRestartAsDurable = () => {
        recordTEvent("action:termdurable", { "action:type": "restartdurable" });
        onClose();
        util.fireAndForget(() => viewModel.restartSessionWithDurability(true));
    };

    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-regular fa-shield text-muted" />
                {t("block:durable.standardTitle")}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{t("block:durable.standardBody")}</div>
            <button
                className="bg-surface text-primary rounded px-3 py-1.5 text-xs font-medium hover:bg-hover transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                onClick={handleRestartAsDurable}
            >
                <i className="fa-solid fa-shield text-sky-500" />
                {t("block:durable.restartAsDurable")}
            </button>
            <LearnMoreButton />
        </div>
    );
}

interface DurableAttachedContentProps {
    onClose: () => void;
}

function DurableAttachedContent({ onClose }: DurableAttachedContentProps) {
    const { t } = useTranslation("block");
    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-sky-500" />
                {t("block:durable.attachedTitle")}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{t("block:durable.attachedBody")}</div>
            <LearnMoreButton />
        </div>
    );
}

interface DurableDetachedContentProps {
    onClose: () => void;
}

function DurableDetachedContent({ onClose }: DurableDetachedContentProps) {
    const { t } = useTranslation("block");
    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-sky-300" />
                {t("block:durable.detachedTitle")}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{t("block:durable.detachedBody")}</div>
            <LearnMoreButton />
        </div>
    );
}

interface DurableAwaitingStartProps {
    connected: boolean;
    viewModel: TermViewModel;
    onClose: () => void;
}

function DurableAwaitingStart({ connected, viewModel, onClose }: DurableAwaitingStartProps) {
    const { t } = useTranslation("block");
    const handleStartSession = () => {
        onClose();
        util.fireAndForget(() => viewModel.forceRestartController());
    };

    if (!connected) {
        return (
            <div className="flex flex-col gap-2 max-w-[280px]">
                <div className="font-semibold text-sm flex items-center gap-2 text-secondary whitespace-nowrap">
                    <i className="fa-sharp fa-solid fa-shield text-muted" />
                    {t("block:durable.awaitingConnectionTitle")}
                </div>
                <div className="text-xs text-secondary leading-relaxed">
                    {t("block:durable.awaitingConnectionBody")}
                </div>
                <LearnMoreButton />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary whitespace-nowrap">
                <i className="fa-sharp fa-solid fa-shield text-muted" />
                {t("block:durable.awaitingStartTitle")}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{t("block:durable.awaitingStartBody")}</div>
            <button
                className="bg-surface text-primary rounded px-3 py-1.5 text-xs font-medium hover:bg-hover transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                onClick={handleStartSession}
            >
                <i className="fa-solid fa-shield text-sky-500" />
                {t("block:durable.startSession")}
            </button>
            <LearnMoreButton />
        </div>
    );
}

interface DurableStartingContentProps {
    onClose: () => void;
}

function DurableStartingContent({ onClose }: DurableStartingContentProps) {
    const { t } = useTranslation("block");
    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-sky-300" />
                {t("block:durable.startingTitle")}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{t("block:durable.startingBody")}</div>
            <LearnMoreButton />
        </div>
    );
}

interface DurableEndedContentProps {
    doneReason: string;
    startupError?: string;
    viewModel: TermViewModel;
    onClose: () => void;
}

function DurableEndedContent({ doneReason, startupError, viewModel, onClose }: DurableEndedContentProps) {
    const { t } = useTranslation("block");
    const handleRestartSession = () => {
        onClose();
        util.fireAndForget(() => viewModel.forceRestartController());
    };

    const handleRestartAsStandard = () => {
        onClose();
        util.fireAndForget(() => viewModel.restartSessionWithDurability(false));
    };

    let titleText = t("block:durable.endedTitle");
    let descriptionText = t("block:durable.endedBody");
    const showRestartButton = true;

    if (doneReason === "terminated") {
        titleText = t("block:durable.endedExitedTitle");
        descriptionText = t("block:durable.endedExitedBody");
    } else if (doneReason === "gone") {
        titleText = t("block:durable.endedLostTitle");
        descriptionText = t("block:durable.endedLostBody");
    } else if (doneReason === "startuperror") {
        titleText = t("block:durable.failedTitle");
        descriptionText = t("block:durable.failedBody");
        return (
            <div className="flex flex-col gap-2 max-w-[280px]">
                <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                    <i className="fa-sharp fa-solid fa-shield text-muted" />
                    {titleText}
                </div>
                <div className="text-xs text-secondary leading-relaxed">{descriptionText}</div>
                {startupError && (
                    <div className="text-[11px] text-error leading-relaxed max-h-[3.5rem] overflow-y-auto">
                        {startupError}
                    </div>
                )}
                <button
                    className="bg-surface text-primary rounded px-3 py-1.5 text-xs font-medium hover:bg-hover transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    onClick={handleRestartSession}
                >
                    <i className="fa-solid fa-shield text-sky-500" />
                    {t("block:durable.restartSession")}
                </button>
                <button
                    className="bg-surface text-primary rounded px-3 py-1.5 text-xs font-medium hover:bg-hover transition-colors cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    onClick={handleRestartAsStandard}
                >
                    <i className="fa-sharp fa-regular fa-shield text-muted" />
                    {t("block:durable.restartAsStandard")}
                </button>
                <LearnMoreButton />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-muted" />
                {titleText}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{descriptionText}</div>
            {showRestartButton && (
                <button
                    className="bg-surface text-primary rounded px-3 py-1.5 text-xs font-medium hover:bg-hover transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    onClick={handleRestartSession}
                >
                    <i className="fa-solid fa-shield text-sky-500" />
                    {t("block:durable.restartSession")}
                </button>
            )}
            <LearnMoreButton />
        </div>
    );
}

function getContentToRender(
    viewModel: TermViewModel,
    onClose: () => void,
    jobStatus: BlockJobStatusData,
    connStatus: ConnStatus,
    isConfigedDurable?: boolean | null
): string | React.ReactNode {
    if (isConfigedDurable === false) {
        return <StandardSessionContent viewModel={viewModel} onClose={onClose} />;
    }

    const status = jobStatus?.status;
    if (status === "connected") {
        return <DurableAttachedContent onClose={onClose} />;
    } else if (status === "disconnected") {
        return <DurableDetachedContent onClose={onClose} />;
    } else if (status === "init") {
        return <DurableStartingContent onClose={onClose} />;
    } else if (status === "done") {
        const doneReason = jobStatus?.donereason;
        const startupError = jobStatus?.startuperror;
        return (
            <DurableEndedContent
                doneReason={doneReason}
                startupError={startupError}
                viewModel={viewModel}
                onClose={onClose}
            />
        );
    } else if (status == null) {
        return <DurableAwaitingStart connected={!!connStatus?.connected} viewModel={viewModel} onClose={onClose} />;
    }
    console.log("DurableSessionFlyover: unexpected jobStatus", jobStatus);
    return null;
}

function getIconProps(jobStatus: BlockJobStatusData, connStatus: ConnStatus, isConfigedDurable?: boolean | null) {
    let color = "text-muted";
    let iconType: "fa-solid" | "fa-regular" = "fa-solid";

    if (isConfigedDurable === false) {
        color = "text-muted";
        iconType = "fa-regular";
        return { color, iconType };
    }

    const status = jobStatus?.status;
    if (status === "connected") {
        color = "text-sky-500";
    } else if (status === "disconnected") {
        color = "text-sky-300";
    } else if (status === "init") {
        color = "text-sky-300";
    } else if (status === "done") {
        color = "text-muted";
    } else if (status == null) {
        color = "text-muted";
    }
    return { color, iconType };
}

interface DurableSessionFlyoverProps {
    blockId: string;
    viewModel: ViewModel;
    placement?: "top" | "bottom" | "left" | "right";
    divClassName?: string;
}

export function DurableSessionFlyover({
    blockId,
    viewModel,
    placement = "bottom",
    divClassName,
}: DurableSessionFlyoverProps) {
    const waveEnv = useWaveEnv<BlockEnv>();
    const connName = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "connection"));
    const termDurableStatus = util.useAtomValueSafe(viewModel?.termDurableStatus);
    const termConfigedDurable = util.useAtomValueSafe(viewModel?.termConfigedDurable);
    const connStatus = jotai.useAtomValue(waveEnv.getConnStatusAtom(connName));

    const { color: durableIconColor, iconType: durableIconType } = getIconProps(
        termDurableStatus,
        connStatus,
        termConfigedDurable
    );

    const [isOpen, setIsOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    const handleClose = () => {
        setIsVisible(false);
        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
            setIsOpen(false);
        }, 300);
    };

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: (open) => {
            if (open) {
                setIsOpen(true);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => {
                    setIsVisible(true);
                }, 300);
            } else {
                setIsVisible(false);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => {
                    setIsOpen(false);
                }, 300);
            }
        },
        placement,
        middleware: [offset(10), flip(), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const hover = useHover(context, {
        handleClose: safePolygon(),
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

    if (!isTermViewModel(viewModel)) {
        return null;
    }

    const content = getContentToRender(viewModel, handleClose, termDurableStatus, connStatus, termConfigedDurable);
    if (content == null) {
        return null;
    }

    return (
        <>
            <div ref={refs.setReference} {...getReferenceProps()} className={divClassName}>
                <i className={`fa-sharp ${durableIconType} fa-shield ${durableIconColor}`} />
            </div>
            {isOpen && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={{
                            ...floatingStyles,
                            opacity: isVisible ? 1 : 0,
                            transition: "opacity 200ms ease",
                        }}
                        {...getFloatingProps()}
                        className={cn(
                            "bg-overlay border border-border rounded-md px-3 py-2.5 text-xs text-primary shadow-xl z-50"
                        )}
                        onMouseDown={(e) => e.stopPropagation()}
                        onFocusCapture={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {content}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}
