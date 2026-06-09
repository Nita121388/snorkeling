// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";

export type UnsavedFileModalChoice = "save" | "discard" | "cancel";

type UnsavedFileModalProps = {
    fileName: string;
    onResolve: (choice: UnsavedFileModalChoice) => void;
};

function UnsavedFileModal({ fileName, onResolve }: UnsavedFileModalProps) {
    const resolvedRef = useRef(false);
    const resolveAndClose = (choice: UnsavedFileModalChoice) => {
        if (resolvedRef.current) {
            return;
        }
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
                    <div className="text-[15px] font-semibold text-main">Unsaved Changes</div>
                    <div className="text-[13px] leading-5 text-secondary">
                        Save changes to <span className="font-medium text-main">{fileName}</span> before closing?
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    Cancel
                </Button>
                <Button className="red ghost" onClick={() => resolveAndClose("discard")}>
                    Don't Save
                </Button>
                <Button onClick={() => resolveAndClose("save")}>Save</Button>
            </div>
        </FlexiModal>
    );
}

UnsavedFileModal.displayName = "UnsavedFileModal";

export { UnsavedFileModal };
