// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_5_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding:upgradeV0145.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-list-tree"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0145.processViewerTitle")}
                    </div>
                    <div className="text-secondary leading-5">{t("onboarding:upgradeV0145.processViewerDesc")}</div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0145.otherTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0145.quakeTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0145.quakeBefore")}{" "}
                                <code>app:globalhotkey</code> {t("onboarding:upgradeV0145.quakeAfter")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0145.dragDropTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0145.dragDropDesc")}
                            </li>
                            <li>
                                {t("onboarding:upgradeV0145.splitButtonsBefore")}{" "}
                                <code>app:showsplitbuttons</code> {t("onboarding:upgradeV0145.splitButtonsAfter")}
                            </li>
                            <li>{t("onboarding:upgradeV0145.sidebarItem")}</li>
                            <li>{t("onboarding:upgradeV0145.renameTabItem")}</li>
                            <li>{t("onboarding:upgradeV0145.mouseNavItem")}</li>
                            <li>
                                <strong>{t("onboarding:upgradeV0145.bugfixLabel")}</strong>{" "}
                                {t("onboarding:upgradeV0145.bugfixDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_5_Content.displayName = "UpgradeOnboardingModal_v0_14_5_Content";

export { UpgradeOnboardingModal_v0_14_5_Content };
