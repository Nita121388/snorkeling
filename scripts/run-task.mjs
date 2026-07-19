import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnv } from "./resolve-env.mjs";

const taskArgs = process.argv.slice(2);
if (taskArgs.length === 0) {
    console.error("error: expected a Task command, for example: node scripts/run-task.mjs package");
    process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { env, taskBin } = resolveEnv(repoRoot);
const child = spawn(taskBin, taskArgs, { stdio: "inherit", env, shell: false });
child.on("error", (error) => {
    if (error.code === "ENOENT") {
        console.error("error: cannot find Task in repository .tools/task or PATH; run npm run setup");
    } else {
        console.error(`error: ${error.message}`);
    }
    process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
