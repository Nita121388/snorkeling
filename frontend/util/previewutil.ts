import { createBlock, getApi } from "@/app/store/global";
import { createDefaultAgentBlockDef } from "@/app/workspace/agent-launch";
import { makeNativeLabel } from "./platformutil";
import { fireAndForget, isLocalConnName } from "./util";
import { formatRemoteUri } from "./waveutil";

type AddOpenMenuItemsOptions = {
    openInCurrentBlock?: (() => void | Promise<void>) | null;
};

export function addOpenMenuItems(
    menu: ContextMenuItem[],
    conn: string,
    finfo: FileInfo,
    options: AddOpenMenuItemsOptions = {}
): ContextMenuItem[] {
    if (!finfo) {
        return menu;
    }
    const isLocalConn = isLocalConnName(conn);
    menu.push({
        type: "separator",
    });
    if (isLocalConn) {
        // TODO:  resolve correct host path if connection is WSL
        // if the entry is a directory, reveal it in the file manager, if the entry is a file, reveal its parent directory
        menu.push({
            label: makeNativeLabel(true),
            click: () => {
                getApi().openNativePath(finfo.isdir ? finfo.path : finfo.dir);
            },
        });
        // if the entry is a file, open it in the default application
        if (!finfo.isdir) {
            menu.push({
                label: makeNativeLabel(false),
                click: () => {
                    getApi().openNativePath(finfo.path);
                },
            });
        }
        menu.push({
            label: "Open VS Code Here",
            click: () => {
                const targetPath = finfo.isdir ? finfo.path : finfo.dir;
                fireAndForget(async () => {
                    if (!targetPath) {
                        return;
                    }
                    const ok = await getApi().openInVSCode(targetPath);
                    if (!ok) {
                        console.error("Failed to open in VS Code", targetPath);
                    }
                });
            },
        });
    } else {
        menu.push({
            label: "Download File",
            click: () => {
                const remoteUri = formatRemoteUri(finfo.path, conn);
                getApi().downloadFile(remoteUri);
            },
        });
    }
    menu.push({
        type: "separator",
    });
    if (options.openInCurrentBlock) {
        menu.push({
            label: "Open in This Block",
            click: () => {
                fireAndForget(async () => {
                    await options.openInCurrentBlock?.();
                });
            },
        });
    }
    if (finfo.isdir) {
        menu.push({
            label: "Open in New Block",
            click: () =>
                fireAndForget(async () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "preview",
                            file: finfo.path,
                            connection: conn,
                        },
                    };
                    await createBlock(blockDef);
                }),
        });
    } else {
        menu.push({
            label: "Open Preview in New Block",
            click: () =>
                fireAndForget(async () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "preview",
                            file: finfo.path,
                            connection: conn,
                        },
                    };
                    await createBlock(blockDef);
                }),
        });
    }
    menu.push({
        label: "Open Terminal Here",
        click: () => {
            const termBlockDef: BlockDef = {
                meta: {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": finfo.isdir ? finfo.path : finfo.dir,
                    connection: conn,
                },
            };
            fireAndForget(() => createBlock(termBlockDef));
        },
    });
    menu.push({
        label: "Run Agent Here",
        click: () => {
            const agentBlockDef = createDefaultAgentBlockDef(undefined, {
                connection: conn,
                cwd: finfo.isdir ? finfo.path : finfo.dir,
                inheritWorkspaceContext: false,
            });
            fireAndForget(() => createBlock(agentBlockDef));
        },
    });
    return menu;
}
