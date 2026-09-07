// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PlacementKind, PlacementTarget } from "./block-placement-store";
import { openWidgetQuickLaunch, WidgetQuickLaunchModal } from "./widget-quick-launch";

export const blockPlacementTargetAtom = atom(null) as PrimitiveAtom<PlacementTarget | null>;
export const blockPlacementCtrlAtom = atom(false) as PrimitiveAtom<boolean>;

const DebounceMs = 300;

function getPlacementKind(y: number, rect: DOMRect): PlacementKind {
    const relativeY = (y - rect.top) / Math.max(rect.height, 1);
    if (relativeY < 1 / 3) return "before";
    if (relativeY > 2 / 3) return "after";
    return "group";
}

function sameTarget(a: PlacementTarget | null, b: PlacementTarget | null): boolean {
    return a?.blockId === b?.blockId && a?.kind === b?.kind;
}

function Preview({ target }: { target: PlacementTarget }) {
    const { rect, kind } = target;
    // 落点横线：贴目标 block 顶部（before）/底部（after）。group 模式不再画横线，改用卡片内提示。
    const lineStyle: React.CSSProperties = {
        position: "fixed",
        left: rect.left,
        width: rect.width,
        height: 3,
        pointerEvents: "none",
        zIndex: 9998,
        background: "var(--accent-color, #60a5fa)",
        borderRadius: 2,
        boxShadow: "0 0 6px var(--accent-color, #60a5fa)",
        top: kind === "after" ? rect.top + rect.height - 1 : rect.top - 1,
    };
    // 幽灵卡片：跟随鼠标的半透明 block 预览，复刻拖拽 block 的视觉。
    const cardStyle: React.CSSProperties = {
        position: "fixed",
        left: target.x - 8,
        top: target.y + 14,
        width: 240,
        height: 96,
        pointerEvents: "none",
        zIndex: 9999,
        border: "1.5px dashed var(--accent-color, #60a5fa)",
        background: "color-mix(in srgb, var(--accent-color, #60a5fa) 12%, var(--block-bg-color, #1e1e1e))",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        opacity: 0.8,
        color: "var(--text-secondary, #999)",
        boxShadow: "0 6px 18px rgb(0 0 0 / 0.3)",
    };
    return createPortal(
        <>
            {kind !== "group" && <div className="block-placement-line" style={lineStyle} aria-hidden="true" />}
            <div className="block-placement-card" style={cardStyle} aria-hidden="true">
                <i
                    className="fa-regular fa-square-plus"
                    style={{ fontSize: 22, color: "var(--accent-color, #60a5fa)" }}
                />
                <span style={{ fontSize: 12 }}>{kind === "group" ? "Create in group" : "New Block"}</span>
            </div>
        </>,
        document.body
    );
}

export function BlockPlacementController() {
    const target = useAtomValue(blockPlacementTargetAtom);
    const ctrlPressed = useAtomValue(blockPlacementCtrlAtom);
    const launcherOpenRef = useRef(false);
    const lastTargetRef = useRef<PlacementTarget | null>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const clearTimer = () => {
            if (timerRef.current != null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
        const clear = () => {
            clearTimer();
            launcherOpenRef.current = false;
            lastTargetRef.current = null;
            globalStore.set(blockPlacementTargetAtom, null);
            globalStore.set(blockPlacementCtrlAtom, false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Control") return;
            if (!event.repeat) globalStore.set(blockPlacementCtrlAtom, true);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Control") clear();
        };
        const onBlur = clear;
        const onMouseMove = (event: MouseEvent) => {
            if (!globalStore.get(blockPlacementCtrlAtom) || launcherOpenRef.current) return;
            const element = (event.target as Element | null)?.closest?.("[data-blockid]") as HTMLElement | null;
            if (!element) {
                clearTimer();
                lastTargetRef.current = null;
                globalStore.set(blockPlacementTargetAtom, null);
                return;
            }
            const blockId = element.dataset.blockid;
            if (!blockId) return;
            const rect = element.getBoundingClientRect();
            const next: PlacementTarget = {
                blockId,
                kind: getPlacementKind(event.clientY, rect),
                x: event.clientX,
                y: event.clientY,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            };
            if (sameTarget(lastTargetRef.current, next)) return;
            clearTimer();
            lastTargetRef.current = next;
            globalStore.set(blockPlacementTargetAtom, next);
            timerRef.current = window.setTimeout(() => {
                const current = globalStore.get(blockPlacementTargetAtom);
                if (current && sameTarget(current, next) && globalStore.get(blockPlacementCtrlAtom)) {
                    launcherOpenRef.current = true;
                    openWidgetQuickLaunch(current);
                }
                timerRef.current = null;
            }, DebounceMs);
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        document.addEventListener("mousemove", onMouseMove);
        // 监听弹窗栈：Quick Launch 被关闭（Esc/取消/创建）后复位 launcherOpenRef，
        // 让停留在 HOVERING 状态的预览能在下次 300ms 悬停时再次弹窗。
        const unob = globalStore.sub(modalsModel.modalsAtom, () => {
            if (launcherOpenRef.current && !modalsModel.isModalOpen(WidgetQuickLaunchModal.displayName)) {
                launcherOpenRef.current = false;
            }
        });
        return () => {
            unob();
            clear();
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
            document.removeEventListener("mousemove", onMouseMove);
        };
    }, []);

    if (!ctrlPressed || target == null) return null;
    return <Preview target={target} />;
}
