// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

export type UnsavedFileModalChoice = "save" | "discard" | "cancel";

type UnsavedFileModalProps = {
    fileName: string;
    onResolve: (choice: UnsavedFileModalChoice) => void;
};

function UnsavedFileModal({ fileName, onResolve }: UnsavedFileModalProps) {
    const { t } = useTranslation("modals");
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
        <Modal
            className="w-[420px] max-w-[calc(100vw-32px)]"
            onClickBackdrop={() => resolveAndClose("cancel")}
        >
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main">{t("modals:unsavedFile.title")}</div>
                    <div className="text-[13px] leading-5 text-secondary">
                        {t("modals:unsavedFile.bodyPrefix")}{" "}
                        <span className="font-medium text-main">{fileName}</span>{" "}
                        {t("modals:unsavedFile.bodySuffix")}
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    {t("modals:modal.cancel")}
                </Button>
                <Button className="red ghost" onClick={() => resolveAndClose("discard")}>
                    {t("modals:unsavedFile.dontSave")}
                </Button>
                <Button onClick={() => resolveAndClose("save")}>{t("common:common.save")}</Button>
            </div>
        </Modal>
    );
}

UnsavedFileModal.displayName = "UnsavedFileModal";

export { UnsavedFileModal };
