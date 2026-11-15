// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";
import { i18n } from "@/i18n/config";
import { useTranslation } from "react-i18next";

export type CloseTabModalChoice = "close" | "cancel";

type CloseTabModalProps = {
    blockCount: number;
    tabName: string;
    onResolve: (choice: CloseTabModalChoice) => void;
};

function CloseTabModal({ blockCount, tabName, onResolve }: CloseTabModalProps) {
    const { t } = useTranslation("modals");
    const resolvedRef = useRef(false);
    const resolveAndClose = (choice: CloseTabModalChoice) => {
        if (resolvedRef.current) return;
        resolvedRef.current = true;
        modalsModel.popModal();
        onResolve(choice);
    };

    return (
        <Modal
            className="w-[420px] max-w-[calc(100vw-32px)]"
            onClickBackdrop={() => resolveAndClose("cancel")}
        >
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main">{t("modals:closeTab.title")}</div>
                    <div className="text-[13px] leading-5 text-secondary">
                        {t("modals:closeTab.questionPrefix")}{" "}
                        <span className="font-medium text-main">{tabName || t("modals:closeTab.untitled")}</span>
                        {t("modals:closeTab.questionSuffix")}
                        {blockCount > 0 && (
                            <span> {i18n.t("modals:closeTab.blocksWarning", { count: blockCount })}</span>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    {t("modals:modal.cancel")}
                </Button>
                <Button onClick={() => resolveAndClose("close")}>{t("modals:modal.close")}</Button>
            </div>
        </Modal>
    );
}

CloseTabModal.displayName = "CloseTabModal";

export { CloseTabModal };
