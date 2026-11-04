// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 目录树 VCS 状态 hook —— 从 preview-directory.tsx 抽出共享：
//   表格视图（preview-directory）与 Explorer 树视图（preview-explorer）都挂这一个 hook，
//   目录切换后 debounce 250ms 发**一次** RemoteVcsRepositoriesCommand，纯函数建索引；
//   缓存（conn|dir，TTL 10s）命中不发 RPC；Refresh（refreshVersion）视为失效。
// 单独成文件而不是并进 vcs-tree-status.ts：后者是纯逻辑层（无 React/RPC 依赖，
// 便于单测），把 hook 塞进去会引入 preview-model/previewenv 的类型循环。

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import type { PreviewModel } from "./preview-model";
import { WindowsDrivesPath } from "./preview-windows-drives";
import type { PreviewEnv } from "./previewenv";
import {
    FILES_VCS_TREE_STATUS_ENABLED,
    VCS_TREE_STATUS_DEBOUNCE_MS,
    VCS_TREE_STATUS_LIMIT,
    VCS_TREE_STATUS_RPC_TIMEOUT_MS,
    VCS_TREE_STATUS_SCAN_DEPTH,
    buildVcsTreeStatus,
    getCachedVcsTreeStatus,
    setCachedVcsTreeStatus,
    type VcsTreeMark,
    type VcsTreeStatus,
} from "./vcs-tree-status";

/** VCS 标记的行尾/悬停文案（D 方案：文件名着色 + 行尾字母） */
export const VcsFileMarkTitle: Record<VcsTreeMark, string> = {
    M: "已修改（modified）",
    U: "未跟踪（untracked）",
    D: "已删除（deleted）",
};

/**
 * 目录树 VCS 状态：一次 RPC + 两套索引（fileMark / dirCount），渲染期 O(1) 查表。
 * dirPath 是目录视图的根（表格视图 = 当前目录；树视图 = explorerRootPath）。
 */
export function useDirectoryVcsTreeStatus(
    model: PreviewModel,
    rpc: PreviewEnv["rpc"],
    dirPath: string,
    conn: string,
    refreshVersion: number
): VcsTreeStatus | null {
    const [status, setStatus] = useState<VcsTreeStatus | null>(null);
    // 上一个真实目录：只有**换目录**才清空旧标记；同目录 Refresh 保留旧索引
    // （否则用户按刷新看到"标记先消失再出现"闪一屏）
    const lastDirRef = useRef<string | null>(null);

    useEffect(() => {
        if (!FILES_VCS_TREE_STATUS_ENABLED || isBlank(dirPath ?? "")) {
            setStatus(null);
            return;
        }
        // Windows「This PC」伪路径：os.Stat 必失败，不发注定失败的 RPC
        if (dirPath === WindowsDrivesPath) {
            setStatus(null);
            return;
        }
        const cached = getCachedVcsTreeStatus(conn, dirPath, { refreshVersion });
        if (cached != null) {
            setStatus(cached);
            return;
        }
        // 换目录即清空旧标记：旧目录的行标记挂在新目录上就是错的
        if (lastDirRef.current !== dirPath) {
            setStatus(null);
        }
        lastDirRef.current = dirPath;
        let cancelled = false;
        const timer = setTimeout(() => {
            fireAndForget(async () => {
                try {
                    const remotePath = await model.formatRemoteUri(dirPath, globalStore.get);
                    // 必须路由到 conn 上（本地是 conn:local）：remotevcs* 命令由 wshremote 实现，
                    // 直连主 wshserver 会得到 "command not implemented"。makeConnRoute 对空 conn
                    // 返回 "conn:local"，所以本地目录也能拿到 VCS 数据。
                    const route = makeConnRoute(conn);
                    const response = await rpc.RemoteVcsRepositoriesCommand(
                        TabRpcClient,
                        {
                            path: remotePath,
                            scandepth: VCS_TREE_STATUS_SCAN_DEPTH,
                            statuslimit: VCS_TREE_STATUS_LIMIT,
                            includeparent: true,
                        },
                        { route, timeout: VCS_TREE_STATUS_RPC_TIMEOUT_MS }
                    );
                    if (cancelled) {
                        return;
                    }
                    const built = buildVcsTreeStatus(response?.repositories ?? [], {
                        rootDir: dirPath,
                        baseDir: response?.basepath,
                        statusLimit: VCS_TREE_STATUS_LIMIT,
                    });
                    setCachedVcsTreeStatus(conn, dirPath, built, { refreshVersion });
                    setStatus(built);
                } catch (e) {
                    console.warn(`[vcs-tree-status] exception for ${dirPath}: ${e}`);
                    if (!cancelled) {
                        setStatus(null);
                    }
                }
            });
        }, VCS_TREE_STATUS_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [conn, dirPath, refreshVersion, model, rpc]);

    return status;
}
