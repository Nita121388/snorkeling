// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { cn } from "@/util/util";
import { useRef, type ReactNode } from "react";

type ConfirmModalAction = {
    label: string;
    value: string;
    /** "destructive" renders red, "secondary" renders a neutral ghost action, default renders primary. */
    tone?: "default" | "secondary" | "destructive";
    className?: string;
};

type ConfirmModalProps = {
    title: string;
    message: ReactNode;
    /** Legacy single-confirm action (backward compatible). Ignored when `actions` is provided. */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Renders the legacy confirm button in the destructive (red) style. */
    destructive?: boolean;
    /** Optional explicit actions. When provided, `onAction` receives the action value; Cancel resolves "" via onAction or false via onResolve. */
    actions?: ConfirmModalAction[];
    /** Called for explicit actions and cancel (""). Backward compatible callers can keep using `onResolve`. */
    onAction?: (value: string) => void;
    onResolve?: (confirmed: boolean) => void;
};

/**
 * Generic confirmation dialog. Use this instead of `window.confirm` so the
 * prompt follows the app theme and block-level shortcuts stay contained.
 *
 * The resolve callback fires exactly once: `resolvedRef` guards against
 * the double-settle that happens when a backdrop click races the button click.
 */
function ConfirmModal({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
    actions,
    onAction,
    onResolve,
}: ConfirmModalProps) {
    const resolvedRef = useRef(false);

    const settle = (value: string, confirmed: boolean) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        modalsModel.popModal();
        onAction?.(value);
        onResolve?.(confirmed);
    };

    const renderActionButton = (action: ConfirmModalAction) => (
        <Button
            key={action.value}
            className={cn(
                action.tone === "destructive" && "red",
                action.tone === "secondary" && "grey ghost",
                action.className
            )}
            onClick={() => settle(action.value, true)}
        >
            {action.label}
        </Button>
    );

    return (
        <Modal className="w-[420px] max-w-[calc(100vw-32px)]" onClickBackdrop={() => settle("", false)}>
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-primary">{title}</div>
                    <div className="text-[13px] leading-5 break-words whitespace-pre-wrap text-secondary">
                        {message}
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => settle("", false)}>
                    {cancelLabel}
                </Button>
                {actions && actions.length > 0 ? (
                    actions.map(renderActionButton)
                ) : (
                    <Button className={destructive ? "red" : undefined} onClick={() => settle("confirm", true)}>
                        {confirmLabel}
                    </Button>
                )}
            </div>
        </Modal>
    );
}

ConfirmModal.displayName = "ConfirmModal";

export { ConfirmModal };
export type { ConfirmModalAction, ConfirmModalProps };
