// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    getApi,
    getBlockMetaKeyAtom,
    getBlockTermDurableAtom,
    getOverrideConfigAtom,
    globalStore,
    recordTEvent,
    WOS,
} from "@/store/global";
import { base64ToString, fireAndForget, isSshConnName, isWslConnName } from "@/util/util";
import { genFrontendTraceId, pslogTrace } from "@/store/pslog-trace";
import debug from "debug";
import { resolveAgentCommandBinding } from "./agent-session";
import type { TermWrap } from "./termwrap";

const dlog = debug("wave:termwrap");
const agentStatusLog = debug("wave:agentstatus");

const Osc52MaxDecodedSize = 75 * 1024; // max clipboard size for OSC 52 (matches common terminal implementations)
const Osc52MaxRawLength = 128 * 1024; // includes selector + base64 + whitespace (rough check)

// OSC 16162 - Shell Integration Commands
// See aiprompts/wave-osc-16162.md for full documentation
export type ShellIntegrationStatus = "ready" | "running-command";

const ClaudeCodeRegex = /^claude\b/;

type Osc16162Command =
    | { command: "A"; data: Record<string, never> }
    | { command: "C"; data: { cmd64?: string } }
    | {
          command: "M";
          data: {
              shell?: string;
              shellversion?: string;
              uname?: string;
              integration?: boolean;
              omz?: boolean;
              comp?: string;
          };
      }
    | { command: "D"; data: { exitcode?: number } }
    | { command: "I"; data: { inputempty?: boolean } }
    | { command: "R"; data: Record<string, never> };

