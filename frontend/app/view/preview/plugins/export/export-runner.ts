// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    getMarkdownExportProvider,
    getMarkdownExportProviders,
    type MarkdownExportProvider,
    type ExportFormat,
    type ExportOptions,
    defaultExportOptions,
} from "./export-provider";
import { exportToPdf } from "./pdf-export";
import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";

export type { ExportResult };

/**
 * High-level export entry point used by toolbar / command-palette. Resolves the provider by id,
 * renders HTML, then dispatches to the right sink (file dialog for html, print-to-pdf for pdf).
 * Returns a structured result so the UI can surface success / cancel / error feedback.
 */
export async function runMarkdownExport(
    providerId: string,
    format: ExportFormat,
    source: string,
    context: PreviewMatchContext,
    options: ExportOptions = defaultExportOptions,
    fileName = "export"
): Promise<ExportResult> {
    const provider = getMarkdownExportProvider(providerId);
    if (provider == null) {
        const message = `export provider '${providerId}' not registered`;
        console.error("[export]", message);
        return { ok: false, canceled: false, filePath: null, error: message };
    }
    let html: string;
    try {
        html = await provider.toHtml(source, options, context);
    } catch (err) {
        console.error("[export] render failed", err);
        return { ok: false, canceled: false, filePath: null, error: String(err) };
    }
    const api = typeof window !== "undefined" ? (window as any).api : undefined;
    if (format === "pdf") {
        return (await exportToPdf(fileName, html)) ?? {
            ok: false,
            canceled: true,
            filePath: null,
            error: null,
        };
    }
    if (format === "html" && api?.exportHtml != null) {
        return api.exportHtml(fileName, html);
    }
    if (provider.serialize != null) {
        const serialized = await provider.serialize(source, format, options, context, html);
        return saveUint8Array(fileName + "." + serialized.extension, serialized.data, serialized.mimeType);
    }
    return (await api?.exportHtml?.(fileName, html)) ?? { ok: false, canceled: true, filePath: null, error: null };
}

async function saveUint8Array(fileName: string, data: Uint8Array, _mime: string): Promise<ExportResult> {
    // Fallback generic save for non-html serializers; the built-in providers don't hit this path yet.
    const html = new TextDecoder().decode(data);
    const api = typeof window !== "undefined" ? (window as any).api : undefined;
    return (await api?.exportHtml?.(fileName, html)) ?? { ok: false, canceled: true, filePath: null, error: null };
}

/** Resolve every provider that can handle this file, for building the toolbar menu. */
export function availableExportProviders(context: PreviewMatchContext): MarkdownExportProvider[] {
    return getMarkdownExportProviders(context);
}

export { defaultExportOptions } from "./export-provider";
export type { MarkdownExportProvider, ExportFormat, ExportOptions } from "./export-provider";