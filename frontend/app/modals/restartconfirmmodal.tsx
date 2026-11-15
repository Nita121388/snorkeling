// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation("modals");
    const resolvedRef = useRef(false);
    const resolveAndClose = (restart: boolean) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        modalsModel.popModal();
        onResolve(restart);
    };

    const title = isAgent ? t("modals:restartConfirm.titleAgent") : t("modals:restartConfirm.titleShell");
    const description = isAgent
        ? t("modals:restartConfirm.descAgent")
        : t("modals:restartConfirm.descShell");

    return (
        <Modal className="w-[420px] max-w-[calc(100vw-32px)]" onClickBackdrop={() => resolveAndClose(false)}>
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main">{title}</div>
                    <div className="text-[13px] leading-5 text-secondary">{description}</div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose(false)}>
                    {t("modals:modal.cancel")}
                </Button>
                <Button onClick={() => resolveAndClose(true)}>{t("modals:restartConfirm.restart")}</Button>
            </div>
        </Modal>
    );
}

RestartConfirmModal.displayName = "RestartConfirmModal";

export { RestartConfirmModal };