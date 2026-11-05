// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 图片预览翻页 UI：‹ 上一张 / 下一张 › + 计数 + "下一站"跨文件夹入口 + 键盘。
//
// 交互契约（用户已确认）：
//   默认只翻本层（当前图片所在目录）；到边界时按钮原地变为"下一站/上一站"条目（单击进入）。
//   ←/→ 本层翻页；Shift+←/→ 跨站；Alt+←/→ 新 Tab 打开；Home/End 本层首尾。
//   仅在缩放=1、无文本选区、且本块为聚焦块时响应键盘（不抢缩放/选中）。

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Tooltip } from "@/app/element/tooltip";

import { focusedBlockId } from "@/util/focusutil";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { formatRemoteUri } from "@/util/waveutil";
import type { PreviewModel } from "./preview-model";
import {
    buildPagerHintTexts,
    displayStationDir,
    getPagerToast,
    resolvePager,
    resolvePagerAnchor,
    showPagerToast,
    subscribePagerToast,
    type StationInfo,
} from "./image-pager-model";
import {
    getPagerIndex,
    invalidatePagerIndex,
    pagerCacheKey,
    subscribePagerIndex,
    type PagerIndexState,
    type EnsureParams,
} from "./image-pager-index";

/** 单文件开关：出问题置 false 即回到纯缩放视图（见 design.md 回滚）。 */
export const IMAGE_PAGER_ENABLED = true;

/** 本块粘性锚点（跨站后仍用打开时的目录树）。 */
export const IMAGE_PAGER_ANCHOR_META_KEY = "preview:image-pager-anchor";

type ImagePagerProps = {
    model: PreviewModel;
    filePath: string;
    connKey: string;
};

