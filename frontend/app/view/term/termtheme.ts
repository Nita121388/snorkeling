// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TermViewModel } from "@/app/view/term/term-model";
import { isLightResolvedTheme } from "@/app/theme-mode";
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
    const [theme, _] = computeTheme(fullConfig, blockTermTheme, transparency);
    useEffect(() => {
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = theme;
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
