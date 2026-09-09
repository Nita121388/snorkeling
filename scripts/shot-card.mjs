import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = dirname(fileURLToPath(import.meta.url).replace(/\\/g, "/"));
const file = `file:///${root}/design/prototypes/agent-id-card/index.html`;

function shot(theme, out) {
    return new Promise((res) => {
        execFile(
            chrome,
            [
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--window-size=1400,1200",
                "--virtual-time-budget=2500",
                "--screenshot=" + out,
                "--default-background-color=00000000",
                file,
            ],
            () => setTimeout(res, 800),
        );
    });
}

// inject theme via a fragment isn't supported; instead write 3 small profile-free shots by
// passing a query-style override is not possible, so we screenshot default (dark).
const out = "C:/Temp/card-shots";
await shot("dark", out + "/card-default.png");
await new Promise((r) => setTimeout(r, 300));
console.log("shot done");