import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnv } from "./resolve-env.mjs";

export const TaskVersion = "3.42.1";
export const ZigVersion = "0.13.0";

const PlatformNames = {
    win32: { task: "windows", go: "windows", zig: "windows", taskExt: "zip", goExt: "zip", zigExt: "zip" },
    darwin: { task: "darwin", go: "darwin", zig: "macos", taskExt: "tar.gz", goExt: "tar.gz", zigExt: "tar.xz" },
    linux: { task: "linux", go: "linux", zig: "linux", taskExt: "tar.gz", goExt: "tar.gz", zigExt: "tar.xz" },
};

const ArchitectureNames = {
    x64: { task: "amd64", go: "amd64", zig: "x86_64" },
    arm64: { task: "arm64", go: "arm64", zig: "aarch64" },
};

export function readGoVersion(goMod) {
    const version = goMod.match(/^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/m)?.[1];
    if (!version) {
        throw new Error("cannot read the Go version from go.mod");
    }
    return version;
}

export function resolveArtifactSpecs(platform, arch, goVersion) {
    const osNames = PlatformNames[platform];
    const archNames = ArchitectureNames[arch];
    if (!osNames || !archNames) {
        throw new Error(`unsupported bootstrap platform: ${platform}/${arch}`);
    }

    const taskFileName = `task_${osNames.task}_${archNames.task}.${osNames.taskExt}`;
    const goFileName = `go${goVersion}.${osNames.go}-${archNames.go}.${osNames.goExt}`;
    const zigFileName = `zig-${osNames.zig}-${archNames.zig}-${ZigVersion}.${osNames.zigExt}`;
    return [
        {
            name: "task",
            version: TaskVersion,
            fileName: taskFileName,
            url: `https://github.com/go-task/task/releases/download/v${TaskVersion}/${taskFileName}`,
            checksumUrl: `https://github.com/go-task/task/releases/download/v${TaskVersion}/task_checksums.txt`,
            sourceDir: ".",
            executable: platform === "win32" ? "task.exe" : "task",
            versionArgs: ["--version"],
            versionNeedle: `v${TaskVersion}`,
        },
        {
            name: "go",
            version: goVersion,
            fileName: goFileName,
            metadataUrl: "https://go.dev/dl/?mode=json&include=all",
            sourceDir: "go",
            executable: platform === "win32" ? "bin/go.exe" : "bin/go",
            versionArgs: ["version"],
            versionNeedle: `go${goVersion}`,
            goOs: osNames.go,
            goArch: archNames.go,
        },
        {
            name: "zig",
            version: ZigVersion,
            fileName: zigFileName,
            metadataUrl: "https://ziglang.org/download/index.json",
            sourceDir: zigFileName.replace(/\.(?:zip|tar\.xz)$/, ""),
            executable: platform === "win32" ? "zig.exe" : "zig",
            versionArgs: ["version"],
            versionNeedle: ZigVersion,
            zigTarget: `${archNames.zig}-${osNames.zig}`,
        },
    ];
}

export function parseTaskChecksum(checksums, fileName) {
    for (const line of checksums.split(/\r?\n/)) {
        const [sha256, listedFile] = line.trim().split(/\s+/);
        if (listedFile === fileName && /^[a-f\d]{64}$/i.test(sha256)) {
            return sha256.toLowerCase();
        }
    }
    throw new Error(`checksum not found for ${fileName}`);
}

async function fetchChecked(url) {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
    if (!response.ok) {
        throw new Error(`download failed (${response.status}): ${url}`);
    }
    return response;
}

async function resolveRemoteArtifact(spec) {
    if (spec.name === "task") {
        const checksums = await (await fetchChecked(spec.checksumUrl)).text();
        return { url: spec.url, sha256: parseTaskChecksum(checksums, spec.fileName) };
    }
    if (spec.name === "go") {
        const releases = await (await fetchChecked(spec.metadataUrl)).json();
        const release = releases.find((item) => item.version === `go${spec.version}`);
        const file = release?.files?.find(
            (item) =>
                item.filename === spec.fileName &&
                item.os === spec.goOs &&
                item.arch === spec.goArch &&
                item.kind === "archive"
        );
        if (!file?.sha256) {
            throw new Error(`official Go metadata does not contain ${spec.fileName}`);
        }
        return { url: `https://go.dev/dl/${file.filename}`, sha256: file.sha256.toLowerCase() };
    }

    const index = await (await fetchChecked(spec.metadataUrl)).json();
    const file = index[spec.version]?.[spec.zigTarget];
    if (!file?.tarball || !file?.shasum || basename(new URL(file.tarball).pathname) !== spec.fileName) {
        throw new Error(`official Zig metadata does not contain ${spec.fileName}`);
    }
    return { url: file.tarball, sha256: file.shasum.toLowerCase() };
}

