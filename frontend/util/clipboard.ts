// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export async function copyText(text: string): Promise<void> {
    if (!text) return;

    const api = (window as any)?.api as ElectronApi | undefined;
    if (api?.writeClipboardText != null) {
        await api.writeClipboardText(text);
        return;
    }

    if (navigator?.clipboard?.writeText != null) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}
