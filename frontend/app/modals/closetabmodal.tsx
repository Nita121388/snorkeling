// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ConfirmModal } from "@/app/modals/modal";
import { useCallback } from "react";

export type CloseTabModalChoice = "close" | "cancel";

type CloseTabModalProps = {
    blockCount: number;
    tabName: string;
    onResolve: (choice: CloseTabModalChoice) => void;
};

function CloseTabModal({ blockCount, tabName, onResolve }: CloseTabModalProps) {
    const handleResolve = useCallback((choice: CloseTabModalChoice) => onResolve(choice), [onResolve]);

    return (
        <ConfirmModal<CloseTabModalChoice>
            title="Close Tab"
            description={
                <>
                    Close tab <span className="font-medium text-primary">{tabName || "Untitled"}</span>?
                    {blockCount > 0 && (
                        <span> {blockCount} block{blockCount !== 1 ? "s" : ""} will be closed.</span>
                    )}
                </>
            }
            choices={[
                { value: "cancel", label: "Cancel", role: "secondary" },
                { value: "close", label: "Close" },
            ]}
            defaultChoice="close"
            onResolve={handleResolve}
        />
    );
}

CloseTabModal.displayName = "CloseTabModal";

export { CloseTabModal };
