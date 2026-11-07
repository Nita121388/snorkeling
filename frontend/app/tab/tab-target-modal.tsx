// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import * as WOS from "@/app/store/wos";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";

type TabTargetModalEnv = WaveEnvSubset<{
    atoms: {
        modalOpen: WaveEnv["atoms"]["modalOpen"];
    };
    wos: WaveEnv["wos"];
}>;

/**
 * 行内动作。一个行可以挂多个（Move / Copy），行体点击执行 `primary` 那一个。
 *
 * 为什么不用「模式切换」：模式把动作变成状态，用户要先理解「现在处于 Copy 模式」再选目标，
 * 多一次心理建模。每行两个图标 = 一步完成，且没有隐式状态。
 */
export type TabRowAction = {
    /** 稳定 key，用于 spinner 定位与 DOM 断言（"move" / "copy"）。 */
    key: string;
    /** 按钮文案：鼠标看 title，读屏看 aria-label，两处都写。 */
    label: string;
    /** 图标节点（内联 SVG 或 <i>）；同一行多个动作必须同一套图标体系。 */
    icon: React.ReactNode;
    /** 是否作为行体点击的默认动作。有且只有一个应为 true。 */
    primary?: boolean;
    /** 执行。reject → 弹窗展示错误行并恢复可用。 */
    run: (args: { targetTabId: string }) => Promise<void>;
};

/** `New tab` 行在 working 状态里用的哨兵 key（不进 workspace.tabids）。 */
export const NewTabRowKey = "__new__";

/** 旧单动作路径（无 `rowActions`）下行体点击用的合成动作。 */
const LegacyRowAction: TabRowAction = { key: "default", label: "", icon: null, primary: true, run: async () => {} };

type TabRowProps = {
    rowKey: string;
    /** 行主标题。 */
    title: React.ReactNode;
    /** 行副标题（可选）。 */
    hint?: React.ReactNode;
    /** 标题左侧的前置图标（New tab 行的 ＋）。 */
    leading?: React.ReactNode;
    /** 行是否代表「新建」。 */
    isNew?: boolean;
    /** 动作集合；为空则退回旧单动作渲染。 */
    actions: TabRowAction[];
    /** 旧单动作路径的静态文案 / working 文案。 */
    actionLabel: string;
    workingLabel: string;
    /** 正在执行的动作 key；null = 空闲。 */
    workingActionKey: string | null;
    /** 是否禁用（其它行正在跑，或本行正在跑）。 */
    disabled: boolean;
    onRun: (action: TabRowAction) => void;
};

