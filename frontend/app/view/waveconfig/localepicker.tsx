// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useTranslation } from "react-i18next";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn, fireAndForget } from "@/util/util";
import { memo, useCallback } from "react";
import type { LocaleSetting } from "@/i18n/config";

/**
 * Locale picker for the Wave config settings surface (Global > Language).
 *
 * Writes Wave config `ui:locale` ("auto" | "en" | "zh"). `auto` follows the
 * system locale. Applying the change is not done here: `I18nProvider`
 * observes the config atom and calls `I18nModel.setActiveLocale`, which
 * switches the renderer i18next instance and pushes the locale to the
 * Electron main process (native menus).
 *
 * This is also the P0 dogfood site: all visible strings come from the
 * `common:settings.*` resources instead of literals.
 */
const CARDS = [
    {
        mode: "auto",
        icon: "fa-solid fa-circle-half-stroke",
        label: "common:settings.languageAuto",
        desc: "common:settings.languageAutoDesc",
    },
    {
        mode: "en",
        icon: "fa-solid fa-globe",
        label: "common:settings.languageEn",
        desc: "common:settings.languageEnDesc",
    },
    {
        mode: "zh",
        icon: "fa-solid fa-globe",
        label: "common:settings.languageZh",
        desc: "common:settings.languageZhDesc",
    },
] as const;

const LocalePickerContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    void _model;
    const { t } = useTranslation("common");
    const localeSetting = useSettingsKeyAtom("ui:locale") as LocaleSetting | null;
    const selected: LocaleSetting = localeSetting ?? "auto";

    const handleClick = useCallback((mode: LocaleSetting) => {
        fireAndForget(() =>
            RpcApi.SetConfigCommand(TabRpcClient, {
                "ui:locale": mode,
            })
        );
    }, []);

    return (
        <div className="space-y-3">
            <div className="text-sm font-medium">{t("common:settings.languageTitle")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CARDS.map((card) => {
                    const isActive = selected === card.mode;
                    return (
                        <div
                            key={card.mode}
                            onClick={() => handleClick(card.mode)}
                            data-testid={`locale-card-${card.mode}`}
                            className={cn(
                                "border rounded-lg p-3 cursor-pointer transition-colors",
                                isActive
                                    ? "border-accent bg-accent/10"
                                    : "border-border hover:border-border/80 bg-[var(--panel-bg-color)]"
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <i className={cn(card.icon, "text-muted-foreground text-xs")} />
                                <span className="text-sm font-medium">{t(card.label)}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{t(card.desc)}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

export { LocalePickerContent };
