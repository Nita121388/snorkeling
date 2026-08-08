// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WindowService } from "@/app/store/services";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { Notification, net, safeStorage, shell } from "electron";
import { getResolvedUpdateChannel } from "emain/updater";
import { unamePlatform } from "./emain-platform";
import { getWebContentsByBlockId, webGetSelector } from "./emain-web";
import { createBrowserWindow, getWaveWindowById, getWaveWindowByWorkspaceId } from "./emain-window";
import {
    AgentOsNotificationDescriptor,
    AgentOsNotifyKind,
    AgentOsNotifySettings,
    decideSuppression,
    defaultIsAnyWindowFocused,
    defaultShowNotification,
    makeDefaultFocusApp,
    sendAgentOsNotification,
} from "./os-notify";

export class ElectronWshClientType extends WshClient {
    constructor() {
        super("electron");
    }

    async handle_webselector(rh: RpcResponseHelper, data: CommandWebSelectorData): Promise<string[]> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("tabid and blockid are required");
        }
        const ww = getWaveWindowByWorkspaceId(data.workspaceid);
        if (ww == null) {
            throw new Error(`no window found with workspace ${data.workspaceid}`);
        }
        const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        const rtn = await webGetSelector(wc, data.selector, data.opts);
        return rtn;
    }

    async handle_notify(rh: RpcResponseHelper, notificationOptions: WaveNotificationOptions) {
        if (notificationOptions.agentkind) {
            await handleAgentOsNotification(notificationOptions);
            return;
        }
        new Notification({
            title: notificationOptions.title,
            body: notificationOptions.body,
            silent: notificationOptions.silent,
        }).show();
    }

    async handle_getupdatechannel(rh: RpcResponseHelper): Promise<string> {
        return getResolvedUpdateChannel();
    }

    async handle_focuswindow(rh: RpcResponseHelper, windowId: string) {
        console.log(`focuswindow ${windowId}`);
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        let ww = getWaveWindowById(windowId);
        if (ww == null) {
            const window = await WindowService.GetWindow(windowId);
            if (window == null) {
                throw new Error(`window ${windowId} not found`);
            }
            ww = await createBrowserWindow(window, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
        }
        ww.focus();
    }

    async handle_electronencrypt(
        rh: RpcResponseHelper,
        data: CommandElectronEncryptData
    ): Promise<CommandElectronEncryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = safeStorage.encryptString(data.plaintext);
        const ciphertext = encrypted.toString("base64");

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            ciphertext,
            storagebackend,
        };
    }

    async handle_electrondecrypt(
        rh: RpcResponseHelper,
        data: CommandElectronDecryptData
    ): Promise<CommandElectronDecryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = Buffer.from(data.ciphertext, "base64");
        const plaintext = safeStorage.decryptString(encrypted);

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            plaintext,
            storagebackend,
        };
    }

    async handle_networkonline(rh: RpcResponseHelper): Promise<boolean> {
        return net.isOnline();
    }

    async handle_electronsystembell(rh: RpcResponseHelper): Promise<void> {
        shell.beep();
    }

    // async handle_workspaceupdate(rh: RpcResponseHelper) {
    //     console.log("workspaceupdate");
    //     fireAndForget(async () => {
    //         console.log("workspace menu clicked");
    //         const updatedWorkspaceMenu = await getWorkspaceMenu();
    //         const workspaceMenu = Menu.getApplicationMenu().getMenuItemById("workspace-menu");
    //         workspaceMenu.submenu = Menu.buildFromTemplate(updatedWorkspaceMenu);
    //     });
    // }
}

export let ElectronWshClient: ElectronWshClientType;

export function initElectronWshClient() {
    ElectronWshClient = new ElectronWshClientType();
}

// ---------------- Agent OS notification ----------------
// Per-block last-fired timestamps (epoch ms) for rate limiting. One entry per (blockId, kind)
// so a noisy block doesn't starve an unrelated one. Lives in the main process so the
// suppression decision is consistent across renderer crashes / reloads.
const lastFiredByBlock = new Map<string, number>();
const lastFiredKey = (blockId: string, kind: string) => `${blockId}#${kind}`;

async function handleAgentOsNotification(opts: WaveNotificationOptions): Promise<void> {
    if (opts.agentkind !== "done" && opts.agentkind !== "blocked") {
        console.warn(`[os-notify] unsupported agentkind "${opts.agentkind}", dropping`);
        return;
    }
    if (!opts.agentblockid) {
        console.warn("[os-notify] agentblockid is required, dropping");
        return;
    }

    const kind: AgentOsNotifyKind = opts.agentkind;
    const desc: AgentOsNotificationDescriptor = {
        kind,
        blockId: opts.agentblockid,
        provider: opts.agentprovider || "",
        body: opts.body,
    };

    // Settings are read once per call so subsequent setting changes take effect immediately.
    // The agentstatus:* flags are *bool — *bool with default true means "off" is observable
    // distinct from unset; we treat unset as the default (true) too.
    const settings = (await RpcApi.GetFullConfigCommand(ElectronWshClient)).settings;
    const osNotifySettings: AgentOsNotifySettings = {
        // SettingsType keys carry the literal config names with colons (e.g.
        // "agentstatus:osnotify"); dotted access would silently read undefined.
        masterEnabled: boolValue(settings["agentstatus:osnotify"], true),
        doneEnabled: boolValue(settings["agentstatus:osnotifydone"], true),
        blockedEnabled: boolValue(settings["agentstatus:osnotifyblocked"], true),
        notifyWhenFocused: boolValue(settings["agentstatus:osnotifywhenfocused"], false),
        blockedMinIntervalMs: intValue(settings["agentstatus:osnotifyblockedminms"], 0),
    };

    const ctx = {
        settings: osNotifySettings,
        isAnyWindowFocused: defaultIsAnyWindowFocused,
        now: () => Date.now(),
        lastFiredAt: (blockId: string, k: AgentOsNotifyKind) => lastFiredByBlock.get(lastFiredKey(blockId, k)) ?? 0,
        showNotification: defaultShowNotification,
        focusApp: makeDefaultFocusApp(),
    };

    const outcome = sendAgentOsNotification(desc, ctx);
    if (outcome.fired) {
        lastFiredByBlock.set(lastFiredKey(desc.blockId, kind), ctx.now());
    }
}

function boolValue(v: boolean | undefined, def: boolean): boolean {
    return v == null ? def : v;
}

function intValue(v: number | undefined, def: number): number {
    return v == null ? def : v;
}
