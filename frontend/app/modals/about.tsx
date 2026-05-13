// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { atoms, getApi } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { copyText } from "@/util/clipboard";
import { isDev } from "@/util/isdev";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "./modal";

const SNORKELING_REPO_URL = "https://github.com/Nita121388/snorkeling";
const WAVE_UPSTREAM_REPO_URL = "https://github.com/wavetermdev/waveterm";
const WAVE_WEBSITE_URL = "https://www.waveterm.dev/";

interface AboutModalVProps {
    versionString: string;
    updaterChannel: string;
    onClose: () => void;
}

const AboutModalV = ({ versionString, updaterChannel, onClose }: AboutModalVProps) => {
    const currentDate = new Date();
    const [debugVisible, setDebugVisible] = useState(false);
    const [debugText, setDebugText] = useState("");
    const [debugLoading, setDebugLoading] = useState(false);
    const [debugError, setDebugError] = useState("");
    const [copyStatus, setCopyStatus] = useState("");

    const loadDebugInfo = useCallback(async () => {
        setDebugLoading(true);
        setDebugError("");
        try {
            const debugInfo = await getApi().getAppDebugInfo();
            setDebugText(JSON.stringify(debugInfo, null, 2));
        } catch (e) {
            setDebugError(e instanceof Error ? e.message : String(e));
        } finally {
            setDebugLoading(false);
        }
    }, []);

    const toggleDebugInfo = useCallback(() => {
        if (debugVisible) {
            setDebugVisible(false);
            return;
        }
        setDebugVisible(true);
        if (debugText === "" && !debugLoading) {
            fireAndForget(() => loadDebugInfo());
        }
    }, [debugLoading, debugText, debugVisible, loadDebugInfo]);

    const copyDebugInfo = useCallback(() => {
        fireAndForget(async () => {
            let textToCopy = debugText;
            if (textToCopy === "") {
                const debugInfo = await getApi().getAppDebugInfo();
                textToCopy = JSON.stringify(debugInfo, null, 2);
                setDebugText(textToCopy);
            }
            await copyText(textToCopy);
            setCopyStatus("Copied");
            window.setTimeout(() => setCopyStatus(""), 1500);
        });
    }, [debugText]);

    return (
        <Modal className="pt-[34px] pb-[34px] overflow-hidden w-[min(720px,calc(100vw-32px))]" onClose={onClose}>
            <OnboardingGradientBg />
            <div className="flex flex-col gap-[22px] w-full relative z-10">
                <div className="flex flex-col items-center justify-center gap-4 self-stretch w-full text-center">
                    <Logo />
                    <div className="text-[25px]">Snorkeling</div>
                    <div className="leading-5">
                        Customized from Wave Terminal upstream
                        <br />
                        Open-Source AI-Integrated Terminal
                    </div>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">
                    Client Version {versionString}
                    <br />
                    Update Channel: {updaterChannel}
                </div>
                <div className="items-center self-stretch w-full text-center text-secondary text-sm leading-5">
                    Snorkeling is a personal customization project based on Wave Terminal.
                    <br />
                    Use the links below to access both the Snorkeling repository and the Wave upstream repository.
                </div>
                <div className="grid grid-cols-2 gap-[10px] self-stretch w-full">
                    <a
                        href={SNORKELING_REPO_URL}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-brands fa-github mr-2"></i>Snorkeling Repo
                    </a>
                    <a
                        href={WAVE_UPSTREAM_REPO_URL}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-brands fa-github mr-2"></i>Wave Upstream
                    </a>
                    <a
                        href={`${SNORKELING_REPO_URL}/blob/main/ACKNOWLEDGEMENTS.md`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-book mr-2"></i>Open Source
                    </a>
                    <a
                        href={WAVE_WEBSITE_URL}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-globe mr-2"></i>Wave Website
                    </a>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 self-stretch w-full">
                    <button
                        type="button"
                        onClick={toggleDebugInfo}
                        className="inline-flex h-[34px] items-center justify-center rounded border border-border px-3 text-sm hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-bug mr-2" />
                        {debugVisible ? "Hide Debug Info" : "Show Debug Info"}
                    </button>
                    <button
                        type="button"
                        onClick={copyDebugInfo}
                        className="inline-flex h-[34px] items-center justify-center rounded border border-border px-3 text-sm hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-copy mr-2" />
                        {copyStatus || "Copy Debug Info"}
                    </button>
                    {debugVisible && (
                        <button
                            type="button"
                            onClick={() => fireAndForget(() => loadDebugInfo())}
                            disabled={debugLoading}
                            className="inline-flex h-[34px] items-center justify-center rounded border border-border px-3 text-sm hover:bg-hoverbg disabled:opacity-50 transition-colors duration-200"
                        >
                            <i className="fa-sharp fa-light fa-rotate mr-2" />
                            Refresh
                        </button>
                    )}
                </div>
                {debugVisible && (
                    <div className="self-stretch w-full">
                        {debugError ? (
                            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                {debugError}
                            </div>
                        ) : (
                            <textarea
                                readOnly
                                value={debugLoading && debugText === "" ? "Loading..." : debugText}
                                className="h-[220px] w-full resize-none rounded border border-border bg-black/30 p-2 font-mono text-[11px] leading-4 outline-none"
                            />
                        )}
                    </div>
                )}
                <div className="items-center gap-4 self-stretch w-full text-center">
                    &copy; {currentDate.getFullYear()} Command Line Inc.
                </div>
            </div>
        </Modal>
    );
};

AboutModalV.displayName = "AboutModalV";

const AboutModal = () => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const versionString = `${fullConfig?.version ?? ""} (${isDev() ? "dev-" : ""}${fullConfig?.buildtime ?? ""})`;
    const updaterChannel = fullConfig?.settings?.["autoupdate:channel"] ?? "latest";

    useEffect(() => {
        fireAndForget(async () => {
            RpcApi.RecordTEventCommand(
                TabRpcClient,
                { event: "action:other", props: { "action:type": "about" } },
                { noresponse: true }
            );
        });
    }, []);

    return (
        <AboutModalV
            versionString={versionString}
            updaterChannel={updaterChannel}
            onClose={() => modalsModel.popModal()}
        />
    );
};

AboutModal.displayName = "AboutModal";

export { AboutModal, AboutModalV };
