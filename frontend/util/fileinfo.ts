// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `FileInfoCommand` / `FileReadCommand` / `FileWriteCommand` 的请求体。
 *
 * Go 侧这些命令复用同一个 `FileData.Info`（类型是完整 `FileInfo`，`mimetype` 非可选），
 * 但实际读取路径只会用到 `path`。TS 因此要求每个调用点补全所有必填字段 ——
 * 与其在十几处各写一遍 `mimetype: ""`，不如集中一个构造器，把"这是个部分结构"这件事写在一处。
 */
export function fileInfoRequest(path: string): FileInfo {
    return { path, mimetype: "" };
}
