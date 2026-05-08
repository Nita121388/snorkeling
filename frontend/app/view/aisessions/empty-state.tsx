// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-secondary">
            {text}
        </div>
    );
}
