// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_2_Content = () => {
    const { t } = useTranslation("onboarding");
    const waveEnv = useWaveEnv();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("onboarding:upgradeV0142.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-bell"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0142.badgesTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0142.rollUpTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0142.rollUpDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0142.bellTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0142.bellBefore")}{" "}
                                <code>term:bellindicator</code>
                                {t("onboarding:upgradeV0142.bellAfter")}
                            </li>
                            <li>
                                <strong>
                                    <code>wsh badge</code>
                                </strong>{" "}
                                {t("onboarding:upgradeV0142.wshBadgeDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0142.claudeTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0142.claudeBefore")} <code>wsh badge</code>{" "}
                                {t("onboarding:upgradeV0142.claudeAfter")}{" "}
                                <button
                                    onClick={() =>
                                        waveEnv.electron.openExternal("https://docs.waveterm.dev/claude-code")
                                    }
                                    className="text-accent text-sm font-normal cursor-pointer hover:underline"
                                >
                                    {t("onboarding:upgradeV0142.seeDocs")}
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-folder-open"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0142.otherTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>[v0.14.3] </strong>
                                {t("onboarding:upgradeV0142.v0143Fix")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0142.directoryTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0142.directoryDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0142.searchTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0142.searchDesc")}
                            </li>
                            <li>{t("onboarding:upgradeV0142.gnomeFix")}</li>
                            <li>{t("onboarding:upgradeV0142.saveSessionFix")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_2_Content.displayName = "UpgradeOnboardingModal_v0_14_2_Content";

export { UpgradeOnboardingModal_v0_14_2_Content };
