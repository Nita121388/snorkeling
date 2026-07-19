import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskChecksum, readGoVersion, resolveArtifactSpecs, TaskVersion, ZigVersion } from "./bootstrap.mjs";

const Cases = [
    ["win32", "x64", "task_windows_amd64.zip", "go1.25.6.windows-amd64.zip", `zig-windows-x86_64-${ZigVersion}.zip`],
    ["win32", "arm64", "task_windows_arm64.zip", "go1.25.6.windows-arm64.zip", `zig-windows-aarch64-${ZigVersion}.zip`],
    [
        "darwin",
        "x64",
        "task_darwin_amd64.tar.gz",
        "go1.25.6.darwin-amd64.tar.gz",
        `zig-macos-x86_64-${ZigVersion}.tar.xz`,
    ],
    [
        "darwin",
        "arm64",
        "task_darwin_arm64.tar.gz",
        "go1.25.6.darwin-arm64.tar.gz",
        `zig-macos-aarch64-${ZigVersion}.tar.xz`,
    ],
    ["linux", "x64", "task_linux_amd64.tar.gz", "go1.25.6.linux-amd64.tar.gz", `zig-linux-x86_64-${ZigVersion}.tar.xz`],
    [
        "linux",
        "arm64",
        "task_linux_arm64.tar.gz",
        "go1.25.6.linux-arm64.tar.gz",
        `zig-linux-aarch64-${ZigVersion}.tar.xz`,
    ],
];

test("resolveArtifactSpecs covers supported platform and architecture combinations", () => {
    for (const [platform, arch, taskFile, goFile, zigFile] of Cases) {
        const [taskSpec, goSpec, zigSpec] = resolveArtifactSpecs(platform, arch, "1.25.6");
        assert.equal(taskSpec.fileName, taskFile);
        assert.equal(goSpec.fileName, goFile);
        assert.equal(zigSpec.fileName, zigFile);
        assert.equal(goSpec.executable, platform === "win32" ? "bin/go.exe" : "bin/go");
    }
    assert.throws(() => resolveArtifactSpecs("freebsd", "x64", "1.25.6"), /unsupported bootstrap platform/);
});

test("version and checksum parsing reject missing data", () => {
    assert.equal(readGoVersion("module example.test/demo\n\ngo 1.25.6\n"), "1.25.6");
    assert.throws(() => readGoVersion("module example.test/demo\n"), /cannot read/);

    const hash = "a".repeat(64);
    const fileName = "task_windows_amd64.zip";
    assert.equal(parseTaskChecksum(`${hash}  ${fileName}\n`, fileName), hash);
    assert.throws(() => parseTaskChecksum("invalid", fileName), /checksum not found/);
    assert.equal(TaskVersion, "3.42.1");
});
