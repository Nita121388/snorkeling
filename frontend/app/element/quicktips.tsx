// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MagnifyIcon } from "@/app/element/magnify";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";

const KeyCap = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="inline-block px-2 py-1 mx-[1px] font-mono text-[0.85em] text-foreground bg-highlightbg rounded-[3px] border border-border whitespace-nowrap">
            {children}
        </div>
    );
};

const IconBox = ({ children, variant = "accent" }: { children: React.ReactNode; variant?: "accent" | "secondary" }) => {
    const colorClasses =
        variant === "secondary"
            ? "text-secondary bg-surface-soft border-border [&_svg]:fill-secondary [&_svg_#arrow1]:fill-primary [&_svg_#arrow2]:fill-primary"
            : "text-accent-400 bg-accent-400/10 border-accent-400/20 [&_svg]:fill-accent-400 [&_svg_#arrow1]:fill-accent-400 [&_svg_#arrow2]:fill-accent-400";

    return (
        <div
            className={cn(
                "text-[20px] min-w-[32px] h-[32px] flex items-center justify-center rounded-md border [&_svg]:h-[16px]",
                colorClasses
            )}
        >
            {children}
        </div>
    );
};

const KeyBinding = ({ keyDecl }: { keyDecl: string }) => {
    const { t } = useTranslation("element");
    const chordParts = keyDecl.split("+");
    const chordElems: React.ReactNode[] = [];

    for (let chordIdx = 0; chordIdx < chordParts.length; chordIdx++) {
        const parts = chordParts[chordIdx].trim().split(":");
        const elems: React.ReactNode[] = [];

        for (let part of parts) {
            if (part === "Cmd") {
                if (PLATFORM === PlatformMacOS) {
                    elems.push(<KeyCap key={`${chordIdx}-cmd`}>⌘ Cmd</KeyCap>);
                } else {
                    elems.push(<KeyCap key={`${chordIdx}-alt`}>Alt</KeyCap>);
                }
                continue;
            }
            if (part == "Ctrl") {
                elems.push(<KeyCap key={`${chordIdx}-ctrl`}>^ Ctrl</KeyCap>);
                continue;
            }
            if (part == "Shift") {
                elems.push(<KeyCap key={`${chordIdx}-shift`}>⇧ Shift</KeyCap>);
                continue;
            }
            if (part == "Arrows") {
                elems.push(<KeyCap key={`${chordIdx}-arrows1`}>←</KeyCap>);
                elems.push(<KeyCap key={`${chordIdx}-arrows2`}>→</KeyCap>);
                elems.push(<KeyCap key={`${chordIdx}-arrows3`}>↑</KeyCap>);
                elems.push(<KeyCap key={`${chordIdx}-arrows4`}>↓</KeyCap>);
                continue;
            }
            if (part == "Digit") {
                elems.push(<KeyCap key={`${chordIdx}-digit`}>{t("element:quicktips.digitKey")}</KeyCap>);
                continue;
            }
            if (part == "[" || part == "]") {
                elems.push(<KeyCap key={`${chordIdx}-${part}`}>{part}</KeyCap>);
                continue;
            }
            elems.push(<KeyCap key={`${chordIdx}-${part}`}>{part.toUpperCase()}</KeyCap>);
        }

        chordElems.push(
            <div key={`chord-${chordIdx}`} className="flex flex-row items-center gap-1">
                {elems}
            </div>
        );

        if (chordIdx < chordParts.length - 1) {
            chordElems.push(
                <span key={`plus-${chordIdx}`} className="text-secondary mx-1">
                    +
                </span>
            );
        }
    }

    return <div className="flex flex-row items-center">{chordElems}</div>;
};

