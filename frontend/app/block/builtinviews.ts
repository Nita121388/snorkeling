// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SessionOverviewViewModel } from "@/app/session-overview/session-overview";
import { AiFileDiffViewModel } from "@/app/view/aifilediff/aifilediff";
import { AiSessionsViewModel } from "@/app/view/aisessions/aisessions";
import { HelpViewModel } from "@/app/view/helpview/helpview";
import { LauncherViewModel } from "@/app/view/launcher/launcher";
import { PreviewModel } from "@/app/view/preview/preview-model";
import { ProcessViewerViewModel } from "@/app/view/processviewer/processviewer";
import { QuickTipsViewModel } from "@/app/view/quicktipsview/quicktipsview";
import { SysinfoViewModel } from "@/app/view/sysinfo/sysinfo";
import { TermViewModel } from "@/app/view/term/term-model";
import { TsunamiViewModel } from "@/app/view/tsunami/tsunami";
import { VcsViewModel } from "@/app/view/vcs/vcs";
import { VcsCommitsViewModel } from "@/app/view/vcscommits/vcscommits";
import { VcsDiffViewModel } from "@/app/view/vcsdiff/vcsdiff";
import { VcsHistoryViewModel } from "@/app/view/vcshistory/vcshistory";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { WaveAiModel } from "@/app/view/waveai/waveai";
import { WebViewModel } from "@/app/view/webview/webview";
import { registerViewModel } from "./blockregistry";

const BuiltinViewModels: ReadonlyArray<readonly [string, ViewModelClass]> = [
    ["term", TermViewModel],
    ["preview", PreviewModel],
    ["web", WebViewModel],
    ["waveai", WaveAiModel],
    ["cpuplot", SysinfoViewModel],
    ["sysinfo", SysinfoViewModel],
    ["vdom", VDomModel],
    ["tips", QuickTipsViewModel],
    ["help", HelpViewModel],
    ["launcher", LauncherViewModel],
    ["tsunami", TsunamiViewModel],
    ["aifilediff", AiFileDiffViewModel],
    ["waveconfig", WaveConfigViewModel],
    ["processviewer", ProcessViewerViewModel],
    ["aisessions", AiSessionsViewModel],
    ["sessionoverview", SessionOverviewViewModel],
    ["vcs", VcsViewModel],
    ["vcscommits", VcsCommitsViewModel],
    ["vcsdiff", VcsDiffViewModel],
    ["vcshistory", VcsHistoryViewModel],
];

function registerBuiltinViews(): void {
    for (const [viewType, ctor] of BuiltinViewModels) {
        registerViewModel(viewType, ctor);
    }
}

export { registerBuiltinViews };