function normalizeCmd(decodedCmd: string): string {
    let normalizedCmd = decodedCmd.trim();
    normalizedCmd = normalizedCmd.replace(/^env\s+/, "");
    normalizedCmd = normalizedCmd.replace(/^(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "");
    return normalizedCmd;
}

function commandPreview(command: string | null | undefined): string | null {
    const normalized = command?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized) return null;
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 77)}...`;
}

function checkCommandForTelemetry(decodedCmd: string) {
    if (!decodedCmd) {
        return;
    }

    const normalizedCmd = normalizeCmd(decodedCmd);

    if (normalizedCmd.startsWith("ssh ")) {
        recordTEvent("conn:connect", { "conn:conntype": "ssh-manual" });
        return;
    }

    const editorsRegex = /^(vim|vi|nano|nvim)\b/;
    if (editorsRegex.test(normalizedCmd)) {
        recordTEvent("action:term", { "action:type": "cli-edit" });
        return;
    }

    const tailFollowRegex = /(^|\|\s*)tail\s+-[fF]\b/;
    if (tailFollowRegex.test(normalizedCmd)) {
        recordTEvent("action:term", { "action:type": "cli-tailf" });
        return;
    }

    if (ClaudeCodeRegex.test(normalizedCmd)) {
        recordTEvent("action:term", { "action:type": "claude" });
        return;
    }

    const opencodeRegex = /^opencode\b/;
    if (opencodeRegex.test(normalizedCmd)) {
        recordTEvent("action:term", { "action:type": "opencode" });
        return;
    }
}

export function isClaudeCodeCommand(decodedCmd: string): boolean {
    if (!decodedCmd) {
        return false;
    }
    return ClaudeCodeRegex.test(normalizeCmd(decodedCmd));
}

function bindManualAgentCommand(blockId: string, decodedCmd: string): void {
    const binding = resolveAgentCommandBinding(decodedCmd);
    if (binding == null) {
        return;
    }
    const tid = genFrontendTraceId();
    const meta: MetaType = {
        "agent:provider": binding.provider,
        "agent:autoresume": true,
        "cmd:jwt": true,
    } as MetaType;
    const metaRecord = meta as Record<string, unknown>;
    if (binding.sessionId !== "") {
        metaRecord["agent:sessionid"] = binding.sessionId;
    } else {
        metaRecord["agent:sessionid"] = null;
    }
    pslogTrace(
        "as-osc",
        `[as-osc] bind block=${blockId} provider=${binding.provider} sid=${binding.sessionId ?? "(null)"}`,
        { bufferKey: "ps-as-osc-buf", tid }
    );
    fireAndForget(async () => {
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", blockId),
            meta,
        }).catch((e) => {
            console.log("error binding manual agent command", e);
            pslogTrace(
                "as-osc",
                `[as-osc] bind FAIL block=${blockId} err=${String(e)}`,
                { bufferKey: "ps-as-osc-buf", tid }
            );
        });
    });
}

function clearManualAgentCommand(blockId: string, command: unknown): void {
    if (resolveAgentCommandBinding(command) == null) {
        return;
    }
    const tid = genFrontendTraceId();
    pslogTrace(
        "as-osc",
        `[as-osc] clear block=${blockId}`,
        { bufferKey: "ps-as-osc-buf", tid }
    );
    fireAndForget(async () => {
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", blockId),
            meta: {
                "cmd:jwt": null,
                "agent:provider": null,
                "agent:autoresume": null,
                "agent:sessionid": null,
            } as MetaType,
        }).catch((e) => {
            console.log("error clearing manual agent command", e);
            pslogTrace(
                "as-osc",
                `[as-osc] clear FAIL block=${blockId} err=${String(e)}`,
                { bufferKey: "ps-as-osc-buf", tid }
            );
        });
    });
}

function handleShellIntegrationCommandStart(
    termWrap: TermWrap,
    blockId: string,
    cmd: { command: "C"; data: { cmd64?: string } },
    rtInfo: ObjRTInfo // this is passed by reference and modified inside of this function
): void {
    const now = Date.now();
    rtInfo["shell:state"] = "running-command";
    rtInfo["shell:lastupdated"] = now;
    globalStore.set(termWrap.shellIntegrationStatusAtom, "running-command");
    globalStore.set(termWrap.shellIntegrationUpdatedAtAtom, now);
    const connName = globalStore.get(getBlockMetaKeyAtom(blockId, "connection")) ?? "";
    const isRemote = isSshConnName(connName);
    const isWsl = isWslConnName(connName);
    const isDurable = globalStore.get(getBlockTermDurableAtom(blockId)) ?? false;
    getApi().incrementTermCommands({ isRemote, isWsl, isDurable });
    if (cmd.data.cmd64) {
        const decodedLen = Math.ceil(cmd.data.cmd64.length * 0.75);
        if (decodedLen > 8192) {
            rtInfo["shell:lastcmd"] = `# command too large (${decodedLen} bytes)`;
            globalStore.set(termWrap.lastCommandAtom, rtInfo["shell:lastcmd"]);
        } else {
            try {
                const decodedCmd = base64ToString(cmd.data.cmd64);
                rtInfo["shell:lastcmd"] = decodedCmd;
                globalStore.set(termWrap.lastCommandAtom, decodedCmd);
                const isCC = isClaudeCodeCommand(decodedCmd);
                globalStore.set(termWrap.claudeCodeActiveAtom, isCC);
                checkCommandForTelemetry(decodedCmd);
                bindManualAgentCommand(blockId, decodedCmd);
            } catch (e) {
                console.error("Error decoding cmd64:", e);
                rtInfo["shell:lastcmd"] = null;
                globalStore.set(termWrap.lastCommandAtom, null);
                globalStore.set(termWrap.claudeCodeActiveAtom, false);
            }
        }
    } else {
        rtInfo["shell:lastcmd"] = null;
        globalStore.set(termWrap.lastCommandAtom, null);
        globalStore.set(termWrap.claudeCodeActiveAtom, false);
    }
    rtInfo["shell:lastcmdexitcode"] = null;
    agentStatusLog("osc16162 command start", {
        blockId,
        state: rtInfo["shell:state"],
        updatedAt: rtInfo["shell:lastupdated"],
        command: commandPreview(rtInfo["shell:lastcmd"]),
        claudeCodeActive: globalStore.get(termWrap.claudeCodeActiveAtom),
    });
}

