// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import * as WOS from "@/app/store/wos";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { Button } from "@/element/button";
import * as jotai from "jotai";
import * as React from "react";

type TabTargetModalEnv = WaveEnvSubset<{
    atoms: {
        modalOpen: WaveEnv["atoms"]["modalOpen"];
    };
    wos: WaveEnv["wos"];
}>;

type TabTargetRowProps = {
    tabId: string;
    actionLabel: string;
    workingLabel: string;
    working: boolean;
    disabled: boolean;
    onSelect: (tabId: string) => void;
};

const TabTargetRow = React.memo(
    ({ tabId, actionLabel, workingLabel, working, disabled, onSelect }: TabTargetRowProps) => {
        const waveEnv = useWaveEnv<TabTargetModalEnv>();
        const tabAtom = waveEnv.wos.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        const tab = jotai.useAtomValue(tabAtom);
        const tabName = tab?.name || "Untitled Tab";

        return (
            <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hoverbg disabled:cursor-default disabled:opacity-60"
                disabled={disabled}
                onClick={() => onSelect(tabId)}
            >
                <div className="min-w-0">
                    <div className="truncate text-sm text-primary">{tabName}</div>
                    <div className="truncate text-[11px] text-secondary">{tabId}</div>
                </div>
                <span className="shrink-0 text-xs text-secondary">{working ? workingLabel : actionLabel}</span>
            </button>
        );
    }
);
TabTargetRow.displayName = "TabTargetRow";

type TabTargetModalProps = {
    workspace: Workspace;
    currentTabId: string;
    title: string;
    subtitle: string;
    actionLabel: string;
    workingLabel: string;
    emptyLabel?: string;
    onClose: () => void;
    onSelect: (targetTabId: string) => Promise<void>;
};

export const TabTargetModal = React.memo(
    ({
        workspace,
        currentTabId,
        title,
        subtitle,
        actionLabel,
        workingLabel,
        emptyLabel = "No other tabs",
        onClose,
        onSelect,
    }: TabTargetModalProps) => {
        const waveEnv = useWaveEnv<TabTargetModalEnv>();
        const setModalOpen = jotai.useSetAtom(waveEnv.atoms.modalOpen);
        const [workingTabId, setWorkingTabId] = React.useState<string>(null);
        const [error, setError] = React.useState<string>(null);
        const tabIds = React.useMemo(
            () => (workspace?.tabids ?? []).filter((tabId) => tabId !== currentTabId),
            [workspace?.tabids, currentTabId]
        );

        React.useEffect(() => {
            setModalOpen(true);
            return () => setModalOpen(false);
        }, [setModalOpen]);

        React.useEffect(() => {
            const handleKeyDown = (event: KeyboardEvent) => {
                if (event.key === "Escape") {
                    onClose();
                }
            };
            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }, [onClose]);

        const runTabAction = React.useCallback(
            (targetTabId: string) => {
                setWorkingTabId(targetTabId);
                setError(null);
                void (async () => {
                    try {
                        await onSelect(targetTabId);
                        onClose();
                    } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                        setWorkingTabId(null);
                    }
                })();
            },
            [onSelect, onClose]
        );

        return (
            <Modal className="w-[420px] max-w-[calc(100vw-32px)] pt-8 pb-4" onClose={onClose} onClickBackdrop={onClose}>
                <div className="mb-3 pr-8">
                    <div className="truncate text-base font-semibold text-primary">{title}</div>
                    <div className="mt-1 truncate text-xs text-secondary">{subtitle}</div>
                </div>
                <div className="max-h-[320px] w-full overflow-y-auto rounded-md border border-border/50 p-1">
                    {tabIds.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-secondary">{emptyLabel}</div>
                    ) : (
                        tabIds.map((tabId) => (
                            <TabTargetRow
                                key={tabId}
                                tabId={tabId}
                                actionLabel={actionLabel}
                                workingLabel={workingLabel}
                                working={workingTabId === tabId}
                                disabled={workingTabId != null}
                                onSelect={runTabAction}
                            />
                        ))
                    )}
                </div>
                {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
                <div className="mt-4 flex w-full justify-end">
                    <Button className="grey ghost" onClick={onClose} disabled={workingTabId != null}>
                        Cancel
                    </Button>
                </div>
            </Modal>
        );
    }
);
TabTargetModal.displayName = "TabTargetModal";
