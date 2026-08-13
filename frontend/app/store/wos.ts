// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WaveObjectStore

import { isPreviewWindow } from "@/app/store/windowtype";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { fireAndForget } from "@/util/util";
import { atom, Atom, Getter, PrimitiveAtom, Setter, useAtomValue } from "jotai";
import { globalStore } from "./jotaiStore";
import { makeAgentTraceId, makePslogSessionRef, pslogEnabled, pslogEvent, pslogTrace } from "./pslog-trace";
import { ObjectService } from "./services";

type WaveObjectDataItemType<T extends WaveObj> = {
    value: T;
    loading: boolean;
};

// pslog FE traces (the four pslogTrace calls below) mirror the backend
// ps-publish/ps-route chain into one file. Gated by the `debug:pslog` setting,
// injected via setPslogEnabledFn (see pslog-trace.ts). All trace sites funnel
// through pslogTrace() so the console.log + POST /wave/pslog + localStorage
// buffer pattern lives in one place.

// [ps-init] module-level probe: this runs once per module evaluation.
// If you see this line >1 time in pslog, vite HMR has hot-replaced wos.ts
// (which resets waveObjectValueCache = new Map()) — that's the suspected
// cause of "atom value regresses from v2 (with sid) back to v1 (no sid)".
(() => {
    if (globalThis.window == null) {
        return;
    }
    pslogTrace("ps-init", `[ps-init] wos module loaded at ${new Date().toISOString()}`);
})();

type WaveObjectValue<T extends WaveObj> = {
    pendingPromise: Promise<T>;
    dataAtom: PrimitiveAtom<WaveObjectDataItemType<T>>;
};

function splitORef(oref: string): [string, string] {
    const parts = oref.split(":");
    if (parts.length != 2) {
        throw new Error("invalid oref");
    }
    return [parts[0], parts[1]];
}

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function isBlankNum(num: number): boolean {
    return num == null || isNaN(num) || num == 0;
}

function isValidWaveObj(val: WaveObj): boolean {
    if (val == null) {
        return false;
    }
    if (isBlank(val.otype) || isBlank(val.oid) || isBlankNum(val.version)) {
        return false;
    }
    return true;
}

function makeORef(otype: string, oid: string): string {
    if (isBlank(otype) || isBlank(oid)) {
        return null;
    }
    return `${otype}:${oid}`;
}

const previewMockObjects: Map<string, WaveObj> = new Map();

function mockObjectForPreview<T extends WaveObj>(oref: string, obj: T): void {
    if (!isPreviewWindow()) {
        throw new Error("mockObjectForPreview can only be called in a preview window");
    }
    previewMockObjects.set(oref, obj);
}

function GetObject<T>(oref: string): Promise<T> {
    if (isPreviewWindow()) {
        return Promise.resolve((previewMockObjects.get(oref) as T) ?? null);
    }
    return callBackendService("object", "GetObject", [oref], true);
}

function debugLogBackendCall(methodName: string, durationStr: string, args: any[]) {
    durationStr = "| " + durationStr;
    if (methodName == "object.UpdateObject" && args.length > 0) {
        console.log("[service] object.UpdateObject", args[0].otype, args[0].oid, durationStr, args[0]);
        return;
    }
    if (methodName == "object.GetObject" && args.length > 0) {
        console.log("[service] object.GetObject", args[0], durationStr);
        return;
    }
    if (methodName == "file.StatFile" && args.length >= 2) {
        console.log("[service] file.StatFile", args[1], durationStr);
        return;
    }
    console.log("[service]", methodName, durationStr);
}

function wpsSubscribeToObject(oref: string): () => void {
    return waveEventSubscribeSingle({
        eventType: "waveobj:update",
        scope: oref,
        handler: (event) => {
            updateWaveObject(event.data);
        },
    });
}

