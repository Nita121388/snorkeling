// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    BlockComponentModel2,
    BlockProps,
    FullBlockProps,
    FullSubBlockProps,
    SubBlockProps,
} from "@/app/block/blocktypes";
import { uxCloseBlock } from "@/app/store/keymodel";
import { useTabModel } from "@/app/store/tab-model";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import type { LayoutNode } from "@/layout/index";
import { getLayoutModelForTabById, TileItemType, useDebouncedNodeInnerRect } from "@/layout/index";
import { getLayoutDataActiveBlockId, getLayoutDataBlockIds } from "@/layout/lib/inlineTabs";
import { counterInc } from "@/store/counters";
import { getBlockComponentModel, registerBlockComponentModel, unregisterBlockComponentModel } from "@/store/global";
import { makeORef } from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import { isBlank, makeIconClass, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import "./block.scss";
import { BlockEnv } from "./blockenv";
import { BlockFrame } from "./blockframe";
import { makeViewModel } from "./blockregistry";
import { blockViewToIcon, blockViewToName } from "./blockutil";

function getViewElem(
    blockId: string,
    blockRef: React.RefObject<HTMLDivElement>,
    contentRef: React.RefObject<HTMLDivElement>,
    blockView: string,
    viewModel: ViewModel
): React.ReactElement {
    if (isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (viewModel.viewComponent == null) {
        return <CenteredDiv>No View Component</CenteredDiv>;
    }
    const VC = viewModel.viewComponent;
    return <VC key={blockId} blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={viewModel} />;
}

function basename(path: string): string {
    if (isBlank(path)) {
        return "";
    }
    const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
    return normalized.split("/").pop() || normalized;
}

type InlineTabLabelProps = {
    blockId: string;
    layoutData: TabLayoutData;
    isActive: boolean;
    duplicateIndex?: number;
    onActivate: () => void;
    onClose: () => void;
    onRename: (title: string) => void;
};

const InlineTabLabel = memo(
    ({ blockId, layoutData, isActive, duplicateIndex, onActivate, onClose, onRename }: InlineTabLabelProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const blockData = useAtomValue(waveEnv.wos.getWaveObjectAtom<Block>(makeORef("block", blockId)));
        const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "view")) ?? "";
        const frameTitle = useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "frame:title"));
        const filePath = typeof blockData?.meta?.["file:path"] === "string" ? blockData.meta["file:path"] : "";
        const connection = useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "connection"));
        const customTitle = layoutData.blockTabTitles?.[blockId];
        const [isEditing, setIsEditing] = useState(false);
        const [draftTitle, setDraftTitle] = useState(customTitle ?? "");
        const inputRef = useRef<HTMLInputElement>(null);

        const defaultTitle = useMemo(() => {
            if (!isBlank(frameTitle)) {
                return frameTitle;
            }
            if (blockView === "preview" && !isBlank(filePath)) {
                return basename(filePath);
            }
            if (blockView === "term" && !isBlank(connection)) {
                return connection;
            }
            return blockViewToName(blockView) || blockId.slice(0, 8);
        }, [blockId, blockView, connection, filePath, frameTitle]);
        const title = customTitle || defaultTitle;
        const displayTitle =
            duplicateIndex != null && duplicateIndex > 1 && !customTitle ? `${title} ${duplicateIndex}` : title;
        const iconClass = makeIconClass(blockViewToIcon(blockView), true);

        useEffect(() => {
            if (isEditing) {
                setDraftTitle(customTitle ?? "");
                inputRef.current?.select();
            }
        }, [customTitle, isEditing]);

        const commitRename = useCallback(() => {
            setIsEditing(false);
            onRename(draftTitle);
        }, [draftTitle, onRename]);

        if (isEditing) {
            return (
                <input
                    ref={inputRef}
                    className="inline-tab-block-tab-input"
                    value={draftTitle}
                    placeholder={defaultTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            commitRename();
                        } else if (e.key === "Escape") {
                            setIsEditing(false);
                            setDraftTitle(customTitle ?? "");
                        }
                    }}
                />
            );
        }

        return (
            <div className={clsx("inline-tab-block-tab", { active: isActive })}>
                <button
                    type="button"
                    className="inline-tab-block-tab-main"
                    title={customTitle ? `${customTitle} (${defaultTitle})` : defaultTitle}
                    onClick={onActivate}
                    onDoubleClick={() => setIsEditing(true)}
                >
                    <i className={iconClass} />
                    <span>{displayTitle}</span>
                </button>
                <button
                    type="button"
                    className="inline-tab-block-tab-close"
                    title="Close Block"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onClose();
                    }}
                >
                    <i className={makeIconClass("xmark", true)} />
                </button>
            </div>
        );
    }
);
InlineTabLabel.displayName = "InlineTabLabel";

