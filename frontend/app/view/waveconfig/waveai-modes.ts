// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave AI modes CRUD for the visual editor.
//
// Reads the live mode config from the global waveaiModeConfigAtom (updated by
// the backend's waveai:modeconfig broadcast) and persists changes by writing
// waveai.json directly (FileWriteCommand). The backend watcher picks up the
// file change and re-broadcasts, so the atom stays the single source of truth.
//
// Storage format is unchanged (AIModeConfigType / waveai.json); existing
// consumers such as the AI panel mode picker are untouched.

import { globalStore } from "@/app/store/jotaiStore";
import { atoms } from "@/app/store/global-atoms";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { RpcApi } from "@/app/store/wshclientapi";
import { stringToBase64 } from "@/util/util";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";

export type WaveAIModeEntry = {
    key: string;
    config: AIModeConfigType;
};

export function getWaveAIModes(): Record<string, AIModeConfigType> {
    return globalStore.get(atoms.waveaiModeConfigAtom) ?? {};
}

export function getWaveAIModeEntries(): WaveAIModeEntry[] {
    const modes = getWaveAIModes();
    return Object.entries(modes).map(([key, config]) => ({ key, config }));
}

let writeQueue = Promise.resolve();

function writeWaveAIModes(model: WaveConfigViewModel, next: Record<string, AIModeConfigType>): Promise<void> {
    // Update the local projection immediately, then serialize file writes. This
    // prevents a delayed watcher event or an earlier keystroke write from
    // resurrecting a mode just deleted by the user.
    globalStore.set(atoms.waveaiModeConfigAtom, next);
    const fullPath = `${model.configDir}/waveai.json`;
    const data64 = stringToBase64(JSON.stringify(next, null, 2));
    writeQueue = writeQueue.then(() =>
        model.env.rpc.FileWriteCommand(TabRpcClient, {
            info: { path: fullPath, mimetype: "application/json" },
            data64,
        })
    );
    return writeQueue;
}

/** Apply a patch (add/update) to the mode map and persist. */
export async function upsertWaveAIMode(
    model: WaveConfigViewModel,
    key: string,
    config: AIModeConfigType
): Promise<void> {
    const next = { ...getWaveAIModes(), [key]: config };
    await writeWaveAIModes(model, next);
}

/** Remove a mode and persist. */
export async function deleteWaveAIMode(model: WaveConfigViewModel, key: string): Promise<void> {
    const current = getWaveAIModes();
    if (!(key in current)) {
        return;
    }
    const next = { ...current };
    delete next[key];
    await writeWaveAIModes(model, next);
}

/** Rename a mode's display name (key stays stable). */
export async function renameWaveAIMode(
    model: WaveConfigViewModel,
    key: string,
    displayName: string
): Promise<void> {
    const current = getWaveAIModes();
    const config = current[key];
    if (config == null) {
        return;
    }
    await upsertWaveAIMode(model, key, { ...config, "display:name": displayName });
}

/** Set the default mode via settings (waveai:defaultmode). */
export async function setDefaultWaveAIMode(modeKey: string): Promise<void> {
    await RpcApi.SetConfigCommand(TabRpcClient, { "waveai:defaultmode": modeKey } as SettingsType);
}