const TabRow = React.memo(
    ({
        rowKey,
        title,
        hint,
        leading,
        isNew,
        actions,
        actionLabel,
        workingLabel,
        workingActionKey,
        disabled,
        onRun,
    }: TabRowProps) => {
        const primary = actions.find((action) => action.primary) ?? actions[0] ?? null;
        const isWorking = workingActionKey != null;
        const rowDisabled = disabled || isWorking;

        const runPrimary = React.useCallback(() => {
            if (rowDisabled) return;
            // 旧单动作路径（actions 为空）：用一个「无图标」的合成动作承载行体点击，
            // 否则 New tab 行在单动作模式下点了没反应（实测踩到）。
            onRun(primary ?? LegacyRowAction);
        }, [rowDisabled, primary, onRun]);

        const handleKeyDown = React.useCallback(
            (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                // 图标按钮自己的 Enter/Space 由原生 button 处理，不要重复触发行体动作。
                if ((event.target as HTMLElement).closest(".row-icon-btn") != null) return;
                event.preventDefault();
                runPrimary();
            },
            [runPrimary]
        );

        const legacySingleAction = actions.length === 0;

        return (
            <div
                role="button"
                tabIndex={0}
                aria-disabled={rowDisabled ? "true" : "false"}
                className={cn(
                    "tab-target-row flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-hoverbg",
                    isNew && "new-tab-row",
                    isWorking && "is-working"
                )}
                data-new-tab={isNew ? "" : undefined}
                data-tab-row={isNew ? undefined : ""}
                data-row-key={rowKey}
                onClick={runPrimary}
                onKeyDown={handleKeyDown}
            >
                <span className={cn("min-w-0", !isNew && "row-main")}>
                    {isNew ? (
                        <span className="row-left">
                            {leading != null ? leading : null}
                            <span className="row-main">
                                <span className="row-name truncate text-sm text-primary">{title}</span>
                                {hint != null ? <span className="row-hint">{hint}</span> : null}
                            </span>
                        </span>
                    ) : (
                        <span className="row-name block truncate text-sm text-primary">{title}</span>
                    )}
                    {!isNew && hint != null ? <span className="row-hint block">{hint}</span> : null}
                </span>
                {legacySingleAction ? (
                    <span className="tab-target-action shrink-0">
                        {isWorking ? (
                            <span className="tab-target-spinner" aria-label={workingLabel} title={workingLabel} />
                        ) : (
                            <>
                                <span className="tab-target-action-label text-xs text-secondary">{actionLabel}</span>
                                <span className="tab-target-action-btn">{actionLabel}</span>
                            </>
                        )}
                    </span>
                ) : (
                    <span className="row-icons" data-icons="">
                        {actions.map((action) => {
                            const actionWorking = workingActionKey === action.key;
                            return (
                                <button
                                    key={action.key}
                                    type="button"
                                    className="row-icon-btn"
                                    data-act={action.key}
                                    title={action.label}
                                    aria-label={action.label}
                                    disabled={rowDisabled}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (rowDisabled) return;
                                        onRun(action);
                                    }}
                                >
                                    {actionWorking ? (
                                        <span
                                            className="tab-target-spinner"
                                            role="img"
                                            aria-label={workingLabel}
                                            title={workingLabel}
                                        />
                                    ) : (
                                        action.icon
                                    )}
                                </button>
                            );
                        })}
                    </span>
                )}
            </div>
        );
    }
);
TabRow.displayName = "TabRow";

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
    /**
     * New tab 行的「单动作」入口。传了才渲染 New tab 行（置顶、永远可用）。
     *
     * 两条路径（互斥，按是否传 `rowActions` 决定）：
     *  - 不传 `rowActions` → New tab 行整行一个动作，点它 = 调 `onCreate`；
     *  - 传 `rowActions` → New tab 行也带 N 个图标，点图标 = 用 `targetTabId = NewTabRowKey`
     *    跑对应动作（调用方把哨兵翻成「建 tab + 该动作」），行体 = primary 动作。
     *
     * 不传 `onCreate` 且不传 `rowActions` → 不渲染 New tab 行，与改动前逐字段一致
     * （`widgets.tsx` 的 Create 弹窗不受影响）。
     */
    onCreate?: () => Promise<void>;
    /** New tab 行副标题，如 `Named after «Snorkeling»`。 */
    createHint?: React.ReactNode;
    /** New tab 行主标题，默认 `New tab`。 */
    createLabel?: React.ReactNode;
    /**
     * 每行的动作集合。传了 → 行内渲染 N 个 icon 按钮，行体点击执行 `primary`；
     * 不传 → 走旧单动作路径（`actionLabel` / `workingLabel` / `onSelect`）。
     */
    rowActions?: TabRowAction[];
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
        onCreate,
        createHint,
        createLabel = "New tab",
        rowActions,
    }: TabTargetModalProps) => {
        const waveEnv = useWaveEnv<TabTargetModalEnv>();
        const setModalOpen = jotai.useSetAtom(waveEnv.atoms.modalOpen);
        /** 正在执行：行 key + 动作 key。只知道「哪一行在跑」不够 —— 同一行现在有两个动作。 */
        const [working, setWorking] = React.useState<{ rowKey: string; actionKey: string } | null>(null);
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

        const runAction = React.useCallback(
            (rowKey: string, actionKey: string, exec: () => Promise<void>) => {
                setWorking({ rowKey, actionKey });
                setError(null);
                void (async () => {
                    try {
                        await exec();
                        // 成功也要复位：真实场景里弹窗随即关闭，但状态留着会让
                        // 「弹窗复用 / 关闭失败」时永久卡在忙碌态（实测踩到）。
                        setWorking(null);
                        onClose();
                    } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                        setWorking(null);
                    }
                })();
            },
            [onClose]
        );

        const runTabAction = React.useCallback(
            (rowKey: string, actionKey: string, action: TabRowAction) => {
                runAction(rowKey, actionKey, () => action.run({ targetTabId: rowKey }));
            },
            [runAction]
        );

        /** 旧单动作路径：整行只有一个动作。 */
        const runLegacyAction = React.useCallback(
            (rowKey: string) => {
                runAction(rowKey, "default", () => onSelect(rowKey));
            },
            [runAction, onSelect]
        );

        /** 单动作路径下 New tab 行的执行体（`rowActions` 未传时才走这里）。 */
        const runCreate = React.useCallback(() => {
            if (onCreate == null) return;
            runAction(NewTabRowKey, "create", onCreate);
        }, [onCreate, runAction]);

        const actionsFor = React.useCallback(
            (rowKey: string): TabRowAction[] => {
                if (rowActions == null || rowActions.length === 0) return [];
                return rowActions.map((action) => ({
                    ...action,
                    run: async (args) => {
                        await action.run({ targetTabId: rowKey });
                    },
                }));
            },
            [rowActions]
        );

        /** 任意行在跑 → 其余全部禁用（一次只允许一个动作，避免并发改布局）。 */
        const busy = working != null;

        return (
            <Modal
                className="w-[420px] max-w-[calc(100vw-32px)]"
                onClose={onClose}
                onClickBackdrop={onClose}
                title={title}
                subtitle={subtitle}
            >
                <div
                    className="max-h-[320px] w-full overflow-y-auto rounded-md border border-border/50 p-1"
                    data-target-list=""
                >
                    {onCreate != null ? (
                        <>
                            <TabRow
                                rowKey={NewTabRowKey}
                                title={createLabel}
                                hint={createHint}
                                leading={<span className="plus-box">＋</span>}
                                isNew
                                actions={rowActions ?? []}
                                actionLabel="Create"
                                workingLabel={workingLabel}
                                workingActionKey={
                                    working?.rowKey === NewTabRowKey ? working.actionKey : null
                                }
                                disabled={busy && working?.rowKey !== NewTabRowKey}
                                onRun={(action) => {
                                    if (rowActions == null || rowActions.length === 0) {
                                        runCreate();
                                        return;
                                    }
                                    // 有图标时，动作带上哨兵 targetTabId —— 调用方负责翻成
                                    // 「建 tab + 在该 tab 里做这个动作」。
                                    runAction(NewTabRowKey, action.key, () =>
                                        action.run({ targetTabId: NewTabRowKey })
                                    );
                                }}
                            />
                            <div className="list-divider" />
                        </>
                    ) : null}
                    {tabIds.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-secondary">{emptyLabel}</div>
                    ) : (
                        tabIds.map((tabId) => (
                            <TabTargetRowWithName
                                key={tabId}
                                tabId={tabId}
                                rowActions={actionsFor(tabId)}
                                actionLabel={actionLabel}
                                workingLabel={workingLabel}
                                workingActionKey={
                                    working?.rowKey === tabId ? working.actionKey : null
                                }
                                disabled={busy && working?.rowKey !== tabId}
                                onRunAction={(action) => runTabAction(tabId, action.key, action)}
                                onRunLegacy={() => runLegacyAction(tabId)}
                            />
                        ))
                    )}
                </div>
                {error && <div className="mt-3 text-xs text-error" data-error="">{error}</div>}
                <div className="mt-4 flex w-full justify-end">
                    <Button className="grey ghost" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                </div>
            </Modal>
        );
    }
);
TabTargetModal.displayName = "TabTargetModal";

