// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";

type ConfirmModalProps = {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Renders the confirm button in the destructive (red) style. */
    destructive?: boolean;
    onResolve: (confirmed: boolean) => void;
};

/**
 * Generic confirmation dialog. Use this instead of `window.confirm` so the
 * prompt follows the app theme and block-level shortcuts stay contained.
 *
 * The `onResolve` callback fires exactly once: `resolvedRef` guards against
 * the double-settle that happens when a backdrop click races the button click.
 */
function ConfirmModal({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
    onResolve,
}: ConfirmModalProps) {
    const resolvedRef = useRef(false);

    const resolveAndClose = (confirmed: boolean) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        modalsModel.popModal();
        onResolve(confirmed);
    };

    return (
        <FlexiModal className="w-[420px] max-w-[calc(100vw-32px)]" onClickBackdrop={() => resolveAndClose(false)}>
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-primary">{title}</div>
                    <div className="text-[13px] leading-5 break-words text-secondary">{message}</div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose(false)}>
                    {cancelLabel}
                </Button>
                <Button className={destructive ? "red" : undefined} onClick={() => resolveAndClose(true)}>
                    {confirmLabel}
                </Button>
            </div>
        </FlexiModal>
    );
}

ConfirmModal.displayName = "ConfirmModal";

export { ConfirmModal };
export type { ConfirmModalProps };