// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_12_3_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding:upgradeV0123.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0123.aiUpdatesTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0123.gptTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0123.gptDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0123.thinkingTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0123.thinkingDesc")}
                            </li>
                            <li>{t("onboarding:upgradeV0123.aiFix")}</li>
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
                        {t("onboarding:upgradeV0123.terminalTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0123.inputTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0123.inputDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0123.imagePasteTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0123.imagePasteDesc")}
                            </li>
                            <li>{t("onboarding:upgradeV0123.multilineItem")}</li>
                            <li>{t("onboarding:upgradeV0123.imeItem")}</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-key"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0123.secretTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0123.secretWidgetTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0123.secretWidgetDesc")}
                            </li>
                            <li>
                                {t("onboarding:upgradeV0123.secretCliBefore")}{" "}
                                <span className="font-mono">wsh secret list/get/set</span>{" "}
                                {t("onboarding:upgradeV0123.secretCliAfter")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_12_3_Content.displayName = "UpgradeOnboardingModal_v0_12_3_Content";

export { UpgradeOnboardingModal_v0_12_3_Content };