const InlineTabBlockMissingGuard = memo(
    ({ blockId, onMissingBlock }: { blockId: string; onMissingBlock: () => void }) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", blockId)));

        useEffect(() => {
            if (blockIsNull) {
                onMissingBlock();
            }
        }, [blockIsNull, onMissingBlock]);

        return null;
    }
);
InlineTabBlockMissingGuard.displayName = "InlineTabBlockMissingGuard";

function getDuplicateIndexes(blockIds: string[], titles: Record<string, string>): Map<string, number> {
    const counts = new Map<string, number>();
    const indexes = new Map<string, number>();
    for (const blockId of blockIds) {
        const title = titles[blockId] ?? blockId;
        const nextCount = (counts.get(title) ?? 0) + 1;
        counts.set(title, nextCount);
        indexes.set(blockId, nextCount);
    }
    return indexes;
}

const InlineTabBlock = memo(({ nodeModel, preview, layoutData }: BlockProps & { layoutData: TabLayoutData }) => {
    const tabModel = useTabModel();
    const layoutModel = getLayoutModelForTabById(tabModel.tabId);
    const blockIds = getLayoutDataBlockIds(layoutData);
    const blockIdsKey = blockIds.join("\n");
    const activeBlockId = getLayoutDataActiveBlockId(layoutData) ?? blockIds[0];
    const activeLayoutDataAtom = useMemo(() => atom<TabLayoutData>(layoutData), [layoutData]);
    const activeNodeModel = useMemo(
        () => ({
            ...nodeModel,
            blockId: activeBlockId,
            layoutData: activeLayoutDataAtom,
        }),
        [activeBlockId, activeLayoutDataAtom, nodeModel]
    );
    const titleMap = useMemo(() => {
        return Object.fromEntries(
            blockIds.map((blockId) => [blockId, layoutData.blockTabTitles?.[blockId] ?? blockId])
        );
    }, [blockIds, layoutData.blockTabTitles]);
    const duplicateIndexes = useMemo(() => getDuplicateIndexes(blockIds, titleMap), [blockIds, titleMap]);

    const cleanupMissingBlocks = useCallback(() => {
        if (!layoutModel) {
            return;
        }
        const validBlockIds = blockIds.filter((blockId) => layoutModel.getBlockById(blockId) != null);
        layoutModel.cleanupInlineTabBlockIds(nodeModel.nodeId, validBlockIds);
    }, [blockIdsKey, layoutModel, nodeModel.nodeId]);
    const [, dropInlineTabBlock] = useDrop(
        () => ({
            accept: TileItemType,
            canDrop: (dragItem: LayoutNode) => {
                return dragItem.id !== nodeModel.nodeId;
            },
            hover: (dragItem: LayoutNode) => {
                layoutModel?.setPendingInlineTabMerge(nodeModel.nodeId, dragItem.id);
            },
            drop: (dragItem: LayoutNode, monitor) => {
                if (!monitor.didDrop() && layoutModel?.setPendingInlineTabMerge(nodeModel.nodeId, dragItem.id)) {
                    layoutModel.onDrop();
                }
            },
        }),
        [layoutModel, nodeModel.nodeId]
    );

    if (blockIds.length <= 1 || !activeBlockId) {
        return <Block key={activeBlockId} nodeModel={activeNodeModel} preview={preview} />;
    }

    return (
        <div className="inline-tab-block">
            {blockIds.map((blockId) => (
                <InlineTabBlockMissingGuard
                    key={`missing-guard-${blockId}`}
                    blockId={blockId}
                    onMissingBlock={cleanupMissingBlocks}
                />
            ))}
            {!preview && (
                <div ref={dropInlineTabBlock} className="inline-tab-block-tabs">
                    {blockIds.map((blockId) => (
                        <InlineTabLabel
                            key={blockId}
                            blockId={blockId}
                            layoutData={layoutData}
                            isActive={blockId === activeBlockId}
                            duplicateIndex={duplicateIndexes.get(blockId)}
                            onActivate={() => layoutModel?.setActiveInlineTabBlock(nodeModel.nodeId, blockId)}
                            onClose={() => uxCloseBlock(blockId)}
                            onRename={(title) => layoutModel?.setInlineTabTitle(nodeModel.nodeId, blockId, title)}
                        />
                    ))}
                </div>
            )}
            <div className="inline-tab-block-active">
                <SingleBlock
                    key={activeBlockId}
                    nodeModel={activeNodeModel}
                    preview={preview}
                    activeBlockId={activeBlockId}
                    layoutDataOverride={layoutData}
                />
            </div>
        </div>
    );
});
InlineTabBlock.displayName = "InlineTabBlock";

