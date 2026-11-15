// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_4_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding:upgradeV0144.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-table-columns"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0144.verticalTabsTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0144.newVerticalTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0144.newVerticalDesc")}
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
                        {t("onboarding:upgradeV0144.terminalTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0144.xtermTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0144.xtermDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0144.otherTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0144.macosTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0144.macosDesc")}
                            </li>
                            <li>
                                <strong>
                                    <code>backgrounds.json</code>
                                </strong>{" "}
                                {t("onboarding:upgradeV0144.backgroundsDesc")} <code>presets/bg.json</code>{" "}
                                {t("onboarding:upgradeV0144.backgroundsTo")} <code>backgrounds.json</code>
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0144.configErrorsTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0144.configErrorsDesc")}
                            </li>
                            <li>{t("onboarding:upgradeV0144.unsavedItem")}</li>
                            <li>{t("onboarding:upgradeV0144.streamingItem")}</li>
                            <li>{t("onboarding:upgradeV0144.legacyAiItem")}</li>
                            <li>{t("onboarding:upgradeV0144.focusFix")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_4_Content.displayName = "UpgradeOnboardingModal_v0_14_4_Content";

export { UpgradeOnboardingModal_v0_14_4_Content };
