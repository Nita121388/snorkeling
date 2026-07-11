// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import * as React from "react";
import { BlockEnv } from "./blockenv";

const WshManualInstallRequiredErrorCode = "wsh-manual-install-required";

function formatElapsedTime(elapsedMs: number): string {
    if (elapsedMs <= 0) {
        return "";
    }

    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    if (elapsedSeconds < 60) {
        return `${elapsedSeconds}s`;
    }

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) {
        return `${elapsedMinutes}m`;
    }

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const remainingMinutes = elapsedMinutes % 60;

    if (elapsedHours < 24) {
        if (remainingMinutes === 0) {
            return `${elapsedHours}h`;
        }
        return `${elapsedHours}h${remainingMinutes}m`;
    }

    return "more than a day";
}

function formatWshInstallStatus(status: string): string {
    switch (status) {
        case "checking":
            return "[1/6] Checking remote wsh";
        case "detecting-platform":
            return "[2/6] Detecting remote platform";
        case "finding-binary":
            return "[3/6] Finding local wsh binary";
        case "uploading":
            return "[4/6] Uploading wsh binary";
        case "verifying":
            return "[5/6] Verifying remote wsh";
        case "restarting-server":
            return "[6/6] Restarting connserver";
        case "complete":
            return "wsh install complete";
        case "failed":
            return "wsh install failed";
        default:
            return "";
    }
}

export function resolveWshRecoveryActions(
    wshInstallStatus: string,
    hasWshRuntimeError: boolean,
    wshErrorCode: string
) {
    const showActions = hasWshRuntimeError || wshInstallStatus == "failed";
    const manualInstallRequired =
        wshInstallStatus == "failed" && wshErrorCode == WshManualInstallRequiredErrorCode;
    return {
        showActions,
        showAutoRetry: showActions && !manualInstallRequired,
    };
}

const StalledOverlay = React.memo(
    ({
        connName,
        connStatus,
        overlayRefCallback,
    }: {
        connName: string;
        connStatus: ConnStatus;
        overlayRefCallback: (el: HTMLDivElement | null) => void;
    }) => {
        const [elapsedTime, setElapsedTime] = React.useState<string>("");

        const waveEnv = useWaveEnv<BlockEnv>();
        const handleDisconnect = React.useCallback(() => {
            const prtn = waveEnv.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 5000 });
            prtn.catch((e) => console.log("error disconnecting", connName, e));
        }, [connName, waveEnv]);

        React.useEffect(() => {
            if (!connStatus.lastactivitybeforestalledtime) {
                return;
            }

            const updateElapsed = () => {
                const now = Date.now();
                const lastActivity = connStatus.lastactivitybeforestalledtime!;
                const elapsed = now - lastActivity;
                setElapsedTime(formatElapsedTime(elapsed));
            };

            updateElapsed();
            const interval = setInterval(updateElapsed, 1000);

            return () => clearInterval(interval);
        }, [connStatus.lastactivitybeforestalledtime]);

        return (
            <div
                className="@container absolute top-[calc(var(--header-height)+6px)] left-1.5 right-1.5 z-[var(--zindex-block-mask-inner)] overflow-hidden rounded-md bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] shadow-lg opacity-90"
                ref={overlayRefCallback}
            >
                <div className="flex items-center gap-3 w-full pt-2.5 pb-2.5 pr-2 pl-3">
                    <i
                        className="fa-solid fa-triangle-exclamation text-warning text-base shrink-0"
                        title="Connection Stalled"
                    ></i>
                    <div className="text-[11px] font-semibold leading-4 tracking-[0.11px] text-white min-w-0 flex-1 break-words @max-xxs:hidden">
                        Connection to "{connName}" is stalled
                        {elapsedTime && ` (no activity for ${elapsedTime})`}
                    </div>
                    <div className="flex-1 hidden @max-xxs:block"></div>
                    <Button
                        className="outlined grey text-[11px] py-[3px] px-[7px] @max-w350:text-[12px] @max-w350:py-[5px] @max-w350:px-[6px]"
                        onClick={handleDisconnect}
                        title="Disconnect"
                    >
                        <span className="@max-w350:hidden!">Disconnect</span>
                        <i className="fa-solid fa-link-slash hidden! @max-w350:inline!"></i>
                    </Button>
                </div>
            </div>
        );
    }
);
StalledOverlay.displayName = "StalledOverlay";

