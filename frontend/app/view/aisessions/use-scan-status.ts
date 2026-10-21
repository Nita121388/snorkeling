// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveEventSubscribeSingle } from "@/app/store/wps";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    InitialScanStatus,
    normalizeScanStatusEvent,
    reduceScanStatus,
    shouldNotifyScanDone,
} from "./scan-status-logic";
import type { ScanStatus } from "./scan-status-logic";

/**
 * 订阅后端 aisessions:scanstatus 事件，暴露后台 summary 扫描进度。
 *
 * 设计要点：
 * - 事件只更新本地 state，**不**在这里触发重新拉列表，避免事件风暴把
 *   List RPC 打满（旧实现的问题就是轮询 + 全量扫叠加）。
 * - 扫描结束时通过 onScanDone 回调通知上层，由上层防抖后再取一次列表；
 *   一个扫描周期（多 provider 成批发 done）只回调一次。
 * - 只消费本地连接的事件，远程连接由各自视图负责。
 * - 去重/防倒退规则集中在 scan-status-logic.ts，那边有单测覆盖。
 */
export function useScanStatus(options: { enabled: boolean; onScanDone: () => void }): ScanStatus {
    const [status, setStatus] = useState<ScanStatus>(InitialScanStatus);
    const onScanDoneRef = useRef(options.onScanDone);
    onScanDoneRef.current = options.onScanDone;

    const handleEvent = useCallback((event: { data?: ScanStatusEvent }) => {
        const incoming = normalizeScanStatusEvent(event.data);
        if (incoming == null) {
            return;
        }
        setStatus((current) => {
            if (shouldNotifyScanDone(current, incoming)) {
                // 状态提交后再回调，避免在 setState 里做副作用
                queueMicrotask(() => onScanDoneRef.current());
            }
            return reduceScanStatus(current, incoming);
        });
    }, []);

    useEffect(() => {
        if (!options.enabled) {
            setStatus(InitialScanStatus);
            return;
        }
        return waveEventSubscribeSingle<"aisessions:scanstatus">({
            eventType: "aisessions:scanstatus",
            handler: handleEvent,
        });
    }, [options.enabled, handleEvent]);

    return status;
}
