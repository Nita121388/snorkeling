// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Input } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isBlank } from "@/util/util";
import { useCallback, useState } from "react";

export const NoteDirectorySettingKey = "note:dir";
export const DefaultNoteDirectory = "~";

export function normalizeNoteDirectory(value: string | null | undefined): string {
    const trimmed = value?.trim();
    return isBlank(trimmed) ? DefaultNoteDirectory : trimmed;
}

type NoteDirectoryModalProps = {
    initialDir?: string | null;
};

function NoteDirectoryModal({ initialDir }: NoteDirectoryModalProps) {
    const [noteDir, setNoteDir] = useState(normalizeNoteDirectory(initialDir));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const closeModal = useCallback(() => {
        if (saving) return;
        modalsModel.popModal();
    }, [saving]);

    const saveDirectory = useCallback(() => {
        const normalizedDir = normalizeNoteDirectory(noteDir);
        setSaving(true);
        setError("");
        void RpcApi.SetConfigCommand(TabRpcClient, {
            [NoteDirectorySettingKey]: normalizedDir,
        } as SettingsType)
            .then(() => modalsModel.popModal())
            .catch((nextError) => {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
            })
            .finally(() => setSaving(false));
    }, [noteDir]);

    return (
        <Modal
            className="w-[440px] max-w-[calc(100vw-32px)]"
            okLabel={saving ? "Saving..." : "Save"}
            cancelLabel="Cancel"
            okDisabled={saving}
            cancelDisabled={saving}
            onOk={saveDirectory}
            onCancel={closeModal}
            onClose={closeModal}
            onClickBackdrop={closeModal}
        >
            <div className="space-y-3 pr-7 text-primary">
                <div className="space-y-1">
                    <div className="text-base font-semibold">Note Directory</div>
                    <div className="text-xs text-secondary">Set the folder opened by the Note button.</div>
                </div>
                <Input
                    value={noteDir}
                    autoFocus
                    autoSelect
                    placeholder="~/notes"
                    onChange={(value) => {
                        setNoteDir(value);
                        setError("");
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            saveDirectory();
                        }
                    }}
                />
                {error ? (
                    <div className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error">{error}</div>
                ) : null}
            </div>
        </Modal>
    );
}

NoteDirectoryModal.displayName = "NoteDirectoryModal";

export { NoteDirectoryModal };
