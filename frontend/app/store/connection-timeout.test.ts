import { describe, expect, it } from "vitest";
import { ConnectionOperationTimeoutMs } from "./connection-timeout";

describe("connection operation timeout", () => {
    it("covers the adaptive wsh upload and install window", () => {
        expect(ConnectionOperationTimeoutMs).toBeGreaterThanOrEqual(7 * 60 * 1000);
    });
});