const QuickTips = () => {
    const { t } = useTranslation("element");
    return (
        <div className="flex flex-col w-full gap-6 @container">
            <div className="flex flex-col gap-4 p-5 bg-gradient-to-br from-highlightbg/30 to-transparent hover:from-accent-400/5 rounded-lg border border-border hover:border-accent-400/20 transition-all duration-300">
                <div className="flex items-center gap-2 text-xl font-bold">
                    <div className="w-1 h-6 bg-accent-400 rounded-full"></div>
                    <span className="text-foreground">{t("element:quicktips.headerIcons")}</span>
                </div>
                <div className="grid grid-cols-1 @lg:grid-cols-2 gap-3">
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <MagnifyIcon enabled={false} />
                        </IconBox>
                        <div className="flex flex-col gap-0.5 flex-1">
                            <span className="text-[15px]">{t("element:quicktips.magnifyBlock")}</span>
                            <KeyBinding keyDecl="Cmd:m" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-laptop fa-fw" />
                        </IconBox>
                        <div className="flex flex-col gap-0.5 flex-1">
                            <span className="text-[15px]">{t("element:quicktips.connectRemote")}</span>
                            <KeyBinding keyDecl="Cmd:g" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-comments fa-fw" />
                        </IconBox>
                        <div className="flex flex-col gap-0.5 flex-1">
                            <span className="text-[15px]">{t("element:quicktips.browseSessions")}</span>
                            <span className="text-xs text-secondary">{t("element:quicktips.browseSessionsHint")}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-cog fa-fw" />
                        </IconBox>
                        <span className="text-[15px]">{t("element:quicktips.blockSettings")}</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-xmark-large fa-fw" />
                        </IconBox>
                        <div className="flex flex-col gap-0.5 flex-1">
                            <span className="text-[15px]">{t("element:quicktips.closeBlock")}</span>
                            <KeyBinding keyDecl="Cmd:w" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 p-5 bg-gradient-to-br from-highlightbg/30 to-transparent hover:from-accent-400/5 rounded-lg border border-border hover:border-accent-400/20 transition-all duration-300">
                <div className="flex items-center gap-2 text-xl font-bold">
                    <div className="w-1 h-6 bg-accent-400 rounded-full"></div>
                    <span className="text-foreground">{t("element:quicktips.importantKeybindings")}</span>
                </div>

                <div className="grid grid-cols-1 @lg:grid-cols-2 gap-x-5 gap-y-6">
                    <div className="flex flex-col gap-1.5">
                        <div className="text-sm text-accent-400 font-semibold uppercase tracking-wide mb-1">
                            {t("element:quicktips.mainKeybindings")}
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.newTab")}</span>
                            <KeyBinding keyDecl="Cmd:t" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.newTerminalBlock")}</span>
                            <KeyBinding keyDecl="Cmd:n" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.openWaveAiPanel")}</span>
                            <KeyBinding keyDecl="Cmd:Shift:a" />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="text-sm text-accent-400 font-semibold uppercase tracking-wide mb-1">
                            {i18n.t("element:quicktips.tabSwitching", {
                                modifier: PLATFORM === PlatformMacOS ? "Cmd" : "Alt",
                            })}
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.switchToNthTab")}</span>
                            <KeyBinding keyDecl="Cmd:Digit" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.previousTab")}</span>
                            <KeyBinding keyDecl="Cmd:[" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.nextTab")}</span>
                            <KeyBinding keyDecl="Cmd:]" />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="text-sm text-accent-400 font-semibold uppercase tracking-wide mb-1">
                            {t("element:quicktips.blockNavigation")}
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.navigateBetweenBlocks")}</span>
                            <KeyBinding keyDecl="Ctrl:Shift:Arrows" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.focusNthBlock")}</span>
                            <KeyBinding keyDecl="Ctrl:Shift:Digit" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.focusWaveAi")}</span>
                            <KeyBinding keyDecl="Ctrl:Shift:0" />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="text-sm text-accent-400 font-semibold uppercase tracking-wide mb-1">
                            {t("element:quicktips.splitBlocks")}
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.splitRight")}</span>
                            <KeyBinding keyDecl="Cmd:d" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.splitBelow")}</span>
                            <KeyBinding keyDecl="Cmd:Shift:d" />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 rounded-md hover:bg-hover transition-colors">
                            <span className="text-[15px]">{t("element:quicktips.splitInDirection")}</span>
                            <KeyBinding keyDecl="Ctrl:Shift:s + Arrows" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 p-5 bg-gradient-to-br from-highlightbg/30 to-transparent hover:from-accent-400/5 rounded-lg border border-border hover:border-accent-400/20 transition-all duration-300">
                <div className="flex items-center gap-2 text-xl font-bold">
                    <div className="w-1 h-6 bg-accent-400 rounded-full"></div>
                    <span className="text-foreground">wsh commands</span>
                </div>
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2 p-4 bg-surface rounded-lg border border-accent-400/30 hover:border-accent-400/50 transition-colors">
                        <code className="font-mono text-sm">
                            <span className="text-secondary">&gt; </span>
                            <span className="text-accent-400 font-semibold">wsh view</span>
                            <span className="text-muted"> [filename|url]</span>
                        </code>
                        <div className="text-secondary text-sm mt-1">{t("element:quicktips.previewHint")}</div>
                    </div>
                    <div className="flex flex-col gap-2 p-4 bg-surface rounded-lg border border-accent-400/30 hover:border-accent-400/50 transition-colors">
                        <code className="font-mono text-sm">
                            <span className="text-secondary">&gt; </span>
                            <span className="text-accent-400 font-semibold">wsh edit</span>
                            <span className="text-muted"> [filename]</span>
                        </code>
                        <div className="text-secondary text-sm mt-1">{t("element:quicktips.editHint")}</div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 p-5 bg-gradient-to-br from-highlightbg/30 to-transparent hover:from-accent-400/5 rounded-lg border border-border hover:border-accent-400/20 transition-all duration-300">
                <div className="flex items-center gap-2 text-xl font-bold">
                    <div className="w-1 h-6 bg-accent-400 rounded-full"></div>
                    <span className="text-foreground">{t("element:quicktips.moreTips")}</span>
                </div>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-computer-mouse fa-fw" />
                        </IconBox>
                        <span>
                            <b>{t("element:quicktips.tips.tabsTitle")}</b>
                            {" - "}
                            {t("element:quicktips.tips.tabsBody")}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-cog fa-fw" />
                        </IconBox>
                        <span>
                            <b>{t("element:quicktips.tips.webViewTitle")}</b>
                            {" - "}
                            {t("element:quicktips.tips.webViewBody")}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-hover transition-colors">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-cog fa-fw" />
                        </IconBox>
                        <span>
                            <b>{t("element:quicktips.tips.terminalTitle")}</b>
                            {" - "}
                            {t("element:quicktips.tips.terminalBody")}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 p-5 bg-gradient-to-br from-highlightbg/30 to-transparent hover:from-accent-400/5 rounded-lg border border-border hover:border-accent-400/20 transition-all duration-300">
                <div className="flex items-center gap-2 text-xl font-bold">
                    <div className="w-1 h-6 bg-accent-400 rounded-full"></div>
                    <span className="text-foreground">{t("element:quicktips.needHelp")}</span>
                </div>
                <div className="grid grid-cols-1 @sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-3 p-3 rounded-md bg-surface hover:bg-surface-strong transition-colors cursor-pointer">
                        <IconBox variant="secondary">
                            <i className="fa-brands fa-discord fa-fw" />
                        </IconBox>
                        <a
                            target="_blank"
                            href="https://discord.gg/XfvZ334gwU"
                            rel="noopener"
                            className="hover:text-accent-400 hover:underline transition-colors font-medium"
                        >
                            {t("element:quicktips.joinDiscord")}
                        </a>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-md bg-surface hover:bg-surface-strong transition-colors cursor-pointer">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-sliders fa-fw" />
                        </IconBox>
                        <a
                            target="_blank"
                            href="https://docs.waveterm.dev/config"
                            rel="noopener"
                            className="hover:text-accent-400 hover:underline transition-colors font-medium"
                        >
                            {t("element:quicktips.configurationOptions")}
                        </a>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-md bg-surface hover:bg-surface-strong transition-colors cursor-pointer">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-keyboard fa-fw" />
                        </IconBox>
                        <a
                            target="_blank"
                            href="https://docs.waveterm.dev/keybindings"
                            rel="noopener"
                            className="hover:text-accent-400 hover:underline transition-colors font-medium"
                        >
                            {t("element:quicktips.allKeybindings")}
                        </a>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-md bg-surface hover:bg-surface-strong transition-colors cursor-pointer">
                        <IconBox variant="secondary">
                            <i className="fa-solid fa-sharp fa-book fa-fw" />
                        </IconBox>
                        <a
                            target="_blank"
                            href="https://docs.waveterm.dev"
                            rel="noopener"
                            className="hover:text-accent-400 hover:underline transition-colors font-medium"
                        >
                            {t("element:quicktips.fullDocumentation")}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export { KeyBinding, QuickTips };
