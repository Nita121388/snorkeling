// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { WaveAIModel } from "./waveai-model";

export const AIPanelHeader = memo(() => {
    const { t } = useTranslation("aipanel");
    const model = WaveAIModel.getInstance();
    const widgetAccess = useAtomValue(model.widgetAccessAtom);
    const inBuilder = model.inBuilder;

    const handleKebabClick = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    return (
        <div
            className="py-2 pl-3 pr-1 @xs:p-2 @xs:pl-4 border-b border-border flex items-center justify-between min-w-0"
            onContextMenu={handleContextMenu}
        >
            <h2 className="text-primary text-sm @xs:text-lg font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                {t("aipanel:header.waveAI")}
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                {!inBuilder && (
                    <div className="flex items-center text-sm whitespace-nowrap">
                        <span className="text-secondary @xs:hidden mr-1 text-[12px]">{t("aipanel:header.context")}</span>
                        <span className="text-secondary hidden @xs:inline mr-2 text-[12px]">
                            {t("aipanel:header.widgetContext")}
                        </span>
                        <button
                            onClick={() => {
                                model.setWidgetAccess(!widgetAccess);
                                setTimeout(() => {
                                    model.focusInput();
                                }, 0);
                            }}
                            className={`relative inline-flex h-6 w-14 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                                widgetAccess ? "border-action bg-action" : "border-border bg-surface-strong"
                            }`}
                            title={i18n.t("aipanel:header.widgetAccessTitle", {
                                state: widgetAccess ? t("aipanel:header.on") : t("aipanel:header.off"),
                            })}
                            aria-pressed={widgetAccess}
                        >
                            <span
                                className={`absolute inline-block h-4 w-4 transform rounded-full transition-all ${
                                    widgetAccess ? "bg-actiontext" : "bg-primary"
                                } ${
                                    widgetAccess ? "translate-x-8" : "translate-x-1"
                                }`}
                            />
                            <span
                                className={`relative z-10 text-xs transition-all ${
                                    widgetAccess
                                        ? "ml-2.5 mr-6 text-left text-actiontext"
                                        : "ml-6 mr-1 text-right text-secondary"
                                }`}
                            >
                                {widgetAccess ? t("aipanel:header.on") : t("aipanel:header.off")}
                            </span>
                        </button>
                    </div>
                )}

                <button
                    onClick={handleKebabClick}
                    className="text-secondary hover:bg-hover hover:text-primary cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    title={t("aipanel:header.moreOptions")}
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
