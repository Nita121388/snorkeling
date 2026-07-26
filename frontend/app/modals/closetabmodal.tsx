// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";

export type CloseTabModalChoice = "close" | "cancel";

type CloseTabModalProps = {
    blockCount: number;
    tabName: string;
    onResolve: (choice: CloseTabModalChoice) => void;
};

function CloseTabModal({ blockCount, tabName, onResolve }: CloseTabModalProps) {
    const resolvedRef = useRef(false);
    const resolveAndClose = (choice: CloseTabModalChoice) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        modalsModel.popModal();
        onResolve(choice);
    };

    return (
        <FlexiModal
            className="w-[420px] max-w-[calc(100vw-32px)]"
            onClickBackdrop={() => resolveAndClose("cancel")}
        >
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main">Close Tab</div>
                    <div className="text-[13px] leading-5 text-secondary">
                        Close tab <span className="font-medium text-main">{tabName || "Untitled"}</span>?
                        {blockCount > 0 && (
                            <span> {blockCount} block{blockCount !== 1 ? "s" : ""} will be closed.</span>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    Cancel
                </Button>
                <Button onClick={() => resolveAndClose("close")}>Close</Button>
            </div>
        </FlexiModal>
    );
}

CloseTabModal.displayName = "CloseTabModal";

export { CloseTabModal };
