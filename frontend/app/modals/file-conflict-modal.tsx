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
                    <div className="flex items-center gap-2 text-base font-semibold text-primary">
                        <i className="fa-solid fa-triangle-exclamation text-[14px] text-warning" />
                        File modified externally
                    </div>
                    <div className="text-[13px] leading-5 text-secondary">
                        <code className="px-1.5 py-0.5 rounded bg-surface text-secondary text-[11px] font-mono">
                            {filePath}
                        </code>{" "}
                        was modified externally while you were editing it (possibly by an AI Agent). Saving now will overwrite the external changes.
                    </div>
                    <div className="border border-border rounded-md px-3 py-2.5 bg-surface flex flex-col gap-1.5 mt-0.5">
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded bg-surface text-secondary">Base</span>
                            <span className="text-secondary">Disk version when you opened the file</span>
                        </div>
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded bg-warning/15 text-warning">External</span>
                            <span className="text-secondary">Current disk version (modified by Agent)</span>
                        </div>
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded bg-success/15 text-success">Yours</span>
                            <span className="text-secondary">Unsaved draft (based on base)</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-1.5 pt-4 w-full">
                <Button className="red ghost" onClick={() => resolveAndClose("discard")}>
                    Discard changes
                </Button>
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    Cancel
                </Button>
                <Button className="green outlined" onClick={() => resolveAndClose("copy-diff")}>
                    Copy diff
                </Button>
                <Button className="green" onClick={() => resolveAndClose("overwrite")}>
                    Save & overwrite
                </Button>
            </div>
        </FlexiModal>
    );
}

FileConflictModal.displayName = "FileConflictModal";

export { FileConflictModal };
