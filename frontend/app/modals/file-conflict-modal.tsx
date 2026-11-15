// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
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
    const { t } = useTranslation("modals");
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
        <Modal
            className="w-[470px] max-w-[calc(100vw-32px)]"
            onClickBackdrop={() => resolveAndClose("cancel")}
        >
            <div className="modal-content">
                <div className="flex flex-col gap-2">
                    <div className="text-[15px] font-semibold text-main flex items-center gap-2">
                        <i className="fa-solid fa-triangle-exclamation text-[14px]" style={{ color: "var(--warning-color, #f59e0b)" }} />
                        {t("modals:fileConflict.title")}
                    </div>
                    <div className="text-[13px] leading-5 text-secondary">
                        <code className="px-1.5 py-0.5 rounded bg-surface text-secondary text-[11px] font-mono">
                            {filePath}
                        </code>{" "}
                        {t("modals:fileConflict.bodySuffix")}
                    </div>
                    <div className="border border-border rounded-md px-3 py-2.5 bg-surface flex flex-col gap-1.5 mt-0.5">
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded bg-surface-strong text-secondary">{t("modals:fileConflict.base")}</span>
                            <span className="text-secondary">{t("modals:fileConflict.baseDesc")}</span>
                        </div>
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded" style={{ background: "rgb(230 185 86 / 0.18)", color: "#e0b956" }}>{t("modals:fileConflict.external")}</span>
                            <span className="text-secondary">{t("modals:fileConflict.externalDesc")}</span>
                        </div>
                        <div className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[52px] text-center text-[10.5px] font-bold rounded" style={{ background: "rgb(88 193 66 / 0.18)", color: "#58c141" }}>{t("modals:fileConflict.yours")}</span>
                            <span className="text-secondary">{t("modals:fileConflict.yoursDesc")}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-1.5 pt-4 w-full">
                <Button className="red ghost" onClick={() => resolveAndClose("discard")}>
                    <i className="fa-solid fa-trash" /> {t("modals:fileConflict.discard")}
                </Button>
                <Button className="grey ghost" onClick={() => resolveAndClose("cancel")}>
                    {t("modals:modal.cancel")}
                </Button>
                <Button className="green outlined" onClick={() => resolveAndClose("copy-diff")}>
                    <i className="fa-solid fa-clipboard" /> {t("modals:fileConflict.copyDiff")}
                </Button>
                <Button className="green" onClick={() => resolveAndClose("overwrite")}>
                    <i className="fa-solid fa-floppy-disk" /> {t("modals:fileConflict.saveOverwrite")}
                </Button>
            </div>
        </Modal>
    );
}

FileConflictModal.displayName = "FileConflictModal";

export { FileConflictModal };
