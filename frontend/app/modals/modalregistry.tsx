// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MessageModal } from "@/app/modals/messagemodal";
import { NewInstallOnboardingModal } from "@/app/onboarding/onboarding";
import { UpgradeOnboardingModal } from "@/app/onboarding/onboarding-upgrade";
import { UpgradeOnboardingPatch } from "@/app/onboarding/onboarding-upgrade-patch";
import { DeleteFileModal, PublishAppModal, RenameFileModal } from "@/builder/builder-apppanel";
import { SetSecretDialog } from "@/builder/tabs/builder-secrettab";
import { AboutModal } from "./about";
import { AgentHookSettingsModal } from "./agenthooksettingsmodal";
import { AISessionDetailModal } from "./aisessiondetailmodal";
import { AISessionNoteModal } from "./aisessionnotemodal";
import { NoteDirectoryModal } from "./notedirectorymodal";
import { UnsavedFileModal } from "./unsavedfilemodal";
import { UserInputModal } from "./userinputmodal";

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [NewInstallOnboardingModal.displayName || "NewInstallOnboardingModal"]: NewInstallOnboardingModal,
    [UpgradeOnboardingModal.displayName || "UpgradeOnboardingModal"]: UpgradeOnboardingModal,
    [UpgradeOnboardingPatch.displayName || "UpgradeOnboardingPatch"]: UpgradeOnboardingPatch,
    [UserInputModal.displayName || "UserInputModal"]: UserInputModal,
    [AboutModal.displayName || "AboutModal"]: AboutModal,
    [AgentHookSettingsModal.displayName || "AgentHookSettingsModal"]: AgentHookSettingsModal,
    [MessageModal.displayName || "MessageModal"]: MessageModal,
    [AISessionDetailModal.displayName || "AISessionDetailModal"]: AISessionDetailModal,
    [AISessionNoteModal.displayName || "AISessionNoteModal"]: AISessionNoteModal,
    [NoteDirectoryModal.displayName || "NoteDirectoryModal"]: NoteDirectoryModal,
    [UnsavedFileModal.displayName || "UnsavedFileModal"]: UnsavedFileModal,
    [PublishAppModal.displayName || "PublishAppModal"]: PublishAppModal,
    [RenameFileModal.displayName || "RenameFileModal"]: RenameFileModal,
    [DeleteFileModal.displayName || "DeleteFileModal"]: DeleteFileModal,
    [SetSecretDialog.displayName || "SetSecretDialog"]: SetSecretDialog,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
