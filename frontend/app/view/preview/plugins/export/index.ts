// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";
import { registerMarkdownExportProvider, type MarkdownExportProvider, type ExportOptions } from "./export-provider";
import { markdownToHtml, serializeHtml } from "./html-export";
import { isMarkdownFile, registerPdfExporter } from "./pdf-export";

/**
 * Built-in HTML exporter. Renders markdown through the shared remark pipeline into a standalone
 * self-contained HTML document, then serializes it for the file-dialog sink.
 */
export const markdownToHtmlProvider: MarkdownExportProvider = {
    id: "snorkeling-markdown-to-html",
    displayName: "Export to HTML",
    formats: ["html"],
    match: isMarkdownFile,
    async toHtml(source: string, options: ExportOptions, context: PreviewMatchContext): Promise<string> {
        return markdownToHtml(source, options, context);
    },
    async serialize(source: string, format, options, context, html) {
        void source;
        void format;
        void options;
        void context;
        return serializeHtml(html);
    },
};

/**
 * Register every built-in markdown export provider (HTML + PDF). Idempotent: the registry replaces
 * same-id entries, so HMR / re-registration is safe. Returns an unsubscribe that deregisters all.
 */
export function registerExportPlugin(): () => void {
    const unsubscribers = [
        registerMarkdownExportProvider(markdownToHtmlProvider),
        registerPdfExporter(),
    ];
    return () => unsubscribers.forEach((unsub) => unsub());
}

export { isMarkdownFile } from "./pdf-export";
export type { MarkdownExportProvider, ExportOptions } from "./export-provider";
export { markdownToHtml, wrapDocument, buildTocHtml } from "./html-export";