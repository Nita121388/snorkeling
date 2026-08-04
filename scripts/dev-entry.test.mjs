import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

test("the public dev entry is singular and Task does not recurse", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const taskfile = parse(readFileSync(new URL("../Taskfile.yml", import.meta.url), "utf8"));
    const tasks = taskfile.tasks;

    assert.equal(packageJson.scripts.dev, "node scripts/dev-isolated.mjs");
    assert.equal(packageJson.scripts["dev:iso"], undefined);
    assert.equal(packageJson.scripts["dev:local"], undefined);
    assert.equal(packageJson.scripts["dev:electron"], "electron-vite dev");
    assert.equal(
        packageJson.scripts["dev:cdp"],
        "node scripts/dev-isolated.mjs --profile cdp --vite-port 51742 --cdp-port 9222"
    );
    assert.equal(packageJson.scripts["dev:cdp:win"], "node scripts/run-task.mjs electron:cdp:winquick");
    assert.equal(tasks.dev, undefined);
    assert.equal(existsSync(new URL("./dev-isolated.sh", import.meta.url)), false);
    assert.equal(tasks["electron:dev"].cmd, "npm run dev:electron");
    assert.equal(tasks["electron:quickdev"].cmd, "npm run dev:electron");
    assert.equal(tasks["electron:winquickdev"].cmd, "npm run dev:electron");
    assert.equal(tasks["electron:cdp:winquick"].env.SNORKELING_DEV_TASK, "electron:winquickdev");
    assert.equal(tasks["electron:cdp:winquick"].deps, undefined);
    assert.equal(readFileSync(new URL("./dev-isolated.mjs", import.meta.url), "utf8").includes("writeFileSync"), false);
    assert.equal(
        readFileSync(new URL("./dev-isolated.mjs", import.meta.url), "utf8").includes(
            'process.env.SNORKELING_DEV_TASK || "electron:dev"'
        ),
        true
    );
    assert.equal(
        readFileSync(new URL("../electron.vite.config.ts", import.meta.url), "utf8").includes("strictPort: true"),
        true
    );
});

test("wsh build excludes unsupported MIPS targets", () => {
    const taskfile = parse(readFileSync(new URL("../Taskfile.yml", import.meta.url), "utf8"));
    const targets = taskfile.tasks["build:wsh:parallel"].deps.map(({ vars }) => `${vars.GOOS}/${vars.GOARCH}`);

    assert.deepEqual(targets, [
        "darwin/arm64",
        "darwin/amd64",
        "linux/arm64",
        "linux/amd64",
        "windows/amd64",
        "windows/arm64",
    ]);
});
