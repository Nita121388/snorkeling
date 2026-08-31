// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveEnv, WaveEnvSubset, useWaveEnv } from "@/app/waveenv/waveenv";
import { Tooltip } from "@/element/tooltip";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

type UpdateBannerEnv = WaveEnvSubset<{
    electron: {
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
        cancelAppUpdateDownload: WaveEnv["electron"]["cancelAppUpdateDownload"];
        retryAppUpdateDownload: WaveEnv["electron"]["retryAppUpdateDownload"];
    };
    atoms: {
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
        updaterManualProgressAtom: WaveEnv["atoms"]["updaterManualProgressAtom"];
    };
}>;

function formatBytes(bytes: number | undefined): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, idx);
    return `${parseFloat(value.toPrecision(3))} ${units[idx]}`;
}

function getUpdateStatusMessage(
    status: UpdaterStatus,
    progress: UpdaterManualProgress | null
): string | null {
    if (status === "ready" || status === "manual-update") return "Update";
    if (status === "installing") return "Installing";
    if (status === "downloading") {
        if (progress?.phase === "downloading" && (progress.received ?? 0) > 0 && (progress.total ?? 0) > 0) {
            const pct = Math.min(99, Math.floor(((progress.received ?? 0) / progress.total) * 100));
            return `Downloading ${formatBytes(progress.received)} / ${formatBytes(progress.total)} (${pct}%)`;
        }
        return "Downloading";
    }
    if (status === "error") {
        if (progress?.phase === "failed" && progress.error === "cancelled") return null;
        return "Update Error";
    }
    return null;
}

const UpdateStatusBannerComponent = () => {
    const env = useWaveEnv<UpdateBannerEnv>();
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);
    const manualProgress = useAtomValue(env.atoms.updaterManualProgressAtom);
    const updateStatusMessage = getUpdateStatusMessage(appUpdateStatus, manualProgress);

    const isManualDownloading = appUpdateStatus === "downloading" && manualProgress?.phase === "downloading";
    const isFailedManual = appUpdateStatus === "error" && manualProgress?.phase === "failed";
    const isCancelled = isFailedManual && manualProgress?.error === "cancelled";

    const onClick = useCallback(() => {
        if (appUpdateStatus === "ready" || appUpdateStatus === "manual-update") {
            env.electron.installAppUpdate();
            return;
        }
        if (isFailedManual && !isCancelled) {
            env.electron.retryAppUpdateDownload?.();
        }
    }, [appUpdateStatus, isFailedManual, isCancelled, env]);

    const onCancel = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            env.electron.cancelAppUpdateDownload?.();
        },
        [env]
    );

    if (!updateStatusMessage) {
        return null;
    }

    const isReady = appUpdateStatus === "ready";
    const isManualUpdate = appUpdateStatus === "manual-update";
    const isError = appUpdateStatus === "error" && !isCancelled;
    const isClickable = isReady || isManualUpdate || (isFailedManual && !isCancelled);

    const tooltipContent = isReady
        ? "Click to Install Update"
        : isManualUpdate
          ? "Click to download and install this update"
          : isFailedManual && !isCancelled
            ? "Update download failed. Click to retry."
            : isCancelled
              ? null
              : updateStatusMessage;

    if (isCancelled) {
        return null;
    }

    return (
        <Tooltip
            content={tooltipContent ?? undefined}
            placement="bottom"
            divOnClick={isClickable ? onClick : undefined}
            divClassName={`flex items-center gap-1 px-2 mb-1 h-[22px] text-xs font-medium rounded-sm transition-all ${
                isError
                    ? "bg-error text-actiontext cursor-pointer hover:bg-[var(--button-red-hover-bg)]"
                    : `bg-action text-actiontext ${isClickable ? "cursor-pointer hover:bg-actionhover" : ""}`
            }`}
            divStyle={{ WebkitAppRegion: "no-drag" } as any}
        >
            <i
                className={`fa ${
                    isError
                        ? "fa-triangle-exclamation"
                        : isManualUpdate
                          ? "fa-up-right-from-square"
                          : "fa-download"
                }`}
            />
            {updateStatusMessage}
            {isManualDownloading && (
                <button
                    type="button"
                    className="ml-1 opacity-70 hover:opacity-100"
                    onClick={onCancel}
                    title="Cancel download"
                >
                    <i className="fa fa-xmark" />
                </button>
            )}
        </Tooltip>
    );
};
UpdateStatusBannerComponent.displayName = "UpdateStatusBannerComponent";

export const UpdateStatusBanner = memo(UpdateStatusBannerComponent);
