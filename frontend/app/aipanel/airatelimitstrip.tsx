// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { i18n } from "@/i18n/config";
import * as jotai from "jotai";
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const GetMoreButton = memo(({ variant, showClose = true }: { variant: "yellow" | "red"; showClose?: boolean }) => {
    const { t } = useTranslation("aipanel");
    const isYellow = variant === "yellow";
    const bgColor = isYellow ? "bg-warning/10" : "bg-error/10";
    const hoverBg = isYellow ? "hover:bg-warning/20" : "hover:bg-error/20";
    const borderColor = isYellow ? "border-warning/40" : "border-error/40";
    const textColor = isYellow ? "text-warning" : "text-error";
    const iconColor = isYellow ? "text-warning" : "text-error";
    const iconMutedClass = isYellow ? "text-warning/60 hover:text-warning" : "text-error/60 hover:text-error";
    const iconHoverBg =
        showClose && isYellow
            ? "hover:has-[.close:hover]:bg-warning/10"
            : showClose
              ? "hover:has-[.close:hover]:bg-error/10"
              : "";

    if (true as boolean) {
        // disable now until we have modal
        return null;
    }

    return (
        <div className="pl-2 pb-1.5">
            <button
                className={`flex items-center gap-1.5 ${showClose ? "pl-1" : "pl-2"} pr-2 py-1 ${bgColor} ${iconHoverBg} ${hoverBg} rounded-b border border-t-0 ${borderColor} text-[11px] ${textColor} cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
            >
                {showClose && <i className={`close fa fa-xmark ${iconMutedClass} transition-colors`}></i>}
                <span>{t("aipanel:rateLimit.getMore")}</span>
                <i className={`fa fa-arrow-right ${iconColor}`}></i>
            </button>
        </div>
    );
});

GetMoreButton.displayName = "GetMoreButton";

function formatTimeRemaining(expirationEpoch: number): string {
    const now = Math.floor(Date.now() / 1000);
    const secondsRemaining = expirationEpoch - now;

    if (secondsRemaining <= 0) {
        return i18n.t("aipanel:rateLimit.soon");
    }

    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    if (hours > 0) {
        return `${hours}h`;
    }
    return `${minutes}m`;
}

const AIRateLimitStripComponent = memo(() => {
    const { t } = useTranslation("aipanel");
    let rateLimitInfo = jotai.useAtomValue(atoms.waveAIRateLimitInfoAtom);
    // rateLimitInfo = { req: 0, reqlimit: 200, preq: 0, preqlimit: 50, resetepoch: 1759374575 + 45 * 60 }; // testing
    const [, forceUpdate] = useState({});

    const shouldShow = rateLimitInfo && !rateLimitInfo.unknown && (rateLimitInfo.preq <= 5 || rateLimitInfo.req === 0);

    useEffect(() => {
        if (!shouldShow) {
            return;
        }

        const interval = setInterval(() => {
            forceUpdate({});
        }, 60000);

        return () => clearInterval(interval);
    }, [shouldShow]);

    if (!rateLimitInfo || rateLimitInfo.unknown || !shouldShow) {
        return null;
    }

    const { req, reqlimit, preq, preqlimit, resetepoch } = rateLimitInfo;
    const timeRemaining = formatTimeRemaining(resetepoch);
    const totalLimit = preqlimit + reqlimit;

    if (preq > 0 && preq <= 5) {
        return (
            <div>
                <div className="bg-warning/10 border-b border-warning/40 px-2 py-1.5 flex items-center gap-1 text-[11px] text-warning">
                    <i className="fa fa-sparkles text-warning"></i>
                    <span>
                        {i18n.t("aipanel:rateLimit.premiumUsed", { used: preqlimit - preq, limit: preqlimit })}
                    </span>
                    <div className="flex-1"></div>
                    <span className="text-warning/80">{i18n.t("aipanel:rateLimit.resetsIn", { time: timeRemaining })}</span>
                </div>
                <GetMoreButton variant="yellow" />
            </div>
        );
    }

    if (preq === 0 && req > 0) {
        return (
            <div>
                <div className="bg-warning/10 border-b border-warning/40 px-2 pr-1 py-1.5 flex items-center gap-1 text-[11px] text-warning">
                    <i className="fa fa-check text-warning"></i>
                    <span>
                        {i18n.t("aipanel:rateLimit.premium", { total: preqlimit })}
                    </span>
                    <span className="text-warning">•</span>
                    <span className="font-medium">{t("aipanel:rateLimit.nowOnBasic")}</span>
                    <div className="flex-1"></div>
                    <span className="text-warning/80">{i18n.t("aipanel:rateLimit.resetsIn", { time: timeRemaining })}</span>
                </div>
                <GetMoreButton variant="yellow" />
            </div>
        );
    }

    if (req === 0 && preq === 0) {
        return (
            <div>
                <div className="bg-error/10 border-b border-error/40 px-2 py-1.5 flex items-center gap-2 text-[11px] text-error">
                    <i className="fa fa-check text-error"></i>
                    <span>
                        {i18n.t("aipanel:rateLimit.reqs", { total: totalLimit })}
                    </span>
                    <span className="text-error">•</span>
                    <span className="font-medium">{t("aipanel:rateLimit.limitReached")}</span>
                    <div className="flex-1"></div>
                    <span className="text-error/80">{i18n.t("aipanel:rateLimit.resetsIn", { time: timeRemaining })}</span>
                </div>
                <GetMoreButton variant="red" showClose={false} />
            </div>
        );
    }

    return null;
});

AIRateLimitStripComponent.displayName = "AIRateLimitStrip";

export { AIRateLimitStripComponent as AIRateLimitStrip };