type TabTargetRowWithNameProps = {
    tabId: string;
    rowActions: TabRowAction[];
    actionLabel: string;
    workingLabel: string;
    workingActionKey: string | null;
    disabled: boolean;
    onRunAction: (action: TabRowAction) => void;
    onRunLegacy: () => void;
};

/** 取 tab 名的薄包装：名字订阅留在这里，行组件本身保持纯展示。 */
const TabTargetRowWithName = React.memo(
    ({
        tabId,
        rowActions,
        actionLabel,
        workingLabel,
        workingActionKey,
        disabled,
        onRunAction,
        onRunLegacy,
    }: TabTargetRowWithNameProps) => {
        const waveEnv = useWaveEnv<TabTargetModalEnv>();
        const tabAtom = waveEnv.wos.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        const tab = jotai.useAtomValue(tabAtom);
        const tabName = tab?.name || "Untitled Tab";

        return (
            <TabRow
                rowKey={tabId}
                title={tabName}
                actions={rowActions}
                actionLabel={actionLabel}
                workingLabel={workingLabel}
                workingActionKey={workingActionKey}
                disabled={disabled}
                onRun={(action) => (rowActions.length === 0 ? onRunLegacy() : onRunAction(action))}
            />
        );
    }
);
TabTargetRowWithName.displayName = "TabTargetRowWithName";
