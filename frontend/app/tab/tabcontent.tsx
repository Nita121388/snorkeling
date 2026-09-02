// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { BlockSidebar } from "@/app/block/block-sidebar";
import { CenteredDiv } from "@/element/quickelems";
import { ContentRenderer, NodeModel, PreviewRenderer, TileLayout } from "@/layout/index";
import { getLayoutDataBlockIds } from "@/layout/lib/inlineTabs";
import { TileLayoutContents } from "@/layout/lib/types";
import { atoms, getApi } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { atom, useAtomValue } from "jotai";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import * as React from "react";
import { useMemo } from "react";

const tileGapSizeAtom = atom((get) => {
    const settings = get(atoms.settingsAtom);
    return settings["window:tilegapsize"];
});

const TabContent = React.memo(({ tabId, noTopPadding }: { tabId: string; noTopPadding?: boolean }) => {
    const oref = useMemo(() => WOS.makeORef("tab", tabId), [tabId]);
    const loadingAtom = useMemo(() => WOS.getWaveObjectLoadingAtom(oref), [oref]);
    const tabLoading = useAtomValue(loadingAtom);
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(oref), [oref]);
    const tabData = useAtomValue(tabAtom);
    const tileGapSize = useAtomValue(tileGapSizeAtom);

    const tileLayoutContents = useMemo(() => {
        const renderContent: ContentRenderer = (nodeModel: NodeModel) => {
            return <Block key={nodeModel.blockId} nodeModel={nodeModel} preview={false} />;
        };

        const renderPreview: PreviewRenderer = (nodeModel: NodeModel) => {
            return <Block key={nodeModel.blockId} nodeModel={nodeModel} preview={true} />;
        };

        async function onNodeDelete(data: TabLayoutData) {
            for (const blockId of getLayoutDataBlockIds(data)) {
                await services.ObjectService.DeleteBlock(blockId);
            }
        }

        return {
            renderContent,
            renderPreview,
            tabId,
            onNodeDelete,
            gapSizePx: tileGapSize,
        } as TileLayoutContents;
    }, [tabId, tileGapSize]);

    let innerContent;

    if (tabLoading) {
        innerContent = <CenteredDiv>Tab Loading</CenteredDiv>;
    } else if (!tabData) {
        innerContent = <CenteredDiv>Tab Not Found</CenteredDiv>;
    } else if ((tabData?.blockids?.length ?? 0) === 0) {
        innerContent = (
            <div className="flex flex-col items-center justify-center gap-2 text-secondary select-none">
                <i className="fa-solid fa-box-open text-2xl opacity-50" />
                <span className="text-xs font-medium">暂无 Block</span>
                <span className="text-[11px] opacity-60">按 {PLATFORM === PlatformMacOS ? "⌘N" : "Alt+N"} 新建 Block，或点击 + 新建 Tab</span>
            </div>
        );
    } else {
        innerContent = (
            <TileLayout
                key={tabId}
                contents={tileLayoutContents}
                tabAtom={tabAtom}
                getCursorPoint={getApi().getCursorPoint}
            />
        );
    }

    return (
        <div
            className={`flex flex-row flex-grow min-h-0 min-w-0 w-full items-center justify-center overflow-hidden relative ${noTopPadding ? "" : "pt-[3px]"} pr-[3px]`}
        >
            {innerContent}
            {tabData && <BlockSidebar tabId={tabId} tabAtom={tabAtom} />}
        </div>
    );
});

export { TabContent };