export function ImagePager({ model, filePath, connKey }: ImagePagerProps) {
    const env = useWaveEnv();
    const blockMeta = useAtomValue(model.blockAtom)?.meta ?? {};
    const defaultSortSetting = useAtomValue(env.getSettingsKeyAtom("preview:defaultsort"));
    const sort = defaultSortSetting === "modtime" ? "modtime" : "name";
    // 缩放倍率来自 onTransformed（程序化缩放也触发）；≠1 时键盘不翻页
    const scale = useAtomValue(model.imageScale);

    // 锚点解析顺序：用户进入时的目录预览根 → 本块粘性锚点（跨站后仍有效）
    // → 图片自身目录的父目录（提升一级，让同级兄弟文件夹可达；到文件系统根不再提升）。
    // 粘性锚点很关键：翻页会改 file meta，若每次都按当前文件重算锚点，跨站一次后
    // 目录树就"塌缩"成新文件夹，用户再也回不到上一层（真机验证实测踩到）。
    const anchor = useMemo(() => {
        const meta = blockMeta as Record<string, unknown>;
        return resolvePagerAnchor({
            explorerRoot: meta["preview:explorer-root"],
            stickyAnchor: meta[IMAGE_PAGER_ANCHOR_META_KEY],
            filePath,
        });
    }, [blockMeta, filePath]);

    const key = pagerCacheKey(connKey, anchor, sort);

    const params: EnsureParams = useMemo(() => {
        const listDir = async (path: string) => {
            const remotePath = formatRemoteUri(path, connKey);
            const files = await env.rpc.FileListCommand(TabRpcClient, { path: remotePath }, null);
            return (files ?? []).map((f) => ({
                path: f.path,
                name: f.name ?? "",
                isdir: f.isdir,
                modtime: f.modtime,
            }));
        };
        return { key, anchor, sort, listDir };
    }, [key, anchor, sort, connKey, env]);

    const subscribe = useCallback(
        (cb: () => void) => subscribePagerIndex(key, params, cb),
        [key, params]
    );
    const getSnapshot = useCallback((): PagerIndexState => getPagerIndex(key, params), [key, params]);
    const index = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const res = useMemo(
        () => resolvePager(index.layer, index.stations, filePath, (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+\//g, "/")),
        [index.layer, index.stations, filePath]
    );

    // 提示走模块级 store：翻页会重挂预览视图，组件 state 会丢（实测 toast 恒 null）
    const toast = useSyncExternalStore(subscribePagerToast, getPagerToast, getPagerToast);
    const showToast = useCallback((msg: string) => showPagerToast(msg), []);

    // 悬停气泡文案（纯函数，见 image-pager-model.buildPagerHintTexts）：
    // 禁用态必须解释"为什么点不动"。
    const hints = useMemo(() => buildPagerHintTexts(res, filePath, anchor), [res, filePath, anchor]);

    const persistAnchor = useCallback(async () => {
        const meta = blockMeta as Record<string, unknown>;
        if (typeof meta[IMAGE_PAGER_ANCHOR_META_KEY] === "string") return;
        if (typeof meta["preview:explorer-root"] === "string" && meta["preview:explorer-root"] !== "") return;
        try {
            await model.setBlockMetaValue(IMAGE_PAGER_ANCHOR_META_KEY, anchor);
        } catch {
            // 元数据写失败不影响翻页本身
        }
    }, [blockMeta, anchor, model]);

    const navigate = useCallback(
        (target: string | null, opts?: { newTab?: boolean; announce?: string }) => {
            if (target == null) return;
            // 先落锚点（异步，不阻塞导航）：保证跨站后目录树仍是"打开时"的那一棵。
            // 翻页失败绝不允许静默吞掉（void 丢弃 promise 会把导航错误无声埋葬，
            // 真机验证实测：goHistory 抛错但 toast 照常弹出，块纹丝不动）。
            void persistAnchor();
            const done = opts?.newTab
                ? model.openPathInNewTab(target)
                : model.goHistory(target, { pathIsDir: false });
            Promise.resolve(done)
                .then(() => {
                    // 导航成功才提示；失败先弹成功再弹失败是倒序（审核 S7）
                    if (opts?.announce != null) {
                        showToast(opts.announce);
                    }
                })
                .catch((err) => {
                    console.error("[image-pager] navigate failed:", err);
                    showPagerToast(`翻页失败: ${String(err?.message ?? err).slice(0, 80)}`);
                });
        },
        [model, showToast, persistAnchor]
    );

    const goNext = useCallback(() => {
        if (res.next != null) {
            navigate(res.next);
            return;
        }
        if (res.nextStation != null) {
            const st = res.nextStation;
            navigate(st.first, { announce: `已进入 ${displayStationDir(st.dir, anchor)} · 第 1/${st.count} 张` });
        }
    }, [res.next, res.nextStation, navigate, anchor]);

    const goPrev = useCallback(() => {
        if (res.prev != null) {
            navigate(res.prev);
            return;
        }
        if (res.prevStation != null) {
            const st = res.prevStation;
            navigate(st.last, {
                announce: `已回到 ${displayStationDir(st.dir, anchor)} · 第 ${st.count}/${st.count} 张`,
            });
        }
    }, [res.prev, res.prevStation, navigate, anchor]);

    const goNextStation = useCallback(() => {
        const st: StationInfo | null = res.nextStation;
        if (st == null) return;
        navigate(st.first, { announce: `已进入 ${displayStationDir(st.dir, anchor)} · 1/${st.count}` });
    }, [res.nextStation, navigate, anchor]);

    const goPrevStation = useCallback(() => {
        const st: StationInfo | null = res.prevStation;
        if (st == null) return;
        navigate(st.last, { announce: `已回到 ${displayStationDir(st.dir, anchor)} · ${st.count}/${st.count}` });
    }, [res.prevStation, navigate, anchor]);

    // 键盘：仅在本块聚焦、缩放=1、无选区时消费
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.isComposing) return;
            if (focusedBlockId() !== model.blockId) return;
            if (scale !== 1) return;
            const sel = window.getSelection();
            if (sel != null && sel.rangeCount > 0 && !sel.isCollapsed) return;
            const target = e.target as HTMLElement | null;
            if (target != null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                return;
            }
            const alt = e.altKey;
            switch (e.key) {
                case "ArrowRight":
                    e.preventDefault();
                    if (e.shiftKey) goNextStation();
                    else if (alt) navigate(res.next ?? res.nextStation?.first ?? null, { newTab: true });
                    else goNext();
                    return;
                case "ArrowLeft":
                    e.preventDefault();
                    if (e.shiftKey) goPrevStation();
                    else if (alt) navigate(res.prev ?? res.prevStation?.last ?? null, { newTab: true });
                    else goPrev();
                    return;
                // Home/End 用"当前本层"（res.layer）——跨站后 index.layer 仍是锚点层，
                // 跳锚点层首尾会把用户拽回另一棵子树（审核 B3）
                case "Home": {
                    const cur = res.layer;
                    if (cur.length > 0) {
                        e.preventDefault();
                        navigate(cur[0]);
                    }
                    return;
                }
                case "End": {
                    const cur = res.layer;
                    if (cur.length > 0) {
                        e.preventDefault();
                        navigate(cur[cur.length - 1]);
                    }
                    return;
                }
                // 注意用 e.key（"r"/"R"）而不是 e.code（"KeyR"）：这里 switch 的是 key
                case "r":
                case "R":
                    if (e.shiftKey) {
                        e.preventDefault();
                        invalidatePagerIndex(key);
                        showToast("索引已失效，正在重建");
                    }
                    return;
                default:
                    return;
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [model.blockId, scale, key, goNext, goPrev, goNextStation, goPrevStation, navigate, res, showToast]);

    if (!IMAGE_PAGER_ENABLED) return null;

    const stop = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
    };

    const positionLabel =
        res.position >= 0 ? `${res.position + 1} / ${res.layerSize}` : index.building ? "索引中…" : "— / —";

    const nextIsStation = res.next == null && res.nextStation != null;
    const prevIsStation = res.prev == null && res.prevStation != null;
    const nextDisabled = res.next == null && res.nextStation == null;
    const prevDisabled = res.prev == null && res.prevStation == null;

    return (
        <>
            {/* 底部翻页条 */}
            <div
                className="absolute bottom-2 left-1/2 z-[3] flex -translate-x-1/2 flex-row items-center gap-1 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(0,0,0,0.55)] px-1.5 py-1 text-[11px] text-[var(--main-text-color)]"
                onMouseDown={stop}
                onClick={stop}
                onDoubleClick={stop}
            >
                <Tooltip content={hints.prev} divClassName="flex">
                    <button
                        type="button"
                        aria-label={prevIsStation ? "上一站" : "上一张"}
                        className="rounded px-2 py-0.5 hover:bg-[rgba(255,255,255,0.12)] disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={prevDisabled}
                        onClick={() => goPrev()}
                    >
                        {prevIsStation ? "上一站" : "‹"}
                    </button>
                </Tooltip>
                <Tooltip content={hints.counter} divClassName="flex">
                    <span className="min-w-[64px] text-center tabular-nums opacity-80">{positionLabel}</span>
                </Tooltip>
                <Tooltip content={hints.next} divClassName="flex">
                    <button
                        type="button"
                        aria-label={nextIsStation ? "下一站" : "下一张"}
                        className="rounded px-2 py-0.5 hover:bg-[rgba(255,255,255,0.12)] disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={nextDisabled}
                        onClick={() => goNext()}
                    >
                        {nextIsStation ? "下一站" : "›"}
                    </button>
                </Tooltip>
                <span className="mx-1 h-3 w-px bg-[rgba(255,255,255,0.18)]" />
                <Tooltip content={hints.refresh} divClassName="flex">
                    <button
                        type="button"
                        aria-label="重建索引"
                        className="rounded px-1.5 py-0.5 hover:bg-[rgba(255,255,255,0.12)]"
                        onClick={() => {
                            invalidatePagerIndex(key);
                            showToast("索引已失效，正在重建");
                        }}
                    >
                        ↻
                    </button>
                </Tooltip>
            </div>

            {/* 边界/截断提示：本层到底且仍有下一站时，明确告诉用户去哪儿 */}
            {nextIsStation && !index.building && (
                <div className="pointer-events-none absolute bottom-12 left-1/2 z-[3] -translate-x-1/2 rounded bg-[rgba(0,0,0,0.6)] px-2 py-1 text-[11px] opacity-80">
                    本层已看完 · 下一站：{displayStationDir(res.nextStation.dir, anchor)}（{res.nextStation.count} 张）
                </div>
            )}
            {index.truncated && (
                <div className="pointer-events-none absolute top-2 left-2 z-[3] rounded bg-[rgba(0,0,0,0.6)] px-2 py-1 text-[11px] opacity-80">
                    图片过多，索引已截断（上限 5000 张）
                </div>
            )}
            {index.error != null && (
                <div className="pointer-events-none absolute top-2 left-2 z-[3] rounded bg-[rgba(0,0,0,0.6)] px-2 py-1 text-[11px] text-[var(--error-color,#ff6b6b)]">
                    {index.error}
                </div>
            )}

            {/* 跨站浮出提示 */}
            {toast != null && (
                <div className="pointer-events-none absolute top-2 left-1/2 z-[4] -translate-x-1/2 rounded bg-[rgba(0,0,0,0.72)] px-2.5 py-1 text-[11px]">
                    {toast}
                </div>
            )}
        </>
    );
}
