// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// <CopyForAgent>：任何「用户需要向 agent 解释半天」的状态旁的统一入口。
//
// 约定：
//   - 只进剪贴板，不绑定任何单一 provider（跨 agent 的唯一通道是剪贴板）；
//   - 按钮紧贴被解释的对象（冲突行右、错误行右），由各消费面摆放，不做全局导出；
//   - payload 由 ./agent-payload.ts 的三段式构建器统一组装：
//
//       ### Context
//       ### Task
//       ### Output contract
//
//     消费面只拼 Context，Task 与 Output contract 交给构建器。

import {
    buildAgentPayload,
    DIAGNOSIS_BRIEF,
    FIX_COMMAND_ONLY,
    MERGED_CONTENT_ONLY,
    type AgentOutputContract,
    type AgentPayloadOpts,
} from "./agent-payload";
import { CopyButton } from "./copybutton";

type CopyForAgentProps = {
    /** hover 提示，必填：说明复制内容的概要，如 "Copy all 3 conflicts for an AI to merge"。 */
    title: string;
    /** 复制内容；传函数时点击才懒取（RPC 数据），复制期间按钮显示 loading。 */
    text: string | (() => Promise<string>);
    className?: string;
};

async function resolvePayload(text: CopyForAgentProps["text"]): Promise<string> {
    const payload = typeof text === "function" ? await text() : text;
    if (payload == null || payload.trim() === "") {
        throw new Error("CopyForAgent: payload is empty — nothing to hand to an agent");
    }
    return payload;
}

const CopyForAgent = ({ title, text, className }: CopyForAgentProps) => {
    const onClick = async () => {
        const payload = await resolvePayload(text);
        if (typeof navigator === "undefined" || navigator.clipboard == null) {
            throw new Error("CopyForAgent: clipboard API unavailable");
        }
        await navigator.clipboard.writeText(payload);
    };
    return (
        <CopyButton
            title={title}
            label="Copy for agent"
            icon="copy"
            onClick={onClick}
            className={className}
            dataAttrs={{ "data-copy-for-agent": title }}
        />
    );
};

export { CopyForAgent, buildAgentPayload, MERGED_CONTENT_ONLY, FIX_COMMAND_ONLY, DIAGNOSIS_BRIEF };
export type { AgentPayloadOpts, AgentOutputContract, CopyForAgentProps };
