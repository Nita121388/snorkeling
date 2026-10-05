// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";

export interface WaveBlockProps {
    blockkey: string;
    blockmap: Map<string, MarkdownContentBlockType>;
    /** Optional: delegate rendering by block type (e.g. Obsidian properties card). */
    renderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
}

export function WaveBlock(props: WaveBlockProps) {
    const { blockkey, blockmap, renderers } = props;
    const block = blockmap.get(blockkey);
    if (block == null) {
        return null;
    }
    const renderer = renderers?.[block.type];
    if (renderer) {
        return <>{renderer(block)}</>;
    }
    const sizeInKB = Math.round((block.content.length / 1024) * 10) / 10;
    const displayName = block.id.replace(/^"|"$/g, "");
    return (
        <div className="waveblock">
            <div className="wave-block-content">
                <div className="wave-block-icon">
                    <i className="fas fa-file-code"></i>
                </div>
                <div className="wave-block-info">
                    <span className="wave-block-filename">{displayName}</span>
                    <span className="wave-block-size">{sizeInKB} KB</span>
                </div>
            </div>
        </div>
    );
}