// for xterm OSC handlers, we return true always because we "own" the OSC number.
// even if data is invalid we don't want to propagate to other handlers.
export function handleOsc52Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    if (!loaded) {
        return true;
    }
    const osc52Mode = globalStore.get(getOverrideConfigAtom(blockId, "term:osc52")) ?? "always";
    if (osc52Mode === "focus") {
        const isBlockFocused = termWrap.nodeModel ? globalStore.get(termWrap.nodeModel.isFocused) : false;
        if (!document.hasFocus() || !isBlockFocused) {
            console.log("OSC 52: rejected, window or block not focused");
            return true;
        }
    }
    if (!data || data.length === 0) {
        console.log("OSC 52: empty data received");
        return true;
    }
    if (data.length > Osc52MaxRawLength) {
        console.log("OSC 52: raw data too large", data.length);
        return true;
    }

    const semicolonIndex = data.indexOf(";");
    if (semicolonIndex === -1) {
        console.log("OSC 52: invalid format (no semicolon)", data.substring(0, 50));
        return true;
    }

    const clipboardSelection = data.substring(0, semicolonIndex);
    const base64Data = data.substring(semicolonIndex + 1);

    // clipboard query ("?") is not supported for security (prevents clipboard theft)
    if (base64Data === "?") {
        console.log("OSC 52: clipboard query not supported");
        return true;
    }

    if (base64Data.length === 0) {
        return true;
    }

    if (clipboardSelection.length > 10) {
        console.log("OSC 52: clipboard selection too long", clipboardSelection);
        return true;
    }

    const estimatedDecodedSize = Math.ceil(base64Data.length * 0.75);
    if (estimatedDecodedSize > Osc52MaxDecodedSize) {
        console.log("OSC 52: data too large", estimatedDecodedSize, "bytes");
        return true;
    }

    try {
        // strip whitespace from base64 data (some terminals chunk with newlines per RFC 4648)
        const cleanBase64Data = base64Data.replace(/\s+/g, "");
        const decodedText = base64ToString(cleanBase64Data);

        // validate actual decoded size (base64 estimate can be off for multi-byte UTF-8)
        const actualByteSize = new TextEncoder().encode(decodedText).length;
        if (actualByteSize > Osc52MaxDecodedSize) {
            console.log("OSC 52: decoded text too large", actualByteSize, "bytes");
            return true;
        }

        fireAndForget(async () => {
            try {
                await navigator.clipboard.writeText(decodedText);
                dlog("OSC 52: copied", decodedText.length, "characters to clipboard");
            } catch (err) {
                console.error("OSC 52: clipboard write failed:", err);
            }
        });
    } catch (e) {
        console.error("OSC 52: base64 decode error:", e);
    }

    return true;
}

// for xterm handlers, we return true always because we "own" OSC 7.
// even if it is invalid we dont want to propagate to other handlers
export function handleOsc7Command(data: string, blockId: string, loaded: boolean): boolean {
    if (!loaded) {
        return true;
    }
    if (data == null || data.length == 0) {
        console.log("Invalid OSC 7 command received (empty)");
        return true;
    }
    if (data.length > 1024) {
        console.log("Invalid OSC 7, data length too long", data.length);
        return true;
    }

    let pathPart: string;
    try {
        const url = new URL(data);
        if (url.protocol !== "file:") {
            console.log("Invalid OSC 7 command received (non-file protocol)", data);
            return true;
        }
        pathPart = decodeURIComponent(url.pathname);

        // Normalize double slashes at the beginning to single slash
        if (pathPart.startsWith("//")) {
            pathPart = pathPart.substring(1);
        }

        // Handle Windows paths (e.g., /C:/... or /D:\...)
        if (/^\/[a-zA-Z]:[\\/]/.test(pathPart)) {
            // Strip leading slash and normalize to forward slashes
            pathPart = pathPart.substring(1).replace(/\\/g, "/");
        }

        // Handle UNC paths (e.g., /\\server\share)
        if (pathPart.startsWith("/\\\\")) {
            // Strip leading slash but keep backslashes for UNC
            pathPart = pathPart.substring(1);
        }
    } catch (e) {
        console.log("Invalid OSC 7 command received (parse error)", data, e);
        return true;
    }

    setTimeout(() => {
        fireAndForget(async () => {
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", blockId),
                meta: { "cmd:cwd": pathPart },
            });

            const rtInfo = { "shell:hascurcwd": true };
            const rtInfoData: CommandSetRTInfoData = {
                oref: WOS.makeORef("block", blockId),
                data: rtInfo,
            };
            await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                console.log("error setting RT info", e)
            );
        });
    }, 0);
    return true;
}