function callBackendService(service: string, method: string, args: any[], noUIContext?: boolean): Promise<any> {
    const startTs = Date.now();
    let uiContext: UIContext = null;
    if (!noUIContext && globalThis.window != null) {
        uiContext = globalStore.get(((window as any).globalAtoms as GlobalAtomsType).uiContext);
    }
    const waveCall: WebCallType = {
        service: service,
        method: method,
        args: args,
        uicontext: uiContext,
    };
    // usp is just for debugging (easier to filter URLs)
    const methodName = `${service}.${method}`;
    const usp = new URLSearchParams();
    usp.set("service", service);
    usp.set("method", method);
    const webEndpoint = getWebServerEndpoint();
    if (webEndpoint == null) throw new Error(`cannot call ${methodName}: no web endpoint`);
    const url = webEndpoint + "/wave/service?" + usp.toString();
    const fetchPromise = fetch(url, {
        method: "POST",
        body: JSON.stringify(waveCall),
    });
    const prtn = fetchPromise
        .then((resp) => {
            if (!resp.ok) {
                throw new Error(`call ${methodName} failed: ${resp.status} ${resp.statusText}`);
            }
            return resp.json();
        })
        .then((respData: WebReturnType) => {
            if (respData == null) {
                return null;
            }
            if (respData.updates != null) {
                updateWaveObjects(respData.updates);
            }
            if (respData.error != null) {
                throw new Error(`call ${methodName} error: ${respData.error}`);
            }
            const durationStr = Date.now() - startTs + "ms";
            debugLogBackendCall(methodName, durationStr, args);
            return respData.data;
        });
    return prtn;
}

const waveObjectValueCache = new Map<string, WaveObjectValue<any>>();

function reloadWaveObject<T extends WaveObj>(oref: string): Promise<T> {
    let wov = waveObjectValueCache.get(oref);
    if (wov === undefined) {
        wov = getWaveObjectValue<T>(oref, true);
        return wov.pendingPromise;
    }
    const prtn = GetObject<T>(oref);
    prtn.then((val) => {
        globalStore.set(wov.dataAtom, { value: val, loading: false });
    });
    return prtn;
}

function createWaveValueObject<T extends WaveObj>(oref: string, shouldFetch: boolean): WaveObjectValue<T> {
    const wov = { pendingPromise: null, dataAtom: null };
    wov.dataAtom = atom({ value: null, loading: true });
    if (!shouldFetch) {
        return wov;
    }
    const startTs = Date.now();
    const localPromise = GetObject<T>(oref);
    wov.pendingPromise = localPromise;
    localPromise.then((val) => {
        if (wov.pendingPromise != localPromise) {
            return;
        }
        const [otype, oid] = splitORef(oref);
        if (val != null) {
            if (val["otype"] != otype) {
                throw new Error("GetObject returned wrong type");
            }
            if (val["oid"] != oid) {
                throw new Error("GetObject returned wrong id");
            }
        }
        wov.pendingPromise = null;
        const curData: WaveObjectDataItemType<WaveObj> = globalStore.get(wov.dataAtom);
        // WPS 事件流可能已经把 atom 推进到比 HTTP 响应更新的版本(见
        // updateWaveObject 的 version guard)。迟到的 HTTP 响应(例如 block 创建
        // 瞬间、persist 前的旧快照)不得把 atom 回退到旧版本——否则新建 agent
        // block 的 agent:sessionid 会被旧快照覆盖,TermSessionTopBar 永不出现。
        if (val != null && curData.value != null && curData.value.version >= val.version) {
            globalStore.set(wov.dataAtom, { value: curData.value, loading: false });
            return;
        }
        globalStore.set(wov.dataAtom, { value: val, loading: false });
        console.log("WaveObj resolved", oref, Date.now() - startTs + "ms");
    });
    return wov;
}

function getWaveObjectValue<T extends WaveObj>(oref: string, createIfMissing = true): WaveObjectValue<T> {
    let wov = waveObjectValueCache.get(oref);
    if (wov === undefined && createIfMissing) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    return wov;
}

