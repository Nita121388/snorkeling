// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_13_1_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding:upgradeV0131.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-brands fa-windows"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0131.windowsTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0131.windowLayoutTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.windowLayoutDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0131.gitBashTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.gitBashDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0131.sshAgentTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.sshAgentDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0131.focusKeyTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.focusKeyDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0131.aiUpdatesTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0131.visualDesignTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.visualDesignDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0131.byokTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.byokDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0131.terminalTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0131.scrollKeysTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0131.scrollKeysDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_13_1_Content.displayName = "UpgradeOnboardingModal_v0_13_1_Content";

export { UpgradeOnboardingModal_v0_13_1_Content };
