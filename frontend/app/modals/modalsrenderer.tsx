// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { NewInstallOnboardingModal } from "@/app/onboarding/onboarding";
import { CurrentOnboardingVersion } from "@/app/onboarding/onboarding-common";
import { UpgradeOnboardingModal } from "@/app/onboarding/onboarding-upgrade";
import { ClientModel } from "@/app/store/client-model";
import { globalPrimaryTabStartup } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as jotai from "jotai";
import { useEffect } from "react";
import * as semver from "semver";
import { setModalOpenSource } from "./modal-open-registry";
import { getModalComponent } from "./modalregistry";

const ModalsRenderer = () => {
    const clientData = jotai.useAtomValue(ClientModel.getInstance().clientAtom);
    const [newInstallOnboardingOpen, setNewInstallOnboardingOpen] = jotai.useAtom(modalsModel.newInstallOnboardingOpen);
    const [upgradeOnboardingOpen, setUpgradeOnboardingOpen] = jotai.useAtom(modalsModel.upgradeOnboardingOpen);
    const [modals] = jotai.useAtom(modalsModel.modalsAtom);
    const rtn: React.ReactElement[] = [];
    for (const modal of modals) {
        const ModalComponent = getModalComponent(modal.displayName);
        if (ModalComponent) {
            rtn.push(<ModalComponent key={modal.displayName} {...modal.props} />);
        }
    }
    if (newInstallOnboardingOpen) {
        rtn.push(<NewInstallOnboardingModal key={NewInstallOnboardingModal.displayName} />);
    }
    if (upgradeOnboardingOpen) {
        rtn.push(<UpgradeOnboardingModal key={UpgradeOnboardingModal.displayName} />);
    }
    useEffect(() => {
        if (!clientData.tosagreed) {
            setNewInstallOnboardingOpen(true);
        }
    }, [clientData]);

    useEffect(() => {
        if (!globalPrimaryTabStartup) {
            return;
        }
        if (!clientData.tosagreed) {
            return;
        }
        const lastVersion = clientData.meta?.["onboarding:lastversion"] ?? "v0.0.0";
        if (semver.lt(lastVersion, CurrentOnboardingVersion)) {
            setUpgradeOnboardingOpen(true);
        }
    }, []);
    useEffect(() => {
        // 栈层与直接渲染的 <Modal> 共用 modalOpen 仲裁：这里只登记本来源，
        // 不再直写 atom，避免"栈清空"把直接渲染的弹窗抹掉。
        setModalOpenSource("modals-stack", rtn.length > 0);
    }, [rtn]);

    return <>{rtn}</>;
};

export { ModalsRenderer };
