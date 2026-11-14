// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { recordTEvent } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { Trans, useTranslation } from "react-i18next";
import { WaveUIMessagePart } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

interface RestoreBackupModalProps {
    part: WaveUIMessagePart & { type: "data-tooluse" };
}

export const RestoreBackupModal = memo(({ part }: RestoreBackupModalProps) => {
    const { t } = useTranslation("aipanel");
    const model = WaveAIModel.getInstance();
    const toolData = part.data;
    const status = useAtomValue(model.restoreBackupStatus);
    const error = useAtomValue(model.restoreBackupError);

    const formatTimestamp = (ts: number) => {
        if (!ts) return "";
        const date = new Date(ts);
        return date.toLocaleString();
    };

    const handleConfirm = () => {
        recordTEvent("waveai:revertfile", { "waveai:action": "revertfile:confirm" });
        model.restoreBackup(toolData.toolcallid, toolData.writebackupfilename, toolData.inputfilename);
    };

    const handleCancel = () => {
        recordTEvent("waveai:revertfile", { "waveai:action": "revertfile:cancel" });
        model.closeRestoreBackupModal();
    };

    const handleClose = () => {
        model.closeRestoreBackupModal();
    };

    if (status === "success") {
        return (
            <Modal
                className="restore-backup-modal pb-5 pr-5"
                onClose={handleClose}
                onOk={handleClose}
                okLabel={t("aipanel:restoreModal.close")}
                padding={false}
            >
                <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                    <div className="font-semibold text-lg text-success">{t("aipanel:restoreModal.successTitle")}</div>
                    <div className="text-sm text-secondary leading-relaxed">
                        <Trans
                            ns={"aipanel" as const}
                            i18nKey={"aipanel:restoreModal.successBody" as never}
                            t={t}
                            values={{ file: toolData.inputfilename }}
                            components={{ file: <span className="font-mono text-primary break-all" /> }}
                        />
                    </div>
                </div>
            </Modal>
        );
    }

    if (status === "error") {
        return (
            <Modal
                className="restore-backup-modal pb-5 pr-5"
                onClose={handleClose}
                onOk={handleClose}
                okLabel={t("aipanel:restoreModal.close")}
                padding={false}
            >
                <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                    <div className="font-semibold text-lg text-error">{t("aipanel:restoreModal.errorTitle")}</div>
                    <div className="text-sm text-secondary leading-relaxed">
                        {t("aipanel:restoreModal.errorIntro")}
                    </div>
                    <div className="text-sm text-error font-mono bg-error/10 border border-error/30 p-3 rounded break-all">
                        {error}
                    </div>
                </div>
            </Modal>
        );
    }

    const isProcessing = status === "processing";

    return (
        <Modal
            className="restore-backup-modal pb-5 pr-5"
            onClose={handleCancel}
            onCancel={handleCancel}
            onOk={handleConfirm}
            okLabel={isProcessing ? t("aipanel:restoreModal.restoring") : t("aipanel:restoreModal.confirmRestore")}
            cancelLabel={t("aipanel:restoreModal.cancel")}
            okDisabled={isProcessing}
            cancelDisabled={isProcessing}
            padding={false}
        >
            <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                <div className="font-semibold text-lg">{t("aipanel:restoreModal.title")}</div>
                <div className="text-sm text-secondary leading-relaxed">
                    <Trans
                        ns={"aipanel" as const}
                        i18nKey={
                            (toolData.runts
                                ? "aipanel:restoreModal.confirmBodyWithTime"
                                : "aipanel:restoreModal.confirmBody") as never
                        }
                        t={t}
                        values={{
                            file: toolData.inputfilename,
                            time: toolData.runts ? formatTimestamp(toolData.runts) : "",
                        }}
                        components={{ file: <span className="font-mono text-primary break-all" /> }}
                    />
                </div>
                <div className="text-sm text-secondary leading-relaxed">{t("aipanel:restoreModal.lostWarning")}</div>
            </div>
        </Modal>
    );
});

RestoreBackupModal.displayName = "RestoreBackupModal";
