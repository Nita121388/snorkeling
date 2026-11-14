// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WaveAIModel } from "./waveai-model";

interface TelemetryRequiredMessageProps {
    className?: string;
}

const TelemetryRequiredMessage = ({ className }: TelemetryRequiredMessageProps) => {
    const { t } = useTranslation("aipanel");
    const [isEnabling, setIsEnabling] = useState(false);

    const handleEnableTelemetry = async () => {
        setIsEnabling(true);
        try {
            await RpcApi.WaveAIEnableTelemetryCommand(TabRpcClient);
            setTimeout(() => {
                WaveAIModel.getInstance().focusInput();
            }, 100);
        } catch (error) {
            console.error("Failed to enable telemetry:", error);
            setIsEnabling(false);
        }
    };

    return (
        <div className={cn("flex flex-col h-full", className)}>
            <div className="flex-grow"></div>
            <div className="flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-6">
                    <div className="space-y-4">
                        <i className="fa fa-sparkles text-accent text-5xl"></i>
                        <h2 className="text-2xl font-semibold text-foreground">{t("aipanel:telemetry.title")}</h2>
                        <p className="text-secondary leading-relaxed">{t("aipanel:telemetry.intro")}</p>
                    </div>

                    <div className="bg-actionsoft border border-actionsoftborder rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa fa-info-circle text-actionsofttext text-lg mt-0.5"></i>
                            <div className="text-left">
                                <div className="text-actionsofttext font-medium mb-1">
                                    {t("aipanel:telemetry.keepsFree")}
                                </div>
                                <div className="text-secondary text-sm mb-3">
                                    <p className="mb-2">
                                        {t("aipanel:telemetry.body1Prefix")} <i>{t("aipanel:telemetry.anonymous")}</i>{" "}
                                        {t("aipanel:telemetry.body1Suffix")}
                                    </p>
                                    <p className="mb-2">{t("aipanel:telemetry.body2")}</p>
                                    <p className="mb-2">{t("aipanel:telemetry.body3")}</p>
                                    <p>
                                        {t("aipanel:telemetry.docsIntro")}{" "}
                                        <a
                                            href="https://docs.waveterm.dev/waveai-modes"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="!text-accent hover:!text-accenthover cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                        >
                                            https://docs.waveterm.dev/waveai-modes
                                        </a>
                                        .
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnableTelemetry}
                                    disabled={isEnabling}
                                    className="bg-action text-actiontext hover:bg-actionhover disabled:bg-action/50 px-4 py-2 rounded-lg font-medium cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                >
                                    {isEnabling ? t("aipanel:telemetry.enabling") : t("aipanel:telemetry.enableButton")}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-secondary">
                        <a
                            href="https://waveterm.dev/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="!text-accent hover:!text-accenthover cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        >
                            {t("aipanel:telemetry.privacyPolicy")}
                        </a>
                    </div>
                </div>
            </div>
            <div className="flex-grow-[2]"></div>
        </div>
    );
};

TelemetryRequiredMessage.displayName = "TelemetryRequiredMessage";

export { TelemetryRequiredMessage };
