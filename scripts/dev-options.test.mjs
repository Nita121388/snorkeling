import assert from "node:assert/strict";
import test from "node:test";
import { parseDevOptions } from "./dev-options.mjs";

test("parseDevOptions separates instance options from Task arguments", () => {
    assert.deepEqual(
        parseDevOptions(["--profile", "debug", "--vite-port=51742", "--cdp-port", "9223", "--", "--dry"]),
        {
            profile: "debug",
            vitePort: 51742,
            cdpPort: 9223,
            strictPort: false,
            sharedAiIndex: false,
            taskArgs: ["--dry"],
        }
    );
    assert.deepEqual(parseDevOptions(["--dry"], {}), {
        profile: "default",
        vitePort: 51741,
        cdpPort: null,
        strictPort: false,
        sharedAiIndex: false,
        taskArgs: ["--dry"],
    });
    assert.equal(parseDevOptions(["--strict-port"], {}).strictPort, true);
});

test("parseDevOptions: AI sessions index isolation flag", () => {
    // 默认隔离（dev 不写真库 ~/.snorkeling/ai-sessions）。
    assert.equal(parseDevOptions(["--profile", "cdp"], {}).sharedAiIndex, false);
    // --shared-ai-index 显式退回共享（dev 需要看已有批注/标签时用）。
    assert.equal(parseDevOptions(["--shared-ai-index"], {}).sharedAiIndex, true);
    assert.deepEqual(parseDevOptions(["--shared-ai-index", "--", "--dry"], {}).taskArgs, ["--dry"]);
    // env 口子（CI / 脚本链路）。
    assert.equal(parseDevOptions([], { SNORKELING_SHARED_AI_INDEX: "1" }).sharedAiIndex, true);
});

test("parseDevOptions rejects unsafe profiles and invalid ports", () => {
    assert.throws(() => parseDevOptions(["--profile", "../other"]), /profile must contain/);
    assert.throws(() => parseDevOptions(["--vite-port", "0"]), /Vite port must/);
    assert.throws(() => parseDevOptions(["--cdp-port"]), /--cdp-port requires/);
});
