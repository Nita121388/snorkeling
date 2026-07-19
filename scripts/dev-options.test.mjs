import assert from "node:assert/strict";
import test from "node:test";
import { parseDevOptions } from "./dev-options.mjs";

test("parseDevOptions separates instance options from Task arguments", () => {
    assert.deepEqual(
        parseDevOptions(["--profile", "debug", "--vite-port=51742", "--cdp-port", "9223", "--", "--dry"]),
        { profile: "debug", vitePort: 51742, cdpPort: 9223, strictPort: false, taskArgs: ["--dry"] }
    );
    assert.deepEqual(parseDevOptions(["--dry"], {}), {
        profile: "default",
        vitePort: 51741,
        cdpPort: null,
        strictPort: false,
        taskArgs: ["--dry"],
    });
    assert.equal(parseDevOptions(["--strict-port"], {}).strictPort, true);
});

test("parseDevOptions rejects unsafe profiles and invalid ports", () => {
    assert.throws(() => parseDevOptions(["--profile", "../other"]), /profile must contain/);
    assert.throws(() => parseDevOptions(["--vite-port", "0"]), /Vite port must/);
    assert.throws(() => parseDevOptions(["--cdp-port"]), /--cdp-port requires/);
});
