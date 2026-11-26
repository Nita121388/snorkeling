// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { isPreviewWindow } from "@/app/store/windowtype";
import { isBlank } from "@/util/util";
import { Subject } from "rxjs";

let WpsRpcClient: WshClient;

function setWpsRpcClient(client: WshClient) {
    WpsRpcClient = client;
}

type WaveEventSubject<T extends WaveEventName = WaveEventName> = {
    handler: (event: Extract<WaveEvent, { event: T }>) => void;
    scope?: string;
};

type WaveEventSubjectContainer = {
    handler: (event: WaveEvent) => void;
    scope?: string;
    id: string;
};

type WaveEventSubscription<T extends WaveEventName = WaveEventName> = WaveEventSubject<T> & {
    eventType: T;
};

type WaveEventUnsubscribe = {
    id: string;
    eventType: string;
};

// key is "eventType" or "eventType|oref"
const fileSubjects = new Map<string, SubjectWithRef<WSFileEventData>>();
const waveEventSubjects = new Map<string, WaveEventSubjectContainer[]>();

// W2-3: sub/unsub 合批。同一 tick 内对同一 eventType 的多次变更只发一条 EventSubCommand。
// 协议语义：后端 EventSubCommand → Broker.Subscribe 会先 `unsubscribe_nolock(route, event)`
// 再按本次请求里的 scopes 重新登记，也就是「每个 (route, event) 全量替换」。
// 因此这里只维护「期望态」并整体重发，不需要做增量合并；移除 scope 也天然覆盖（替换即删除）。
let pendingEventTypes: Set<string> = new Set();
let subFlushScheduled = false;

function scheduleWaveEventSub(eventType: string) {
    pendingEventTypes.add(eventType);
    if (subFlushScheduled) {
        return;
    }
    subFlushScheduled = true;
    queueMicrotask(() => {
        const eventTypes = Array.from(pendingEventTypes);
        pendingEventTypes = new Set();
        subFlushScheduled = false;
        for (const et of eventTypes) {
            updateWaveEventSub(et);
        }
    });
}

function wpsReconnectHandler() {
    // 重连后 broker 侧的订阅已全部丢失，必须立刻按当前期望态全部重发（不走合批）。
    for (const eventType of waveEventSubjects.keys()) {
        updateWaveEventSub(eventType);
    }
}

function updateWaveEventSub(eventType: string) {
    if (isPreviewWindow()) {
        return;
    }
    // client 未接入（测试环境 / 初始化早期）：没有可发的 RPC，直接跳过。
    // 这里是 microtask flush 的入口，绝不能抛未处理异常。
    if (WpsRpcClient == null) {
        return;
    }
    const subjects = waveEventSubjects.get(eventType);
    if (subjects == null) {
        RpcApi.EventUnsubCommand(WpsRpcClient, eventType, { noresponse: true });
        return;
    }
    const scopeSet: Set<string> = new Set();
    let allscopes = false;
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            allscopes = true;
            break;
        }
        // 同一 eventType 的重复 scope 只传一次（N 个块订阅同一 scope → 1 条）。
        scopeSet.add(scont.scope);
    }
    const subreq: SubscriptionRequest = {
        event: eventType,
        scopes: allscopes ? [] : Array.from(scopeSet),
        allscopes: allscopes,
    };
    RpcApi.EventSubCommand(WpsRpcClient, subreq, { noresponse: true });
}

function waveEventSubscribeSingle<T extends WaveEventName>(subscription: WaveEventSubscription<T>): () => void {
    // console.log("waveEventSubscribeSingle", subscription);
    if (subscription.handler == null) {
        return () => {};
    }
    const id: string = crypto.randomUUID();
    let subjects = waveEventSubjects.get(subscription.eventType);
    if (subjects == null) {
        subjects = [];
        waveEventSubjects.set(subscription.eventType, subjects);
    }
    const subcont: WaveEventSubjectContainer = {
        id,
        handler: subscription.handler as (event: WaveEvent) => void,
        scope: subscription.scope,
    };
    subjects.push(subcont);
    scheduleWaveEventSub(subscription.eventType);
    return () => waveEventUnsubscribe({ id, eventType: subscription.eventType });
}

function waveEventUnsubscribe(...unsubscribes: WaveEventUnsubscribe[]) {
    const eventTypeSet = new Set<string>();
    for (const unsubscribe of unsubscribes) {
        const subjects = waveEventSubjects.get(unsubscribe.eventType);
        if (subjects == null) {
            return;
        }
        const idx = subjects.findIndex((s) => s.id === unsubscribe.id);
        if (idx === -1) {
            return;
        }
        subjects.splice(idx, 1);
        if (subjects.length === 0) {
            waveEventSubjects.delete(unsubscribe.eventType);
        }
        eventTypeSet.add(unsubscribe.eventType);
    }

    for (const eventType of eventTypeSet) {
        scheduleWaveEventSub(eventType);
    }
}

function getFileSubject(zoneId: string, fileName: string): SubjectWithRef<WSFileEventData> {
    const subjectKey = zoneId + "|" + fileName;
    let subject = fileSubjects.get(subjectKey);
    if (subject == null) {
        subject = new Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                fileSubjects.delete(subjectKey);
            }
        };
        fileSubjects.set(subjectKey, subject);
    }
    subject.refCount++;
    return subject;
}

function handleWaveEvent(event: WaveEvent) {
    // console.log("handleWaveEvent", event);
    const subjects = waveEventSubjects.get(event.event);
    if (subjects == null) {
        return;
    }
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            scont.handler(event);
            continue;
        }
        if (event.scopes == null) {
            continue;
        }
        if (event.scopes.includes(scont.scope)) {
            scont.handler(event);
        }
    }
}

export {
    getFileSubject,
    handleWaveEvent,
    setWpsRpcClient,
    waveEventSubscribeSingle,
    waveEventUnsubscribe,
    wpsReconnectHandler,
};
