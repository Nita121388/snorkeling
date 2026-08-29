// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultNoteDirectory, normalizeNoteDirectory, NoteDirectorySettingKey } from "@/app/modals/notedirectorymodal";
import { atoms, globalStore } from "@/app/store/global";
import { PreviewDirectoryDisplayMetaKey, PreviewExplorerRootMetaKey } from "@/app/view/preview/preview-navigation";
import { SnorkelingBlockKindMetaKey, SnorkelingBlockKindNote } from "@/app/workspace/toggle-block";

// Widget action id handled in widgets.tsx (handleWidgetSelect) so the notes
// directory is read from settings at click time instead of being frozen in a
// static blockdef.
export const NoteWidgetAction = "note";

export function getNoteDirectory(): string {
    const settings = globalStore.get(atoms.settingsAtom);
    return normalizeNoteDirectory(settings?.[NoteDirectorySettingKey] ?? DefaultNoteDirectory);
}

export function makeNoteBlockDef(dir: string): BlockDef {
    const normalizedDir = normalizeNoteDirectory(dir);
    const meta = {
        view: "preview",
        file: normalizedDir,
        [PreviewExplorerRootMetaKey]: normalizedDir,
        [PreviewDirectoryDisplayMetaKey]: "tree",
        [SnorkelingBlockKindMetaKey]: SnorkelingBlockKindNote,
        "frame:title": "Note",
        icon: "note-sticky",
    } as MetaType;
    return { meta };
}
