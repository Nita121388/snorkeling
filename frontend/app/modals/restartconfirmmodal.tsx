// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";

type RestartConfirmModalProps = {
    blockId: string;
    isAgent: boolean;
    onResolve: (restart: boolean) => void;
};

/**
 * Confirmation dialog shown before restarting a terminal block's shell/agent
 * process. Restarting interrupts the running process, so the user must
 * explicitly confirm; cancelling leaves the controller untouched.
 */
function RestartConfirmModal({ isAgent, onResolve }: RestartConfirmModalProps) {
    const resolvedRef = useRef(false);
    const resolveAndClose = (restart: boolean) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        modalsModel.popModal();
        onResolve(restart);
    };

    const title = isAgent ? "Restart Agent Session" : "Restart Shell";
    const description = isAgent
        ? "Restarting the agent session will interrupt the currently running agent process. If auto-resume is enabled, the original conversation may be recovered after restart."
        : "Restarting the shell will terminate the currently running command and start a new one.";

    return (
        <FlexiModal className="w-[420px] max-w-[calc(100vw-32px)]" onClickBackdrop={() => resolveAndClose(false)}>
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main">{title}</div>
                    <div className="text-[13px] leading-5 text-secondary">{description}</div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose(false)}>
                    Cancel
                </Button>
                <Button onClick={() => resolveAndClose(true)}>Restart</Button>
            </div>
        </FlexiModal>
    );
}

RestartConfirmModal.displayName = "RestartConfirmModal";

export { RestartConfirmModal };