export const ConnStatusOverlay = React.memo(
    ({
        nodeModel,
        viewModel,
        changeConnModalAtom,
    }: {
        nodeModel: NodeModel;
        viewModel: ViewModel;
        changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    }) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const connName = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "connection"));
        const [connModalOpen] = jotai.useAtom(changeConnModalAtom);
        const connStatus = jotai.useAtomValue(waveEnv.getConnStatusAtom(connName));
        const isLayoutMode = jotai.useAtomValue(waveEnv.atoms.controlShiftDelayAtom);
        const [overlayRefCallback, _, domRect] = useDimensionsWithCallbackRef(30);
        const width = domRect?.width;
        const [showError, setShowError] = React.useState(false);
        const wshConfigEnabled = jotai.useAtomValue(waveEnv.getConnConfigKeyAtom(connName, "conn:wshenabled")) ?? true;
        const [showWshError, setShowWshError] = React.useState(false);
        const [wshRepairStatus, setWshRepairStatus] = React.useState("");
        const [isRetryingWshInstall, setIsRetryingWshInstall] = React.useState(false);
        const wshInstallStatus = connStatus.wshinstallstatus ?? "";
        const wshInstallStatusText = formatWshInstallStatus(wshInstallStatus);
        const hasWshInstallProgress = wshInstallStatus != "" && wshInstallStatus != "complete";
        const hasWshRuntimeError = connStatus.status == "connected" && !!connStatus.wsherror;
        const { showActions: showWshActions, showAutoRetry } = resolveWshRecoveryActions(
            wshInstallStatus,
            hasWshRuntimeError,
            connStatus.wsherrorcode
        );

        React.useEffect(() => {
            if (width) {
                const hasError = !util.isBlank(connStatus.error);
                const showError = hasError && width >= 250 && connStatus.status == "error";
                setShowError(showError);
            }
        }, [width, connStatus, setShowError]);

        const handleTryReconnect = React.useCallback(() => {
            const prtn = waveEnv.rpc.ConnConnectCommand(
                TabRpcClient,
                { host: connName, logblockid: nodeModel.blockId },
                { timeout: 60000 }
            );
            prtn.catch((e) => console.log("error reconnecting", connName, e));
        }, [connName, nodeModel.blockId, waveEnv]);

        const handleDisableWsh = React.useCallback(async () => {
            const metamaptype: unknown = {
                "conn:wshenabled": false,
            };
            const data: ConnConfigRequest = {
                host: connName,
                metamaptype: metamaptype,
            };
            try {
                await waveEnv.rpc.SetConnectionsConfigCommand(TabRpcClient, data);
            } catch (e) {
                console.log("problem setting connection config: ", e);
            }
        }, [connName, waveEnv]);

        const handleRetryWshInstall = React.useCallback(async () => {
            setIsRetryingWshInstall(true);
            setWshRepairStatus("Retrying wsh install...");
            try {
                await waveEnv.rpc.ConnReinstallWshCommand(
                    TabRpcClient,
                    { connname: connName, logblockid: nodeModel.blockId },
                    { timeout: 180000 }
                );
                setWshRepairStatus("wsh installed. Reconnecting...");
                await waveEnv.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 10000 });
                await waveEnv.rpc.ConnConnectCommand(
                    TabRpcClient,
                    { host: connName, logblockid: nodeModel.blockId },
                    { timeout: 180000 }
                );
                setWshRepairStatus("wsh install complete.");
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setWshRepairStatus(`wsh install failed: ${message}`);
                console.log("error retrying wsh install", connName, e);
            } finally {
                setIsRetryingWshInstall(false);
            }
        }, [connName, nodeModel.blockId, waveEnv]);

        const handleOpenManualWshInstall = React.useCallback(async () => {
            try {
                const installData = (await TabRpcClient.wshRpcCall(
                    "connpreparemanualwshinstall",
                    { connname: connName, logblockid: nodeModel.blockId },
                    { timeout: 30000 }
                )) as { cmd: string };
                await waveEnv.createBlock({
                    meta: {
                        view: "term",
                        controller: "cmd",
                        connection: "local",
                        cmd: installData.cmd,
                        "cmd:runonstart": true,
                        "cmd:jwt": true,
                    },
                });
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setWshRepairStatus(`manual installer failed to open: ${message}`);
                console.log("error opening manual wsh installer", connName, e);
            }
        }, [connName, nodeModel.blockId, waveEnv]);

        const handleRemoveWshError = React.useCallback(async () => {
            try {
                await waveEnv.rpc.DismissWshFailCommand(TabRpcClient, connName);
            } catch (e) {
                console.log("unable to dismiss wsh error: ", e);
            }
        }, [connName, waveEnv]);

        let statusText = `Disconnected from "${connName}"`;
        let showReconnect = true;
        if (connStatus.status == "connecting") {
            statusText = `Connecting to "${connName}"...`;
            showReconnect = false;
        }
        if (connStatus.status == "connected") {
            showReconnect = false;
        }
        if (hasWshInstallProgress && wshInstallStatus != "failed") {
            statusText = `Installing wsh for "${connName}"...`;
            showReconnect = false;
        }
        let reconDisplay = null;
        let reconClassName = "outlined grey";
        if (width && width < 350) {
            reconDisplay = <i className="fa-sharp fa-solid fa-rotate-right"></i>;
            reconClassName = clsx(reconClassName, "text-[12px] py-[5px] px-[6px]");
        } else {
            reconDisplay = "Reconnect";
            reconClassName = clsx(reconClassName, "text-[11px] py-[3px] px-[7px]");
        }
        const showIcon = connStatus.status != "connecting";

        React.useEffect(() => {
            const showWshErrorTemp = (hasWshInstallProgress || hasWshRuntimeError) && wshConfigEnabled;

            setShowWshError(!!showWshErrorTemp);
        }, [hasWshInstallProgress, hasWshRuntimeError, wshConfigEnabled]);

        const handleCopy = React.useCallback(
            async (e: React.MouseEvent) => {
                const errTexts = [];
                if (showError) {
                    errTexts.push(`error: ${connStatus.error}`);
                }
                if (connStatus.wsherror) {
                    errTexts.push(`unable to use wsh: ${connStatus.wsherror}`);
                }
                if (connStatus.wsherrorcode) {
                    errTexts.push(`wsh error code: ${connStatus.wsherrorcode}`);
                }
                if (connStatus.wshinstallstatus) {
                    errTexts.push(`wsh install status: ${connStatus.wshinstallstatus}`);
                }
                if (connStatus.wshinstallmsg) {
                    errTexts.push(`wsh install message: ${connStatus.wshinstallmsg}`);
                }
                if (wshRepairStatus) {
                    errTexts.push(`wsh repair status: ${wshRepairStatus}`);
                }
                const textToCopy = errTexts.join("\n");
                await navigator.clipboard.writeText(textToCopy);
            },
            [
                showError,
                showWshError,
                connStatus.error,
                connStatus.wsherror,
                connStatus.wsherrorcode,
                connStatus.wshinstallstatus,
                connStatus.wshinstallmsg,
                wshRepairStatus,
            ]
        );

        const showStalled = connStatus.status == "connected" && connStatus.connhealthstatus == "stalled";
        if (!showWshError && !showStalled && (isLayoutMode || connStatus.status == "connected" || connModalOpen)) {
            return null;
        }

        if (showStalled && !showWshError) {
            return (
                <StalledOverlay connName={connName} connStatus={connStatus} overlayRefCallback={overlayRefCallback} />
            );
        }

        return (
            <div className="connstatus-overlay" ref={overlayRefCallback}>
                <div className="connstatus-content">
                    <div className={clsx("connstatus-status-icon-wrapper", { "has-error": showError || showWshError })}>
                        {showIcon && <i className="fa-solid fa-triangle-exclamation"></i>}
                        <div className="connstatus-status ellipsis">
                            <div className="connstatus-status-text">{statusText}</div>
                            {(showError || showWshError) && (
                                <OverlayScrollbarsComponent
                                    className="connstatus-error"
                                    options={{ scrollbars: { autoHide: "leave" } }}
                                >
                                    <CopyButton className="copy-button" onClick={handleCopy} title="Copy" />
                                    {showError ? <div>error: {connStatus.error}</div> : null}
                                    {connStatus.wsherror ? <div>unable to use wsh: {connStatus.wsherror}</div> : null}
                                    {wshInstallStatusText ? <div>{wshInstallStatusText}</div> : null}
                                    {connStatus.wshinstallmsg ? <div>{connStatus.wshinstallmsg}</div> : null}
                                    {connStatus.wsherrorcode ? <div>error code: {connStatus.wsherrorcode}</div> : null}
                                    {wshRepairStatus ? <div>{wshRepairStatus}</div> : null}
                                </OverlayScrollbarsComponent>
                            )}
                            {showWshActions && (
                                <div className="connstatus-inline-actions">
                                    {showAutoRetry && (
                                        <Button
                                            className={reconClassName}
                                            disabled={isRetryingWshInstall}
                                            onClick={handleRetryWshInstall}
                                        >
                                            {isRetryingWshInstall ? "Retrying..." : "Retry auto install"}
                                        </Button>
                                    )}
                                    <Button className={reconClassName} onClick={handleOpenManualWshInstall}>
                                        Manual install wsh
                                    </Button>
                                </div>
                            )}
                            {showWshActions && (
                                <Button className={reconClassName} onClick={handleDisableWsh}>
                                    always disable wsh
                                </Button>
                            )}
                        </div>
                    </div>
                    {showReconnect ? (
                        <div className="connstatus-actions">
                            <Button className={reconClassName} onClick={handleTryReconnect}>
                                {reconDisplay}
                            </Button>
                        </div>
                    ) : null}
                    {showWshActions ? (
                        <div className="connstatus-actions">
                            <Button className={`fa-xmark fa-solid ${reconClassName}`} onClick={handleRemoveWshError} />
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
);
ConnStatusOverlay.displayName = "ConnStatusOverlay";
