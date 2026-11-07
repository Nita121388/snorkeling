// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CenteredDiv } from "@/app/element/quickelems";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import { useAtomValue, useSetAtom } from "jotai";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { SpecializedViewProps } from "./preview";
import { ImagePager, IMAGE_PAGER_ENABLED } from "./image-pager";

function ImageZoomControls() {
    const { zoomIn, zoomOut, resetTransform } = useControls();

    return (
        <div className="absolute flex flex-row z-[2] top-0 right-0 p-[5px] gap-1">
            <Button onClick={() => zoomIn()} title="Zoom In" className="py-1 px-[5px]">
                <i className="fa-sharp fa-plus" />
            </Button>
            <Button onClick={() => zoomOut()} title="Zoom Out" className="py-1 px-[5px]">
                <i className="fa-sharp fa-minus" />
            </Button>
            <Button onClick={() => resetTransform()} title="Reset Zoom" className="py-1 px-[5px]">
                <i className="fa-sharp fa-rotate-left" />
            </Button>
        </div>
    );
}

function StreamingImagePreview({ url, model }: { url: string; model: SpecializedViewProps["model"] }) {
    const fileInfo = useAtomValue(model.statFile);
    const connKey = useAtomValue(model.connectionImmediate);
    // 缩放守卫的权威来源：onTransformed。
    // 不能用 onZoom —— 它只在手势缩放时触发，程序化 zoomIn()/resetTransform() 不触发
    // （实测 scale 恒为 1，键盘守卫形同虚设）；onTransformed 走 setTransformState 的
    // 每次变更回调，程序化与手势都会触发。
    const setImageScale = useSetAtom(model.imageScale);
    return (
        <div className="flex flex-row h-full overflow-hidden items-center justify-center relative">
            <TransformWrapper
                initialScale={1}
                centerOnInit
                pinch={{ step: 10 }}
                onTransformed={(_ref, state) => setImageScale(state?.scale ?? 1)}
            >
                <ImageZoomControls />
                <TransformComponent wrapperClass="!h-full !w-full">
                    <img src={url} className="z-[1]" />
                </TransformComponent>
            </TransformWrapper>
            {IMAGE_PAGER_ENABLED && fileInfo != null ? (
                <ImagePager model={model} filePath={fileInfo.path} connKey={connKey ?? ""} />
            ) : null}
        </div>
    );
}

function StreamingPreview({ model }: SpecializedViewProps) {
    const conn = useAtomValue(model.connection);
    const fileInfo = useAtomValue(model.statFile);
    const filePath = fileInfo.path;
    const remotePath = formatRemoteUri(filePath, conn);
    const usp = new URLSearchParams();
    usp.set("path", remotePath);
    const streamingUrl = `${getWebServerEndpoint()}/wave/stream-file?${usp.toString()}`;
    if (fileInfo.mimetype === "application/pdf") {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center p-[5px]">
                <iframe src={streamingUrl} width="100%" height="100%" name="pdfview" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("video/")) {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center">
                <video controls src={streamingUrl} className="w-full h-full p-[10px] object-contain" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("audio/")) {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center">
                <audio controls src={streamingUrl} className="w-full h-full p-[10px] object-contain" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("image/")) {
        return <StreamingImagePreview url={streamingUrl} model={model} />;
    }
    return <CenteredDiv>Preview Not Supported</CenteredDiv>;
}

/**
 * Internal HTML preview.
 *
 * Reuses the existing `/wave/stream-file` endpoint (same mechanism as the PDF branch above)
 * instead of reading + injecting the file, so no new file-serving path is added.
 *
 * `sandbox=""` is an EMPTY sandbox: scripts, forms, popups, top-navigation and same-origin
 * access are all denied, and the frame gets a unique opaque origin. Page scripts therefore
 * cannot reach the app's context. For the same reason this cannot use a remote URL
 * (`allow-same-origin` must never be combined with `allow-scripts`).
 */
function HtmlPreviewView({ model }: SpecializedViewProps) {
    const conn = useAtomValue(model.connection);
    const fileInfo = useAtomValue(model.statFile);
    const remotePath = formatRemoteUri(fileInfo.path, conn);
    const usp = new URLSearchParams();
    usp.set("path", remotePath);
    const streamingUrl = `${getWebServerEndpoint()}/wave/stream-file?${usp.toString()}`;
    return (
        <div className="flex flex-row h-full w-full overflow-hidden">
            <iframe
                className="w-full h-full border-0 bg-white"
                title="HTML Preview (sandboxed)"
                sandbox=""
                referrerPolicy="no-referrer"
                src={streamingUrl}
            />
        </div>
    );
}

export { HtmlPreviewView, StreamingPreview };
