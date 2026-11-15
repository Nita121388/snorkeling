// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_0_Content = () => {
    const { t } = useTranslation("onboarding");
    const waveEnv = useWaveEnv();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("onboarding:upgradeV0140.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-sky-500 fa-sharp fa-solid fa-shield"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0140.durableTitle")}{" "}
                        <button
                            onClick={() => waveEnv.electron.openExternal("https://docs.waveterm.dev/durable-sessions")}
                            className="text-accent text-sm font-normal cursor-pointer hover:underline"
                        >
                            {t("onboarding:upgradeV0140.seeDocs")}
                        </button>
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0140.protectionTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.protectionDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0140.indicatorsTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.indicatorsDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0140.configurationTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.configurationDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-network-wired"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0140.monitoringTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0140.keepaliveTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.keepaliveDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0140.stalledTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.stalledDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding:upgradeV0140.aiTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0140.imageTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.imageDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0140.stopTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.stopDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0140.autoscrollTitle")}</strong>
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
                        {t("onboarding:upgradeV0140.terminalTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("onboarding:upgradeV0140.contextMenuTitle")}</strong>{" "}
                                {t("onboarding:upgradeV0140.contextMenuDesc")}
                            </li>
                            <li>
                                <strong>{t("onboarding:upgradeV0140.osc52Title")}</strong>{" "}
                                {t("onboarding:upgradeV0140.osc52Desc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_0_Content.displayName = "UpgradeOnboardingModal_v0_14_0_Content";

export { UpgradeOnboardingModal_v0_14_0_Content };
