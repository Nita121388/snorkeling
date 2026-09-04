// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";

export type ExportFormat = "html" | "pdf";

export type ExportOptions = {
    fileName: string;
    includeFrontmatter: boolean;
    includeToc: boolean;
    inlineImages: boolean;
    darkTheme: boolean;
    bodyOnly: boolean;
};

export const defaultExportOptions: ExportOptions = {
    fileName: "",
    includeFrontmatter: true,
    includeToc: false,
    inlineImages: false,
    darkTheme: false,
    bodyOnly: false,
};

export type SerializedExport = {
    data: Uint8Array;
    extension: string;
    mimeType: string;
};

export type MarkdownExportProvider = {
    id: string;
    displayName: string;
    formats: readonly ExportFormat[];
    match: (context: PreviewMatchContext) => boolean;
    toHtml: (source: string, options: ExportOptions, context: PreviewMatchContext) => Promise<string>;
    serialize?: (
        source: string,
        format: ExportFormat,
        options: ExportOptions,
        context: PreviewMatchContext,
        html: string
    ) => Promise<SerializedExport>;
};

const providers: MarkdownExportProvider[] = [];

export function registerMarkdownExportProvider(provider: MarkdownExportProvider): () => void {
    const index = providers.findIndex((item) => item.id === provider.id);
    if (index >= 0) providers.splice(index, 1);
    providers.push(provider);
    return () => unregisterMarkdownExportProvider(provider.id);
}

export function unregisterMarkdownExportProvider(id: string): void {
    const index = providers.findIndex((provider) => provider.id === id);
    if (index >= 0) providers.splice(index, 1);
}

export function getAllMarkdownExportProviders(): MarkdownExportProvider[] {
    return [...providers];
}

export function getMarkdownExportProviders(context: PreviewMatchContext): MarkdownExportProvider[] {
    return providers.filter((provider) => provider.match(context));
}

export function getMarkdownExportProvider(id: string): MarkdownExportProvider | null {
    return providers.find((provider) => provider.id === id) ?? null;
}
