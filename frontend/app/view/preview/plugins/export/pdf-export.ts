// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";
import { registerMarkdownExportProvider, type MarkdownExportProvider, type ExportOptions } from "./export-provider";
import { markdownToHtml } from "./html-export";

/**
 * The built-in PDF exporter. Reuses the HTML renderer then hands the resulting standalone HTML to
 * the Electron main process (`export-pdf` IPC) which renders it off-screen and prints to PDF via
 * `webContents.printToPDF`. No browser window or user-facing print dialog is opened.
 */
export const markdownToPdfProvider: MarkdownExportProvider = {
    id: "snorkeling-markdown-to-pdf",
    displayName: "Export to PDF",
    formats: ["pdf"],
    match: isMarkdownFile,
    async toHtml(source: string, options: ExportOptions, context: PreviewMatchContext): Promise<string> {
        return markdownToHtml(source, options, context);
    },
};

/**
 * Run the built-in PDF export: render HTML, then ask the main process to save/print it as a PDF.
 * Returns a structured result so the UI can surface success / cancel / error feedback.
 */
export async function exportToPdf(fileName: string, html: string): Promise<ExportResult> {
    const api = typeof window !== "undefined" ? (window as any).api : undefined;
    if (api?.exportPdf == null) {
        const message = "export-pdf IPC unavailable";
        console.error("[export]", message);
        return { ok: false, canceled: false, filePath: null, error: message };
    }
    return api.exportPdf(fileName, html, { pageSize: "A4", margins: { marginType: "default" } });
}

export function registerPdfExporter(): () => void {
    return registerMarkdownExportProvider(markdownToPdfProvider);
}

export function isMarkdownFile(context: PreviewMatchContext): boolean {
    const name = context.fileName ?? "";
    return /\.mdx?$/i.test(name) || /text\/markdown|x-markdown|x-markdown-jekyll/i.test(context.mimeType ?? "");
}

export type { ExportOptions };