const BlockPreview = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", nodeModel.blockId)));
    if (blockIsNull) {
        return null;
    }
    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockSubBlock = memo(({ nodeModel, viewModel }: FullSubBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", nodeModel.blockId)));
    const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view")) ?? "";
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockView, viewModel),
        [nodeModel.blockId, blockView, viewModel]
    );
    const noPadding = useAtomValueSafe(viewModel.noPadding);
    if (blockIsNull) {
        return null;
    }
    return (
        <div key="content" className={clsx("block-content", { "block-no-padding": noPadding })} ref={contentRef}>
            <ErrorBoundary>
                <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
            </ErrorBoundary>
        </div>
    );
});

const BlockFull = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const waveEnv = useWaveEnv<BlockEnv>();
    const focusElemRef = useRef<HTMLInputElement>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const pendingFocusRafRef = useRef<number | null>(null);
    const [blockClicked, setBlockClicked] = useState(false);
    const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view")) ?? "";
    const isFocused = useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = useAtomValue(nodeModel.disablePointerEvents);
    const isResizing = useAtomValue(nodeModel.isResizing);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const anyMagnified = useAtomValue(nodeModel.anyMagnified);
    const modalOpen = useAtomValue(waveEnv.atoms.modalOpen);
    const focusFollowsCursorMode = useAtomValue(waveEnv.getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const innerRect = useDebouncedNodeInnerRect(nodeModel);
    const noPadding = useAtomValueSafe(viewModel.noPadding);

    useEffect(() => {
        return () => {
            if (pendingFocusRafRef.current != null) {
                cancelAnimationFrame(pendingFocusRafRef.current);
            }
        };
    }, []);

    useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = focusedBlockId() == nodeModel.blockId;
        if (!focusWithin) {
            setFocusTarget();
        }
        if (!isFocused) {
            nodeModel.focusNode();
        }
    }, [blockClicked, isFocused]);

    const setBlockClickedTrue = useCallback(() => {
        setBlockClicked(true);
    }, []);

    const [blockContentOffset, setBlockContentOffset] = useState<Dimensions>();

    useEffect(() => {
        if (blockRef.current && contentRef.current) {
            const blockRect = blockRef.current.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();
            setBlockContentOffset({
                top: 0,
                left: 0,
                width: blockRect.width - contentRect.width,
                height: blockRect.height - contentRect.height,
            });
        }
    }, [blockRef, contentRef]);

    const blockContentStyle = useMemo<React.CSSProperties>(() => {
        const retVal: React.CSSProperties = {
            pointerEvents: disablePointerEvents ? "none" : undefined,
        };
        if (innerRect?.width && innerRect.height && blockContentOffset) {
            retVal.width = `calc(${innerRect?.width} - ${blockContentOffset.width}px)`;
            retVal.height = `calc(${innerRect?.height} - ${blockContentOffset.height}px)`;
        }
        return retVal;
    }, [innerRect, disablePointerEvents, blockContentOffset]);

    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockView, viewModel),
        [nodeModel.blockId, blockView, viewModel]
    );

    const handleChildFocus = useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            console.log("setFocusedChild", nodeModel.blockId, getElemAsStr(event.target));
            if (!isFocused) {
                console.log("focusedChild focus", nodeModel.blockId);
                nodeModel.focusNode();
            }
        },
        [isFocused]
    );

    const setFocusTarget = useCallback(() => {
        if (pendingFocusRafRef.current != null) {
            cancelAnimationFrame(pendingFocusRafRef.current);
            pendingFocusRafRef.current = null;
        }
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
        pendingFocusRafRef.current = requestAnimationFrame(() => {
            pendingFocusRafRef.current = null;
            if (blockRef.current?.contains(document.activeElement)) {
                viewModel?.giveFocus?.();
            }
        });
    }, [viewModel]);

    const focusFromPointerEnter = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            const focusFollowsCursorEnabled =
                focusFollowsCursorMode === "on" || (focusFollowsCursorMode === "term" && blockView === "term");
            if (!focusFollowsCursorEnabled || event.pointerType === "touch" || event.buttons > 0) {
                return;
            }
            if (modalOpen || disablePointerEvents || isResizing || (anyMagnified && !isMagnified)) {
                return;
            }
            if (isFocused && focusedBlockId() === nodeModel.blockId) {
                return;
            }
            setFocusTarget();
            if (!isFocused) {
                nodeModel.focusNode();
            }
        },
        [
            focusFollowsCursorMode,
            blockView,
            modalOpen,
            disablePointerEvents,
            isResizing,
            isMagnified,
            anyMagnified,
            isFocused,
            nodeModel,
            setFocusTarget,
        ]
    );

    const blockModel = useMemo<BlockComponentModel2>(
        () => ({
            onClick: setBlockClickedTrue,
            onPointerEnter: focusFromPointerEnter,
            onFocusCapture: handleChildFocus,
            blockRef: blockRef,
        }),
        [setBlockClickedTrue, focusFromPointerEnter, handleChildFocus, blockRef]
    );

    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    id={`${nodeModel.blockId}-dummy-focus`} // don't change this name (used in refocusNode)
                    className="dummy-focus"
                    onChange={() => {}}
                />
            </div>
            <div
                key="content"
                className={clsx("block-content", { "block-no-padding": noPadding })}
                ref={contentRef}
                style={blockContentStyle}
            >
                <ErrorBoundary>
                    <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const BlockInner = memo((props: BlockProps & { viewType: string }) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const waveEnv = useWaveEnv();
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null) {
        // viewModel gets the full waveEnv
        viewModel = makeViewModel(props.nodeModel.blockId, props.viewType, props.nodeModel, tabModel, waveEnv);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        console.log("[block-remount-debug] mount", {
            blockId: props.nodeModel.blockId,
            nodeId: props.nodeModel.nodeId,
            viewType: props.viewType,
        });
        return () => {
            console.log("[block-remount-debug] unmount", {
                blockId: props.nodeModel.blockId,
                nodeId: props.nodeModel.nodeId,
                viewType: props.viewType,
            });
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});
BlockInner.displayName = "BlockInner";

