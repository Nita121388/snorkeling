import net from "node:net";

function isPortAvailable(port, host) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, host, () => {
            server.close(() => resolve(true));
        });
    });
}

export async function findAvailablePort(startPort, options = {}) {
    const host = options.host ?? "127.0.0.1";
    const strict = options.strict ?? false;
    const maxAttempts = options.maxAttempts ?? 100;
    const excludedPorts = new Set(options.exclude ?? []);
    for (let offset = 0; offset < maxAttempts; offset++) {
        const port = startPort + offset;
        if (port > 65535) {
            break;
        }
        if (excludedPorts.has(port)) {
            continue;
        }
        if (await isPortAvailable(port, host)) {
            return port;
        }
        if (strict) {
            break;
        }
    }
    throw new Error(
        strict
            ? `port ${startPort} is already in use on ${host}`
            : `no available port found from ${startPort} on ${host}`
    );
}
