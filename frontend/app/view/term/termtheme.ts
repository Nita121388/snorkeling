// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isLightResolvedTheme } from "@/app/theme-mode";
import type { TermViewModel } from "@/app/view/term/term-model";
import { computeTheme } from "@/app/view/term/termutil";
import { TermWrap } from "@/app/view/term/termwrap";
import { atoms, getSettingsKeyAtom } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

interface TermThemeProps {
    termRef: React.RefObject<TermWrap>;
    model: TermViewModel;
}

const TermThemeUpdater = ({ model, termRef }: TermThemeProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const appTheme = useAtomValue(atoms.resolvedAppThemeAtom);
    const disableWebGl = useAtomValue(getSettingsKeyAtom("term:disablewebgl"));
    const blockTermTheme = useAtomValue(model.termThemeNameAtom);
    const transparency = useAtomValue(model.termTransparencyAtom);
    const [theme, bgcolor] = computeTheme(fullConfig, blockTermTheme, transparency);
    useEffect(() => {
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = theme;
            // 同步 OSC 10/11 查询应答色：真实主题前景/背景（bgcolor 为 computeTheme 剥离透明度前的真实背景色），
            // Codex 等 TUI 启动时查询终端背景色决定自身配色，必须回真实色而非透明黑。
            termRef.current.setOscReportColors(theme.foreground, bgcolor);
        }
    }, [theme]);
    useEffect(() => {
        if (!termRef.current) {
            return;
        }
        // ponytail: Light mode trades WebGL throughput for clearer glyph antialiasing on Windows displays.
        termRef.current.setTermRenderer(isLightResolvedTheme(appTheme) || disableWebGl ? "dom" : "webgl");
    }, [appTheme, disableWebGl]);
    return null;
};

export { TermThemeUpdater };