const SingleBlock = memo((props: BlockProps & { activeBlockId: string; layoutDataOverride?: TabLayoutData }) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const { activeBlockId, layoutDataOverride } = props;
    const activeLayoutDataAtom = useMemo(
        () => atom<TabLayoutData>(layoutDataOverride ?? { blockId: activeBlockId }),
        [activeBlockId, layoutDataOverride]
    );
    const activeNodeModel = useMemo(
        () => ({
            ...props.nodeModel,
            blockId: activeBlockId,
            layoutData: activeLayoutDataAtom,
        }),
        [activeBlockId, activeLayoutDataAtom, props.nodeModel]
    );
    const isNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", activeBlockId)));
    const viewType = useAtomValue(waveEnv.getBlockMetaKeyAtom(activeBlockId, "view")) ?? "";
    if (isNull || isBlank(activeBlockId)) {
        return null;
    }
    return (
        <BlockInner key={activeBlockId + ":" + viewType} {...props} nodeModel={activeNodeModel} viewType={viewType} />
    );
});
SingleBlock.displayName = "SingleBlock";

const Block = memo((props: BlockProps) => {
    const layoutData = useAtomValue(props.nodeModel.layoutData);
    const blockIds = getLayoutDataBlockIds(layoutData);
    if (blockIds.length > 1) {
        return <InlineTabBlock {...props} layoutData={layoutData} />;
    }
    const activeBlockId = getLayoutDataActiveBlockId(layoutData) ?? props.nodeModel.blockId;
    return <SingleBlock {...props} activeBlockId={activeBlockId} />;
});

const SubBlockInner = memo((props: SubBlockProps & { viewType: string }) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const waveEnv = useWaveEnv();
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null) {
        // viewModel gets the full waveEnv
        viewModel = makeViewModel(props.nodeModel.blockId, props.viewType, props.nodeModel, tabModel, waveEnv);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    return <BlockSubBlock {...props} viewModel={viewModel} />;
});
SubBlockInner.displayName = "SubBlockInner";

const SubBlock = memo((props: SubBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const isNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", props.nodeModel.blockId)));
    const viewType = useAtomValue(waveEnv.getBlockMetaKeyAtom(props.nodeModel.blockId, "view")) ?? "";
    if (isNull || isBlank(props.nodeModel.blockId)) {
        return null;
    }
    return <SubBlockInner key={props.nodeModel.blockId + ":" + viewType} {...props} viewType={viewType} />;
});

export { Block, SubBlock };