async function downloadArchive(url, destination, expectedSha256) {
    // ponytail: official tool archives are buffered in memory; switch to streaming if they grow beyond a few hundred MB.
    const bytes = Buffer.from(await (await fetchChecked(url)).arrayBuffer());
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256) {
        throw new Error(
            `checksum mismatch for ${basename(destination)}: expected ${expectedSha256}, got ${actualSha256}`
        );
    }
    writeFileSync(destination, bytes, { flag: "wx" });
}

function runVersion(executable, args) {
    const result = spawnSync(executable, args, { encoding: "utf8", shell: false, windowsHide: true });
    if (result.status !== 0) {
        return null;
    }
    return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function hasExpectedVersion(installDir, spec) {
    const executable = resolve(installDir, spec.executable);
    const output = existsSync(executable) ? runVersion(executable, spec.versionArgs) : null;
    return output?.includes(spec.versionNeedle) ?? false;
}

function assertInside(root, target) {
    const child = relative(root, target);
    if (!child || child.startsWith("..") || isAbsolute(child)) {
        throw new Error(`refusing to modify path outside ${root}: ${target}`);
    }
}

function replaceInstall(toolsRoot, sourceDir, targetDir, validate) {
    assertInside(toolsRoot, targetDir);
    const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`;
    if (existsSync(targetDir)) {
        assertInside(toolsRoot, backupDir);
        renameSync(targetDir, backupDir);
    }
    try {
        renameSync(sourceDir, targetDir);
        if (!validate(targetDir)) {
            throw new Error(`installed tool validation failed: ${targetDir}`);
        }
    } catch (error) {
        if (existsSync(targetDir)) {
            rmSync(targetDir, { recursive: true, force: true });
        }
        if (existsSync(backupDir)) {
            renameSync(backupDir, targetDir);
        }
        throw error;
    }
    if (existsSync(backupDir)) {
        rmSync(backupDir, { recursive: true, force: true });
    }
}

async function installTool(toolsRoot, spec, quiet) {
    const targetDir = resolve(toolsRoot, spec.name);
    if (hasExpectedVersion(targetDir, spec)) {
        if (!quiet) {
            console.log(`[${spec.name}] ${spec.version} already installed`);
        }
        return;
    }

    const workRoot = mkdtempSync(resolve(toolsRoot, `.bootstrap-${spec.name}-`));
    try {
        const archivePath = resolve(workRoot, spec.fileName);
        const extractRoot = resolve(workRoot, "extract");
        mkdirSync(extractRoot);
        if (!quiet) {
            console.log(`[${spec.name}] resolving checksum and downloading ${spec.fileName}`);
        }
        const remote = await resolveRemoteArtifact(spec);
        await downloadArchive(remote.url, archivePath, remote.sha256);

        const extractResult = spawnSync("tar", ["-xf", archivePath, "-C", extractRoot], {
            encoding: "utf8",
            shell: false,
            windowsHide: true,
        });
        if (extractResult.status !== 0) {
            throw new Error(`cannot extract ${spec.fileName}: ${extractResult.stderr || extractResult.error?.message}`);
        }

        const sourceDir = resolve(extractRoot, spec.sourceDir);
        if (!hasExpectedVersion(sourceDir, spec)) {
            const entries = existsSync(extractRoot) ? readdirSync(extractRoot).join(", ") : "missing extract directory";
            throw new Error(`${spec.name} version validation failed after extraction (${entries})`);
        }
        replaceInstall(toolsRoot, sourceDir, targetDir, (installDir) => hasExpectedVersion(installDir, spec));
        if (!quiet) {
            console.log(`[${spec.name}] installed ${spec.version}`);
        }
    } finally {
        assertInside(toolsRoot, workRoot);
        rmSync(workRoot, { recursive: true, force: true });
    }
}

export async function bootstrap(repoRoot, options = {}) {
    const quiet = options.quiet ?? false;
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const toolsRoot = resolve(repoRoot, ".tools");
    mkdirSync(toolsRoot, { recursive: true });
    resolveEnv(repoRoot);

    const tarCheck = spawnSync("tar", ["--version"], { encoding: "utf8", shell: false, windowsHide: true });
    if (tarCheck.status !== 0) {
        throw new Error("bootstrap requires the platform tar command to extract tool archives");
    }

    const goVersion = readGoVersion(readFileSync(resolve(repoRoot, "go.mod"), "utf8"));
    const specs = resolveArtifactSpecs(platform, arch, goVersion);
    for (const spec of specs) {
        await installTool(toolsRoot, spec, quiet);
    }

    if (!quiet) {
        console.log("Toolchain ready:");
        for (const spec of specs) {
            console.log(
                `  ${spec.name}: ${runVersion(resolve(toolsRoot, spec.name, spec.executable), spec.versionArgs)}`
            );
        }
    }
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    bootstrap(repoRoot, { quiet: process.argv.includes("--quiet") }).catch((error) => {
        console.error(`bootstrap failed: ${error.message}`);
        process.exit(1);
    });
}