export function handleOsc16162Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    const terminal = termWrap.terminal;
    if (!loaded) {
        return true;
    }
    if (!data || data.length === 0) {
        return true;
    }

    const parts = data.split(";");
    const commandStr = parts[0];
    const jsonDataStr = parts.length > 1 ? parts.slice(1).join(";") : null;
    let parsedData: Record<string, any> = {};
    if (jsonDataStr) {
        try {
            parsedData = JSON.parse(jsonDataStr);
        } catch (e) {
            console.error("Error parsing OSC 16162 JSON data:", e);
        }
    }

    const cmd: Osc16162Command = { command: commandStr, data: parsedData } as Osc16162Command;
    const rtInfo: ObjRTInfo = {};
    const now = Date.now();
    switch (cmd.command) {
        case "A": {
            rtInfo["shell:state"] = "ready";
            rtInfo["shell:lastupdated"] = now;
            globalStore.set(termWrap.shellIntegrationStatusAtom, "ready");
            globalStore.set(termWrap.shellIntegrationUpdatedAtAtom, now);
            globalStore.set(termWrap.claudeCodeActiveAtom, false);
            agentStatusLog("osc16162 prompt ready", {
                blockId,
                state: rtInfo["shell:state"],
                updatedAt: rtInfo["shell:lastupdated"],
            });
            const marker = terminal.registerMarker(0);
            if (marker) {
                termWrap.promptMarkers.push(marker);
                // addTestMarkerDecoration(terminal, marker, termWrap);
                marker.onDispose(() => {
                    const idx = termWrap.promptMarkers.indexOf(marker);
                    if (idx !== -1) {
                        termWrap.promptMarkers.splice(idx, 1);
                    }
                });
            }
            break;
        }
        case "C":
            handleShellIntegrationCommandStart(termWrap, blockId, cmd, rtInfo);
            break;
        case "M":
            if (cmd.data.shell) {
                rtInfo["shell:type"] = cmd.data.shell;
            }
            if (cmd.data.shellversion) {
                rtInfo["shell:version"] = cmd.data.shellversion;
            }
            if (cmd.data.uname) {
                rtInfo["shell:uname"] = cmd.data.uname;
            }
            if (cmd.data.integration != null) {
                rtInfo["shell:integration"] = cmd.data.integration;
            }
            if (cmd.data.omz != null) {
                rtInfo["shell:omz"] = cmd.data.omz;
            }
            if (cmd.data.comp != null) {
                rtInfo["shell:comp"] = cmd.data.comp;
            }
            break;
        case "D":
            rtInfo["shell:state"] = "ready";
            rtInfo["shell:lastupdated"] = now;
            globalStore.set(termWrap.shellIntegrationStatusAtom, "ready");
            globalStore.set(termWrap.shellIntegrationUpdatedAtAtom, now);
            globalStore.set(termWrap.claudeCodeActiveAtom, false);
            clearManualAgentCommand(blockId, globalStore.get(termWrap.lastCommandAtom));
            if (cmd.data.exitcode != null) {
                rtInfo["shell:lastcmdexitcode"] = cmd.data.exitcode;
            } else {
                rtInfo["shell:lastcmdexitcode"] = null;
            }
            agentStatusLog("osc16162 command done", {
                blockId,
                state: rtInfo["shell:state"],
                updatedAt: rtInfo["shell:lastupdated"],
                exitCode: rtInfo["shell:lastcmdexitcode"],
                lastCommand: commandPreview(globalStore.get(termWrap.lastCommandAtom)),
            });
            break;
        case "I":
            if (cmd.data.inputempty != null) {
                rtInfo["shell:inputempty"] = cmd.data.inputempty;
            }
            break;
        case "R":
            rtInfo["shell:state"] = null;
            rtInfo["shell:lastupdated"] = now;
            globalStore.set(termWrap.shellIntegrationStatusAtom, null);
            globalStore.set(termWrap.shellIntegrationUpdatedAtAtom, now);
            globalStore.set(termWrap.claudeCodeActiveAtom, false);
            if (terminal.buffer.active.type === "alternate") {
                terminal.write("\x1b[?1049l");
            }
            agentStatusLog("osc16162 reset", {
                blockId,
                state: rtInfo["shell:state"],
                updatedAt: rtInfo["shell:lastupdated"],
            });
            break;
    }

    if (Object.keys(rtInfo).length > 0) {
        agentStatusLog("osc16162 rtinfo write", {
            blockId,
            command: cmd.command,
            rtInfo: {
                "shell:state": rtInfo["shell:state"],
                "shell:integration": rtInfo["shell:integration"],
                "shell:lastupdated": rtInfo["shell:lastupdated"],
                "shell:lastcmd": commandPreview(rtInfo["shell:lastcmd"]),
                "shell:lastcmdexitcode": rtInfo["shell:lastcmdexitcode"],
            },
        });
        setTimeout(() => {
            fireAndForget(async () => {
                const rtInfoData: CommandSetRTInfoData = {
                    oref: WOS.makeORef("block", blockId),
                    data: rtInfo,
                };
                await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                    console.log("error setting RT info (OSC 16162)", e)
                );
            });
        }, 0);
    }

    return true;
}
