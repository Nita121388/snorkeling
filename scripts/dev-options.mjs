const DefaultVitePort = 51741;

function parsePort(value, name) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${name} must be an integer between 1 and 65535`);
    }
    return port;
}

function takeValue(args, index, name) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${name} requires a value`);
    }
    return value;
}

function parseOptionValue(arg, args, index, name) {
    if (arg.startsWith(`${name}=`)) {
        return { value: arg.slice(name.length + 1), consumed: 0 };
    }
    if (arg === name) {
        return { value: takeValue(args, index, name), consumed: 1 };
    }
    return null;
}

export function parseDevOptions(args, baseEnv = process.env) {
    const taskArgs = [];
    let profile = baseEnv.SNORKELING_DEV_PROFILE || "default";
    let vitePort = parsePort(baseEnv.SNORKELING_VITE_PORT || DefaultVitePort, "Vite port");
    let cdpPort = baseEnv.SNORKELING_CDP_PORT ? parsePort(baseEnv.SNORKELING_CDP_PORT, "CDP port") : null;
    let strictPort = baseEnv.SNORKELING_STRICT_PORT === "1";

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--") {
            taskArgs.push(...args.slice(index + 1));
            break;
        }
        if (arg === "--strict-port") {
            strictPort = true;
            continue;
        }

        const profileOption = parseOptionValue(arg, args, index, "--profile");
        if (profileOption) {
            profile = profileOption.value;
            index += profileOption.consumed;
            continue;
        }
        const viteOption = parseOptionValue(arg, args, index, "--vite-port");
        if (viteOption) {
            vitePort = parsePort(viteOption.value, "Vite port");
            index += viteOption.consumed;
            continue;
        }
        const cdpOption = parseOptionValue(arg, args, index, "--cdp-port");
        if (cdpOption) {
            cdpPort = parsePort(cdpOption.value, "CDP port");
            index += cdpOption.consumed;
            continue;
        }
        taskArgs.push(arg);
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) {
        throw new Error("profile must contain only letters, numbers, dot, underscore, or hyphen");
    }
    return { profile, vitePort, cdpPort, strictPort, taskArgs };
}
