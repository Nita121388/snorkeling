// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ConfirmModal } from "@/app/modals/modal";
import { useCallback } from "react";

export type UnsavedFileModalChoice = "save" | "discard" | "cancel";

type UnsavedFileModalProps = {
    fileName: string;
    onResolve: (choice: UnsavedFileModalChoice) => void;
};

function UnsavedFileModal({ fileName, onResolve }: UnsavedFileModalProps) {
    const handleResolve = useCallback((choice: UnsavedFileModalChoice) => onResolve(choice), [onResolve]);

    return (
        <ConfirmModal<UnsavedFileModalChoice>
            title="Unsaved Changes"
            description={
                <>Save changes to <span className="font-medium text-primary">{fileName}</span> before closing?</>
            }
            choices={[
                { value: "cancel", label: "Cancel", role: "secondary" },
                { value: "discard", label: "Don't Save", role: "danger" },
                { value: "save", label: "Save" },
            ]}
            defaultChoice="save"
            onResolve={handleResolve}
        />
    );
}

UnsavedFileModal.displayName = "UnsavedFileModal";

export { UnsavedFileModal };
