// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pick the one file in a GitHub release this machine can actually install.
//
// A release typically carries several per-arch, per-format artefacts (e.g.
// `Snorkeling-0.14.6-arm64.dmg`, `...-x64.exe`, `...-amd64.AppImage`, ...).
// Matching by extension alone will ship the wrong CPU to every machine whose
// arch tag happens to sort first alphabetically — historically the classic
// way this goes wrong is `arm64` before `x64`, which hands the ARM build to
// every Intel machine.
//
// Arch tags differ across packaging conventions: electron-builder stamps
// `x64`/`arm64`, AppImage convention uses `x86_64`/`aarch64`, Debian uses
// `amd64`/`arm64`. All of those names can appear in the same release, so a
// single canonical check would miss most.

export interface UpdaterAsset {
    name?: string;
    browser_download_url?: string;
    size?: number;
}

export interface PickedAsset {
    name: string;
    url: string;
    size: number;
}

const ARCH_TAGS: Record<string, string[]> = {
    arm64: ["arm64", "aarch64"],
    x64: ["x64", "x86_64", "amd64"],
};

/**
 * The one artefact this machine can install, or `null`.
 *
 * Asset choice is a three-step narrowing:
 *   1. by extension (what the platform can ship as)
 *   2. by explicit arch tag matching this machine
 *   3. else by "no arch tag at all" (treat as universal)
 *
 * A file claiming a *different* arch is rejected rather than used as a
 * fallback — an x64 installer on an arm64 machine is worse than no match.
 */
export function pickAsset(
    assets: UpdaterAsset[],
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch
): PickedAsset | null {
    const usable = assets.filter((a): a is Required<UpdaterAsset> =>
        Boolean(a?.name && a?.browser_download_url && typeof a?.size === "number")
    );

    const mine = ARCH_TAGS[arch] ?? [];
    const others = Object.entries(ARCH_TAGS)
        .filter(([name]) => name !== arch)
        .flatMap(([, tags]) => tags);

    const forThisMachine = (name: string) => mine.some((tag) => name.includes(tag));
    // Universal means "names no architecture at all" — explicitly not "does not
    // name my arch", which would let x86_64 look universal on an arm64 host.
    const universal = (name: string) =>
        !mine.some((tag) => name.includes(tag)) && !others.some((tag) => name.includes(tag));

    const extensions =
        platform === "darwin"
            ? // .dmg is deliberately after .zip: a zip ships the bundle itself which
              // is what the in-place swap consumes; a dmg is a mounted disk the user
              // would have to drag across manually.
              [".zip", ".dmg"]
            : platform === "win32"
              ? [".exe", ".msi"]
              : [".appimage", ".deb", ".rpm"];

    for (const extension of extensions) {
        const candidates = usable.filter((a) => a.name.toLowerCase().endsWith(extension));
        const match = candidates.find((a) => forThisMachine(a.name.toLowerCase())) ?? candidates.find((a) => universal(a.name.toLowerCase()));
        if (match) return { name: match.name, url: match.browser_download_url, size: match.size };
    }
    return null;
}
