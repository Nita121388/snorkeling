import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { findAvailablePort } from "./dev-port.mjs";

test("findAvailablePort advances past an occupied port", async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const occupiedPort = server.address().port;
    try {
        const availablePort = await findAvailablePort(occupiedPort, { maxAttempts: 10 });
        assert.notEqual(availablePort, occupiedPort);
        assert.ok(availablePort > occupiedPort);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("findAvailablePort supports strict collision failures", async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const occupiedPort = server.address().port;
    try {
        await assert.rejects(findAvailablePort(occupiedPort, { strict: true }), /already in use/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("findAvailablePort skips ports reserved by another dev service", async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const reservedPort = server.address().port;
    try {
        const availablePort = await findAvailablePort(reservedPort, { exclude: [reservedPort], maxAttempts: 10 });
        assert.notEqual(availablePort, reservedPort);
        assert.ok(availablePort > reservedPort);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
