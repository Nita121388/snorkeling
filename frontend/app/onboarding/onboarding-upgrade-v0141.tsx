// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_1_Content = () => {
    const { t } = useTranslation("onboarding");
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("onboarding:upgradeV0141.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0141.terminalFixesTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0141.claudeScrollTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.claudeScrollDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0141.imeTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.imeDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0141.scrollResizeTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.scrollResizeDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0141.scrollbackTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.scrollbackBefore")}{" "}
                                <code>wsh</code> {t("onboarding:upgradeV0141.scrollbackAfter")}
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
                        {t("onboarding:upgradeV0141.configTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0141.focusFollowsTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.focusFollowsBefore")}{" "}
                                <code>app:focusfollowscursor</code>{" "}
                                {t("onboarding:upgradeV0141.focusFollowsAfter")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0141.cursorStyleTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.cursorStyleDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0141.vimTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.vimDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0141.providersTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0141.providersDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_1_Content.displayName = "UpgradeOnboardingModal_v0_14_1_Content";

export { UpgradeOnboardingModal_v0_14_1_Content };
