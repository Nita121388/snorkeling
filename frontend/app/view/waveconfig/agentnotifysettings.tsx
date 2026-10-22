// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave Config visual panel for the agent OS toasts.
//
// The panel is a thin UX layer over the agentstatus:osnotify* settings keys. The electron main
// process (emain/os-notify.ts) is the single place that decides whether a toast is shown; this
// panel only writes the keys. Writes go through SetConfigCommand, which merges the given keys
// into settings.json and leaves every other key untouched.
//
// The defaults come from frontend/util/sharedconst.ts — the same constants the main process uses —
// so the displayed values can never drift from the effective behavior.

import { atoms } from "@/app/store/global-atoms";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Toggle } from "@/app/element/toggle";
import { AGENT_OS_NOTIFY_DEFAULTS, AGENT_OS_NOTIFY_SETTING_KEYS } from "@/util/sharedconst";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useState } from "react";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";

type NotifyBoolKey = "masterEnabled" | "doneEnabled" | "blockedEnabled" | "notifyWhenFocused";
type NotifyNumberKey = "idleMinMs" | "cooldownMs";

export type AgentOsNotifyEffectiveSettings = {
    masterEnabled: boolean;
    doneEnabled: boolean;
    blockedEnabled: boolean;
    notifyWhenFocused: boolean;
    blockedMinIntervalMs: number;
    idleMinMs: number;
    cooldownMs: number;
};

/**
 * Resolve the effective values from the stored settings.
 *
 * The Go fields are *bool / *int64, so "unset" and "false"/"0" are different things: an unset key
 * falls back to the default, an explicitly stored false/0 does not. Getting this wrong would make
 * the panel show (and write back) a different value than the main process actually uses.
 */
export function resolveAgentOsNotifySettings(settings: SettingsType): AgentOsNotifyEffectiveSettings {
    return {
        masterEnabled: settings[AGENT_OS_NOTIFY_SETTING_KEYS.masterEnabled] ?? AGENT_OS_NOTIFY_DEFAULTS.masterEnabled,
        doneEnabled: settings[AGENT_OS_NOTIFY_SETTING_KEYS.doneEnabled] ?? AGENT_OS_NOTIFY_DEFAULTS.doneEnabled,
        blockedEnabled: settings[AGENT_OS_NOTIFY_SETTING_KEYS.blockedEnabled] ?? AGENT_OS_NOTIFY_DEFAULTS.blockedEnabled,
        notifyWhenFocused:
            settings[AGENT_OS_NOTIFY_SETTING_KEYS.notifyWhenFocused] ?? AGENT_OS_NOTIFY_DEFAULTS.notifyWhenFocused,
        blockedMinIntervalMs:
            settings[AGENT_OS_NOTIFY_SETTING_KEYS.blockedMinIntervalMs] ??
            AGENT_OS_NOTIFY_DEFAULTS.blockedMinIntervalMs,
        idleMinMs: settings[AGENT_OS_NOTIFY_SETTING_KEYS.idleMinMs] ?? AGENT_OS_NOTIFY_DEFAULTS.idleMinMs,
        cooldownMs: settings[AGENT_OS_NOTIFY_SETTING_KEYS.cooldownMs] ?? AGENT_OS_NOTIFY_DEFAULTS.cooldownMs,
    };
}

function setNotifySetting(key: string, value: boolean | number): void {
    fireAndForget(async () => {
        await RpcApi.SetConfigCommand(TabRpcClient, { [key]: value } as SettingsType);
    });
}

function SectionRow({
    title,
    description,
    children,
    disabled,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    return (
        <div className={cn("flex items-start gap-4 py-3", disabled && "opacity-50")}>
            <div className="flex-1 min-w-0">
                <div className="text-sm text-primary">{title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
            </div>
            <div className="shrink-0 flex items-center gap-2 pt-0.5">{children}</div>
        </div>
    );
}

function NumberField({
    valueSeconds,
    onCommit,
    disabled,
    ariaLabel,
}: {
    valueSeconds: number;
    onCommit: (seconds: number) => void;
    disabled?: boolean;
    ariaLabel: string;
}) {
    // Keep the raw text while the user is typing so an empty field is not rewritten mid-edit.
    // The displayed value falls back to the persisted one as soon as the user is not editing.
    const [draft, setDraft] = useState<string | null>(null);
    const display = draft ?? String(valueSeconds);

    const commit = useCallback(() => {
        setDraft(null);
        const parsed = Number.parseInt(display, 10);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        if (parsed === valueSeconds) return;
        onCommit(parsed);
    }, [display, onCommit, valueSeconds]);

    return (
        <div className="flex items-center gap-2">
            <input
                type="number"
                min={0}
                step={1}
                value={display}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    }
                }}
                className="h-8 w-20 rounded border border-border bg-panel px-2 text-xs text-primary outline-none focus:border-accent disabled:opacity-50"
            />
            <span className="text-xs text-muted-foreground">sec</span>
        </div>
    );
}

const AgentNotifySettingsContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    void _model;

    const settings = useAtomValue(atoms.settingsAtom);
    const effective = resolveAgentOsNotifySettings(settings ?? {});
    const masterEnabled = effective.masterEnabled;
    const doneEnabled = effective.doneEnabled;
    const blockedEnabled = effective.blockedEnabled;
    const notifyWhenFocused = effective.notifyWhenFocused;
    const idleMinMs = effective.idleMinMs;
    const cooldownMs = effective.cooldownMs;

    const setBool = useCallback((key: NotifyBoolKey, value: boolean) => {
        setNotifySetting(AGENT_OS_NOTIFY_SETTING_KEYS[key], value);
    }, []);

    const setNumber = useCallback((key: NotifyNumberKey, seconds: number) => {
        setNotifySetting(AGENT_OS_NOTIFY_SETTING_KEYS[key], Math.round(seconds * 1000));
    }, []);

    return (
        <div className="p-6 h-full overflow-auto">
            <div className="max-w-2xl">
                <div className="text-sm text-muted-foreground mb-2">
                    Snorkeling raises a native toast when an agent finishes or asks for input. These
                    switches control how often that happens.
                </div>

                <div className="divide-y divide-border">
                    <SectionRow
                        title="Agent notifications"
                        description="Master switch for every agent toast."
                    >
                        <Toggle
                            checked={masterEnabled}
                            onChange={(v) => setBool("masterEnabled", v)}
                            aria-label="Agent notifications"
                        />
                    </SectionRow>

                    <SectionRow
                        title="Notify when an agent finishes"
                        description="A working agent became idle — the turn completed."
                        disabled={!masterEnabled}
                    >
                        <Toggle
                            checked={doneEnabled}
                            disabled={!masterEnabled}
                            onChange={(v) => setBool("doneEnabled", v)}
                            aria-label="Notify when an agent finishes"
                        />
                    </SectionRow>

                    <SectionRow
                        title="Notify when an agent needs input"
                        description="The agent is blocked, for example on an approval prompt."
                        disabled={!masterEnabled}
                    >
                        <Toggle
                            checked={blockedEnabled}
                            disabled={!masterEnabled}
                            onChange={(v) => setBool("blockedEnabled", v)}
                            aria-label="Notify when an agent needs input"
                        />
                    </SectionRow>

                    <SectionRow
                        title="Notify even while Snorkeling is focused"
                        description="By default a toast is skipped when a Snorkeling window has focus."
                        disabled={!masterEnabled}
                    >
                        <Toggle
                            checked={notifyWhenFocused}
                            disabled={!masterEnabled}
                            onChange={(v) => setBool("notifyWhenFocused", v)}
                            aria-label="Notify even while Snorkeling is focused"
                        />
                    </SectionRow>

                    <SectionRow
                        title="Idle threshold"
                        description="Wait until the keyboard and mouse have been idle this long before notifying. 0 notifies right away."
                        disabled={!masterEnabled}
                    >
                        <NumberField
                            ariaLabel="Idle threshold in seconds"
                            valueSeconds={Math.round(idleMinMs / 1000)}
                            onCommit={(s) => setNumber("idleMinMs", s)}
                            disabled={!masterEnabled}
                        />
                    </SectionRow>

                    <SectionRow
                        title="Cooldown"
                        description="Repeat toasts of the same kind inside this window are merged into one summary. 0 disables the cooldown."
                        disabled={!masterEnabled}
                    >
                        <NumberField
                            ariaLabel="Cooldown in seconds"
                            valueSeconds={Math.round(cooldownMs / 1000)}
                            onCommit={(s) => setNumber("cooldownMs", s)}
                            disabled={!masterEnabled}
                        />
                    </SectionRow>
                </div>
            </div>
        </div>
    );
});

AgentNotifySettingsContent.displayName = "AgentNotifySettingsContent";

export { AgentNotifySettingsContent };
