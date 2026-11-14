// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_12_2_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding:upgradeV0122.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-file-pen"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0122.fileEditingTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0122.fileWriteTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0122.fileWriteDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0122.visualDiffTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0122.visualDiffDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0122.rollbackTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0122.rollbackDesc")}
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
                        {t("onboarding:upgradeV0122.aiImprovementsTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("onboarding:upgradeV0122.aiItem1")}</li>
                            <li>
                                {t("onboarding:upgradeV0122.aiItem2Before")}{" "}
                                <span className="font-mono">`wsh ai`</span>{" "}
                                {t("onboarding:upgradeV0122.aiItem2After")}
                            </li>
                            <li>{t("onboarding:upgradeV0122.aiItem3")}</li>
                            <li>{t("onboarding:upgradeV0122.aiItem4")}</li>
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
                        {t("onboarding:upgradeV0122.bugfixTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("onboarding:upgradeV0122.bugfixItem1")}</li>
                            <li>{t("onboarding:upgradeV0122.bugfixItem2")}</li>
                            <li>{t("onboarding:upgradeV0122.bugfixItem3")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_12_2_Content.displayName = "UpgradeOnboardingModal_v0_12_2_Content";

export { UpgradeOnboardingModal_v0_12_2_Content };