function loadAndPinWaveObject<T extends WaveObj>(oref: string): Promise<T> {
    const wov = getWaveObjectValue<T>(oref);
    if (wov.pendingPromise == null) {
        const dataValue = globalStore.get(wov.dataAtom);
        return Promise.resolve(dataValue.value);
    }
    return wov.pendingPromise;
}

const waveObjectDerivedAtomCache = new Map<string, Atom<any>>();

function getWaveObjectAtom<T extends WaveObj>(oref: string): Atom<T> {
    const cacheKey = oref + ":value";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<T>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    const wov = getWaveObjectValue<T>(oref);
    cachedAtom = atom((get) => get(wov.dataAtom).value);
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

function getWaveObjectLoadingAtom(oref: string): Atom<boolean> {
    const cacheKey = oref + ":loading";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<boolean>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    const wov = getWaveObjectValue(oref);
    cachedAtom = atom((get) => {
        const dataValue = get(wov.dataAtom);
        return dataValue.loading;
    });
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

function isWaveObjectNullAtom(oref: string): Atom<boolean> {
    const cacheKey = oref + ":isnull";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<boolean>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    cachedAtom = atom((get) => get(getWaveObjectAtom(oref)) == null);
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

function useWaveObjectValue<T extends WaveObj>(oref: string): [T, boolean] {
    const wov = getWaveObjectValue<T>(oref);
    const atomVal = useAtomValue(wov.dataAtom);
    // [ps-use] confirm React subscriber actually re-ran and read this atom (paired with [ps-set])
    try {
        if (pslogEnabled() && typeof oref === "string" && oref.startsWith("block:")) {
            const blockId = oref.slice("block:".length);
            const readVer = (atomVal.value as any)?.version ?? null;
            const readSid = (atomVal.value as any)?.meta?.["agent:sessionid"] ?? null;
            const sessionRef = makePslogSessionRef(typeof readSid === "string" ? readSid : "");
            const line = `[ps-use] oref=block:${blockId} readVer=${readVer} readSidRef=${sessionRef}`;
            pslogTrace("ps-use", line, { bufferKey: "ps-use-buf" });
            if (sessionRef !== "") {
                pslogEvent(
                    {
                        event: "agent.pubsub",
                        stage: "use",
                        traceid: makeAgentTraceId(blockId, readSid),
                        blockid: blockId,
                        sessionref: sessionRef,
                        outcome: "ok",
                    },
                    { bufferKey: "ps-agent-top-buf" }
                );
            }
            // keep the legacy global name alive for DevTools/test observers
            (window as any).__psUseBuf = (window as any)["ps-use-buf"];
        }
    } catch {}
    return [atomVal.value, atomVal.loading];
}

function updateWaveObject(update: WaveObjUpdate) {
    if (update == null) {
        return;
    }
    const oref = makeORef(update.otype, update.oid);
    const wov = getWaveObjectValue(oref);
    if (update.updatetype == "delete") {
        console.log("WaveObj deleted", oref);
        globalStore.set(wov.dataAtom, { value: null, loading: false });
    } else {
        if (!isValidWaveObj(update.obj)) {
            console.log("invalid wave object update", update);
            return;
        }
        const curValue: WaveObjectDataItemType<WaveObj> = globalStore.get(wov.dataAtom);
        // [ps-recv] trace whether waveobj updates arrive at the client (paired with [ps-publish]/[ps-route] on backend)
        if (pslogEnabled() && update.otype === "block") {
            const curVer = curValue.value?.version ?? null;
            const newVer = update.obj?.version ?? null;
            const curSid = (curValue.value as any)?.meta?.["agent:sessionid"] ?? null;
            const newSid = (update.obj as any)?.meta?.["agent:sessionid"] ?? null;
            const willSkip = curValue.value != null && curVer != null && newVer != null && curVer >= newVer;
            const curSessionRef = makePslogSessionRef(typeof curSid === "string" ? curSid : "");
            const newSessionRef = makePslogSessionRef(typeof newSid === "string" ? newSid : "");
            const line = `[ps-recv] oref=block:${update.oid} curVer=${curVer} newVer=${newVer} curSidRef=${curSessionRef} newSidRef=${newSessionRef} willSkip=${willSkip}`;
            pslogTrace("ps-recv", line, { bufferKey: "ps-recv-buf" });
            if (newSessionRef !== "") {
                pslogEvent(
                    {
                        event: "agent.pubsub",
                        stage: "recv",
                        traceid: makeAgentTraceId(update.oid, newSid),
                        blockid: update.oid,
                        sessionref: newSessionRef,
                        outcome: willSkip ? "skipped" : "ok",
                        reason: willSkip ? "stale-version" : undefined,
                    },
                    { bufferKey: "ps-agent-top-buf" }
                );
            }
            // keep the legacy global name alive for DevTools/test observers
            (window as any).__psRecvBuf = (window as any)["ps-recv-buf"];
        }
        if (curValue.value != null && curValue.value.version >= update.obj.version) {
            return;
        }
        console.log("WaveObj updated", oref);
        globalStore.set(wov.dataAtom, { value: update.obj, loading: false });
        // [ps-set] confirm atom.set was actually called (after the version-guard above did NOT skip)
        if (pslogEnabled() && update.otype === "block") {
            const newSid = (update.obj as any)?.meta?.["agent:sessionid"] ?? null;
            const newVer = update.obj?.version ?? null;
            const sessionRef = makePslogSessionRef(typeof newSid === "string" ? newSid : "");
            const line = `[ps-set] oref=block:${update.oid} newVer=${newVer} newSidRef=${sessionRef}`;
            pslogTrace("ps-set", line, { bufferKey: "ps-set-buf" });
            if (sessionRef !== "") {
                pslogEvent(
                    {
                        event: "agent.pubsub",
                        stage: "set",
                        traceid: makeAgentTraceId(update.oid, newSid),
                        blockid: update.oid,
                        sessionref: sessionRef,
                        outcome: "ok",
                    },
                    { bufferKey: "ps-agent-top-buf" }
                );
            }
            // keep the legacy global name alive for DevTools/test observers
            (window as any).__psSetBuf = (window as any)["ps-set-buf"];
        }
    }
    return;
}

function updateWaveObjects(vals: WaveObjUpdate[]) {
    for (const val of vals) {
        updateWaveObject(val);
    }
}

// gets the value of a WaveObject from the cache.
// should provide getFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.get function
function getObjectValue<T extends WaveObj>(oref: string, getFn?: Getter): T {
    const wov = getWaveObjectValue<T>(oref);
    if (getFn == null) {
        getFn = globalStore.get;
    }
    const atomVal = getFn(wov.dataAtom);
    return atomVal.value;
}

// sets the value of a WaveObject in the cache.
// should provide setFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.set function
function setObjectValue<T extends WaveObj>(value: T, setFn?: Setter, pushToServer?: boolean) {
    const oref = makeORef(value.otype, value.oid);
    const wov = getWaveObjectValue(oref, false);
    if (wov === undefined) {
        return;
    }
    if (setFn === undefined) {
        setFn = globalStore.set;
    }
    setFn(wov.dataAtom, { value: value, loading: false });
    if (pushToServer) {
        fireAndForget(() => ObjectService.UpdateObject(value, false));
    }
}

export {
    callBackendService,
    getObjectValue,
    getWaveObjectAtom,
    getWaveObjectLoadingAtom,
    isWaveObjectNullAtom,
    loadAndPinWaveObject,
    makeORef,
    mockObjectForPreview,
    reloadWaveObject,
    setObjectValue,
    splitORef,
    updateWaveObject,
    updateWaveObjects,
    useWaveObjectValue,
    wpsSubscribeToObject,
};
