// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveEnv, WaveEnvSubset, useWaveEnv } from "@/app/waveenv/waveenv";
import { Tooltip } from "@/element/tooltip";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

type UpdateBannerEnv = WaveEnvSubset<{
    electron: {
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
    };
    atoms: {
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
    };
}>;

function getUpdateStatusMessage(status: string): string {
    switch (status) {
        case "ready":
            return "Update";
        case "manual-update":
            return "Manual Update";
        case "downloading":
            return "Downloading";
        case "installing":
            return "Installing";
        case "error":
            return "Update Error";
        default:
            return null;
    }
}

const UpdateStatusBannerComponent = () => {
    const env = useWaveEnv<UpdateBannerEnv>();
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);
    const updateStatusMessage = getUpdateStatusMessage(appUpdateStatus);

    const onClick = useCallback(() => {
        if (appUpdateStatus === "ready" || appUpdateStatus === "manual-update" || appUpdateStatus === "error") {
            env.electron.installAppUpdate();
        }
    }, [appUpdateStatus, env]);

    if (!updateStatusMessage) {
        return null;
    }

    const isReady = appUpdateStatus === "ready";
    const isManualUpdate = appUpdateStatus === "manual-update";
    const isError = appUpdateStatus === "error";
    const tooltipContent = isReady
        ? "Click to Install Update"
        : isManualUpdate
          ? "Open latest release for manual installation."
          : isError
            ? "Update failed. Click for details."
            : updateStatusMessage;

    return (
        <Tooltip
            content={tooltipContent}
            placement="bottom"
            divOnClick={isReady || isManualUpdate || isError ? onClick : undefined}
            divClassName={`flex items-center gap-1 px-2 mb-1 h-[22px] text-xs font-medium text-black rounded-sm transition-all ${
                isError
                    ? "bg-error text-white cursor-pointer hover:bg-[var(--button-red-hover-bg)]"
                    : `bg-accent ${
                          isReady || isManualUpdate ? "cursor-pointer hover:bg-[var(--button-green-border-color)]" : ""
                      }`
            }`}
            divStyle={{ WebkitAppRegion: "no-drag" } as any}
        >
            <i
                className={`fa ${isError ? "fa-triangle-exclamation" : isManualUpdate ? "fa-up-right-from-square" : "fa-download"}`}
            />
            {updateStatusMessage}
        </Tooltip>
    );
};
UpdateStatusBannerComponent.displayName = "UpdateStatusBannerComponent";

export const UpdateStatusBanner = memo(UpdateStatusBannerComponent);
