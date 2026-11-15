// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_13_0_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding:upgradeV0130.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0130.localAiTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0130.openaiCompatTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.openaiCompatDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.geminiTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.geminiDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.presetsTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.presetsDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.modesTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.modesDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sliders"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0130.configWidgetTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0130.newConfigTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.newConfigDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.organizationTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.organizationDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.secretsTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.secretsDesc")}
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
                        {t("onboarding:upgradeV0130.terminalTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0130.bracketedPasteTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.bracketedPasteDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.windowsPasteTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.windowsPasteDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0130.sshPasswordTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0130.sshPasswordDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_13_0_Content.displayName = "UpgradeOnboardingModal_v0_13_0_Content";

export { UpgradeOnboardingModal_v0_13_0_Content };
