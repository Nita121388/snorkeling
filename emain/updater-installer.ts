// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Swap a staged `*.app` bundle over the installed one and relaunch, from a
// detached shell script that outlives this process. Needed because an app
// cannot replace itself while it is running, and because ad-hoc-signed macOS
// builds cannot use the electron-updater swap (it requires a stable
// Developer ID).
//
// The script waits on this process's pid rather than a fixed sleep, replaces
// the target with `ditto` (preserves symlinks/xattrs that plain mv can lose
// across filesystems), rolls back on failure, clears the quarantine xattr
// the download set, and re-opens the app.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_BUNDLE_SUFFIX = ".app";

/** Parse `/Applications/Foo.app/Contents/MacOS/Foo` → `/Applications/Foo.app`, else null. */
export function installedAppBundle(execPath: string): string | null {
    // A dev run points inside node_modules and is deliberately excluded: a
    // swap-targeted script against it would replace the runtime pnpm dev
    // depends on.
    if (execPath.includes(`${path.sep}node_modules${path.sep}`)) {
        return null;
    }
    const marker = `${APP_BUNDLE_SUFFIX}/Contents/MacOS/`;
    const at = execPath.indexOf(marker);
    return at === -1 ? null : execPath.slice(0, at + APP_BUNDLE_SUFFIX.length);
}

/**
 * The shell that does the swap. `ditto` is what macOS itself uses for bundle
 * copies and preserves the extended attributes a `.app` relies on — `mv`
 * across filesystems can produce a bundle that won't launch. Anything the
 * script needs (paths, pid) is JSON-quoted inline.
 */
export function swapScript(options: { pid: number; staged: string; target: string; backup: string }): string {
    const { pid, staged, target, backup } = options;
    return `#!/bin/bash
set -e

# Wait for the old app to actually exit, not merely be told to.
for _ in $(seq 1 100); do
  kill -0 ${pid} 2>/dev/null || break
  sleep 0.1
done

rm -rf ${JSON.stringify(backup)}
mv ${JSON.stringify(target)} ${JSON.stringify(backup)}

if ditto ${JSON.stringify(staged)} ${JSON.stringify(target)}; then
  rm -rf ${JSON.stringify(backup)}
else
  # Roll the old copy back: an un-updated app beats no app.
  rm -rf ${JSON.stringify(target)}
  mv ${JSON.stringify(backup)} ${JSON.stringify(target)}
fi

# Clear the quarantine bit the download set, else first launch is a scary dialog.
xattr -dr com.apple.quarantine ${JSON.stringify(target)} 2>/dev/null || true
open ${JSON.stringify(target)}
`;
}

/**
 * Write the script and detach it. The parent exits immediately after; the
 * script is waiting on the parent's pid, so unref'd stdio is load-bearing.
 */
export async function scheduleSwap(options: { staged: string; target: string }): Promise<void> {
    const dir = await mkdtemp(path.join(tmpdir(), "snorkeling-updater-swap-"));
    const script = path.join(dir, "swap.sh");
    await writeFile(
        script,
        swapScript({
            pid: process.pid,
            staged: options.staged,
            target: options.target,
            backup: `${options.target}.old`,
        }),
        { mode: 0o755 }
    );

    const child = spawn("/bin/bash", [script], { detached: true, stdio: "ignore" });
    child.unref();
}
