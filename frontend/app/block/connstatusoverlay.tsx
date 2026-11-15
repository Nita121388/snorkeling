// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ConnectionOperationTimeoutMs } from "@/app/store/connection-timeout";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { i18n } from "@/i18n/config";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { BlockEnv } from "./blockenv";

const WshManualInstallRequiredErrorCode = "wsh-manual-install-required";
const ActiveWshInstallStatuses = new Set([
    "checking",
    "detecting-platform",
    "finding-binary",
    "uploading",
    "verifying",
    "restarting-server",
]);

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

    return i18n.t("block:connStatus.moreThanADay");
}

function formatWshInstallStatus(status: string): string {
    switch (status) {
        case "checking":
            return i18n.t("block:connStatus.wshInstall.checking");
        case "detecting-platform":
            return i18n.t("block:connStatus.wshInstall.detectingPlatform");
        case "finding-binary":
            return i18n.t("block:connStatus.wshInstall.findingBinary");
        case "uploading":
            return i18n.t("block:connStatus.wshInstall.uploading");
        case "verifying":
            return i18n.t("block:connStatus.wshInstall.verifying");
        case "restarting-server":
            return i18n.t("block:connStatus.wshInstall.restartingServer");
        case "complete":
            return i18n.t("block:connStatus.wshInstall.complete");
        case "failed":
            return i18n.t("block:connStatus.wshInstall.failed");
        default:
            return "";
    }
}

