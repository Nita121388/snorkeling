// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";
import { buildConflictCopyText } from "@/app/view/preview/conflict-copy";

export type FileConflictChoice = "overwrite" | "discard" | "copy-diff" | "cancel";

type FileConflictModalProps = {
    filePath: string;
    baseContent: string;
    myContent: string;
    theirsContent: string;
    onResolve: (choice: FileConflictChoice) => void;
};

function FileConflictModal({ filePath, baseContent, myContent, theirsContent, onResolve }: FileConflictModalProps) {
    const resolvedRef = useRef(false);
    const resolveAndClose = (choice: FileConflictChoice) => {
        if (resolvedRef.current) {
            return;
        }
        resolvedRef.current = true;
        modalsModel.popModal();
        if (choice === "copy-diff") {
            const text = buildConflictCopyText(filePath, baseContent, myContent, theirsContent);
            navigator.clipboard.writeText(text).catch(() => {});
        }
        onResolve(choice);
    };

    return (
        <FlexiModal
            className="w-[470px] max-w-[calc(100vw-32px)]"
            onClickBackdrop={() => resolveAndClose("cancel")}
        >
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main flex items-center gap-2">
                        <i className="fa-solid fa-triangle-exclamation text-[14px]" style={{ color: "var(--warning-color, #f59e0b)" }} />
                        文件已被外部修改
                    </div>
                    <div className="text-[13px] leading-5 text-secondary">
                        <code className="px-1.5 py-0.5 rounded bg-surface text-secondary text-[11px] font-mono">
                            {filePath}
                        </code>{" "}
                        在你编辑期间被外部修改（可能是 AI Agent）。直接保存将覆盖外部修改。
                    </div>
                    <div className="border border-border rounded-md px-3 py-2.5 bg-surface flex flex-col gap-1.5 mt-0.5">
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded bg-white/12 text-secondary">基座</span>
                            <span className="text-secondary">你打开文件时的磁盘版本</span>
                        </div>
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded" style={{ background: "rgb(230 185 86 / 0.18)", color: "#e0b956" }}>外部</span>
                            <span className="text-secondary">磁盘当前版本（Agent 已修改）</span>
                        </div>
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded" style={{ background: "rgb(88 193 66 / 0.18)", color: "#58c141" }}>你的</span>
                            <span className="text-secondary">未保存草稿（基于基座）</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-1.5 pt-4 w-full">
                <Button className="red ghost" onClick={() => resolveAndClose("discard")}>
                    <i className="fa-solid fa-trash" /> 放弃修改
                </Button>
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    取消
                </Button>
                <Button className="green outlined" onClick={() => resolveAndClose("copy-diff")}>
                    <i className="fa-solid fa-clipboard" /> 复制差异
                </Button>
                <Button className="green" onClick={() => resolveAndClose("overwrite")}>
                    <i className="fa-solid fa-floppy-disk" /> 覆盖保存
                </Button>
            </div>
        </FlexiModal>
    );
}

FileConflictModal.displayName = "FileConflictModal";

export { FileConflictModal };