export function resolveWshRecoveryActions(wshInstallStatus: string, hasWshRuntimeError: boolean, wshErrorCode: string) {
    const showActions = hasWshRuntimeError || wshInstallStatus == "failed";
    const manualInstallRequired = wshInstallStatus == "failed" && wshErrorCode == WshManualInstallRequiredErrorCode;
    const showCancel = ActiveWshInstallStatuses.has(wshInstallStatus);
    return {
        showActions,
        showAutoRetry: showActions && !manualInstallRequired,
        showCancel,
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
        const { t } = useTranslation("block");
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
                        title={t("block:connStatus.stalledTitle")}
                    ></i>
                    <div className="text-[11px] font-semibold leading-4 tracking-[0.11px] text-white min-w-0 flex-1 break-words @max-xxs:hidden">
                        {i18n.t("block:connStatus.stalled", { conn: connName })}
                        {elapsedTime ? ` ${i18n.t("block:connStatus.noActivity", { time: elapsedTime })}` : ""}
                    </div>
                    <div className="flex-1 hidden @max-xxs:block"></div>
                    <Button
                        className="outlined grey text-[11px] py-[3px] px-[7px] @max-w350:text-[12px] @max-w350:py-[5px] @max-w350:px-[6px]"
                        onClick={handleDisconnect}
                        title={t("block:connStatus.disconnect")}
                    >
                        <span className="@max-w350:hidden!">{t("block:connStatus.disconnect")}</span>
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
        const { t } = useTranslation("block");
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
        const [isWshActionRunning, setIsWshActionRunning] = React.useState(false);
        const wshInstallStatus = connStatus.wshinstallstatus ?? "";
        const wshInstallStatusText = formatWshInstallStatus(wshInstallStatus);
        const hasWshInstallProgress = wshInstallStatus != "" && wshInstallStatus != "complete";
        const hasWshRuntimeError = connStatus.status == "connected" && !!connStatus.wsherror;
        const {
            showActions: showWshActions,
            showAutoRetry,
            showCancel: showWshCancel,
        } = resolveWshRecoveryActions(wshInstallStatus, hasWshRuntimeError, connStatus.wsherrorcode);

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
                { timeout: ConnectionOperationTimeoutMs }
            );
            prtn.catch((e) => console.log("error reconnecting", connName, e));
        }, [connName, nodeModel.blockId, waveEnv]);

        const handleDisableWsh = React.useCallback(async () => {
            setIsWshActionRunning(true);
            setWshRepairStatus(i18n.t("block:connStatus.repair.disabling"));
            const metamaptype: unknown = {
                "conn:wshenabled": false,
            };
            const data: ConnConfigRequest = {
                host: connName,
                metamaptype: metamaptype,
            };
            try {
                await waveEnv.rpc.SetConnectionsConfigCommand(TabRpcClient, data);
                await waveEnv.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 10000 });
                await waveEnv.rpc.ConnConnectCommand(
                    TabRpcClient,
                    { host: connName, logblockid: nodeModel.blockId },
                    { timeout: ConnectionOperationTimeoutMs }
                );
                setWshRepairStatus(i18n.t("block:connStatus.repair.reconnected"));
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setWshRepairStatus(i18n.t("block:connStatus.repair.disableFailed", { message }));
                console.log("problem disabling wsh and reconnecting: ", e);
            } finally {
                setIsWshActionRunning(false);
            }
        }, [connName, nodeModel.blockId, waveEnv]);

        const handleCancelWshInstall = React.useCallback(async () => {
            setIsWshActionRunning(true);
            setWshRepairStatus(i18n.t("block:connStatus.repair.cancelling"));
            try {
                await waveEnv.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 10000 });
                setWshRepairStatus(i18n.t("block:connStatus.repair.canceled"));
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setWshRepairStatus(i18n.t("block:connStatus.repair.cancelFailed", { message }));
                console.log("error cancelling wsh install", connName, e);
            } finally {
                setIsWshActionRunning(false);
            }
        }, [connName, waveEnv]);

        const handleRetryWshInstall = React.useCallback(async () => {
            setIsWshActionRunning(true);
            setWshRepairStatus(i18n.t("block:connStatus.repair.retrying"));
            try {
                await waveEnv.rpc.ConnReinstallWshCommand(
                    TabRpcClient,
                    { connname: connName, logblockid: nodeModel.blockId },
                    { timeout: ConnectionOperationTimeoutMs }
                );
                setWshRepairStatus(i18n.t("block:connStatus.repair.installedReconnecting"));
                await waveEnv.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 10000 });
                await waveEnv.rpc.ConnConnectCommand(
                    TabRpcClient,
                    { host: connName, logblockid: nodeModel.blockId },
                    { timeout: ConnectionOperationTimeoutMs }
                );
                setWshRepairStatus(i18n.t("block:connStatus.repair.complete"));
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setWshRepairStatus(i18n.t("block:connStatus.repair.failed", { message }));
                console.log("error retrying wsh install", connName, e);
            } finally {
                setIsWshActionRunning(false);
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
                setWshRepairStatus(i18n.t("block:connStatus.repair.manualOpenFailed", { message }));
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

        let statusText = i18n.t("block:connStatus.disconnectedFrom", { conn: connName });
        let showReconnect = true;
        if (connStatus.status == "connecting") {
            statusText = i18n.t("block:connStatus.connectingTo", { conn: connName });
            showReconnect = false;
        }
        if (connStatus.status == "connected") {
            showReconnect = false;
        }
        if (hasWshInstallProgress && wshInstallStatus != "failed") {
            statusText = i18n.t("block:connStatus.installingWsh", { conn: connName });
            showReconnect = false;
        }
        let reconDisplay = null;
        let reconClassName = "outlined grey";
        if (width && width < 350) {
            reconDisplay = <i className="fa-sharp fa-solid fa-rotate-right"></i>;
            reconClassName = clsx(reconClassName, "text-[12px] py-[5px] px-[6px]");
        } else {
            reconDisplay = t("block:connStatus.reconnect");
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
                // 复制到剪贴板的是给 bug 报告用的原始诊断，不跟随界面语言（与下面几行保持一致）。
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
                                    <CopyButton
                                        className="copy-button"
                                        onClick={handleCopy}
                                        title={t("block:connStatus.copy")}
                                    />
                                    {showError ? (
                                        <div>{i18n.t("block:connStatus.errorLine", { message: connStatus.error })}</div>
                                    ) : null}
                                    {connStatus.wsherror ? (
                                        <div>
                                            {i18n.t("block:connStatus.wshErrorLine", { message: connStatus.wsherror })}
                                        </div>
                                    ) : null}
                                    {wshInstallStatusText ? <div>{wshInstallStatusText}</div> : null}
                                    {connStatus.wshinstallmsg ? <div>{connStatus.wshinstallmsg}</div> : null}
                                    {connStatus.wsherrorcode ? (
                                        <div>
                                            {i18n.t("block:connStatus.errorCodeLine", {
                                                code: connStatus.wsherrorcode,
                                            })}
                                        </div>
                                    ) : null}
                                    {wshRepairStatus ? <div>{wshRepairStatus}</div> : null}
                                </OverlayScrollbarsComponent>
                            )}
                            {(showWshActions || showWshCancel) && (
                                <div className="connstatus-inline-actions">
                                    {showWshCancel && (
                                        <Button
                                            className={reconClassName}
                                            disabled={isWshActionRunning}
                                            onClick={handleCancelWshInstall}
                                        >
                                            {isWshActionRunning
                                                ? t("block:connStatus.cancelling")
                                                : t("block:connStatus.cancelInstall")}
                                        </Button>
                                    )}
                                    {showWshActions && showAutoRetry && (
                                        <Button
                                            className={reconClassName}
                                            disabled={isWshActionRunning}
                                            onClick={handleRetryWshInstall}
                                        >
                                            {isWshActionRunning
                                                ? t("block:connStatus.retrying")
                                                : t("block:connStatus.retryAutoInstall")}
                                        </Button>
                                    )}
                                    {showWshActions && (
                                        <Button
                                            className={reconClassName}
                                            disabled={isWshActionRunning}
                                            onClick={handleOpenManualWshInstall}
                                        >
                                            {t("block:connStatus.manualInstallWsh")}
                                        </Button>
                                    )}
                                </div>
                            )}
                            {(showWshActions || showWshCancel) && (
                                <Button
                                    className={reconClassName}
                                    disabled={isWshActionRunning}
                                    onClick={handleDisableWsh}
                                >
                                    {t("block:connStatus.disableWsh")}
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
