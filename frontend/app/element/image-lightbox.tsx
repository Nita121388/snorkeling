// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Fullscreen image lightbox for markdown preview images. Click an image in the
// rendered markdown to zoom in on it; ESC / backdrop-click / close button to exit.
//
// Interactions:
//   - wheel:        zoom 25%..400%, anchored at the cursor position
//   - drag:         pan when the zoomed image overflows the viewport
//   - double-click: toggle between "fit viewport" and 100% (natural size)
//   - ESC / click backdrop / close button: close
//
// Zoom uses CSS transform (no reflow), so large images stay smooth.
// ponytail: no inertia / momentum on pan, no pinch-zoom for touch, no rotation —
// the common cases (read a screenshot, check a detail) are covered; upgrade path is
// a lib like yet-another-react-lightbox if we ever need thumbnails/galleries.

import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import "./image-lightbox.scss";

const MinZoom = 0.25;
const MaxZoom = 4;

type ImageLightboxProps = {
    src: string;
    alt?: string;
    onClose: () => void;
};

function clampZoom(z: number): number {
    return Math.min(MaxZoom, Math.max(MinZoom, z));
}

// The "fit" zoom: scale so the image's natural size fits the viewport, but never scale
// a small image above its natural size (100%). Returns null until the image loads.
function computeFitZoom(img: HTMLImageElement): number | null {
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        return null;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return Math.min(1, vw / img.naturalWidth, vh / img.naturalHeight);
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
    const [zoom, setZoom] = useState(1);
    const [tx, setTx] = useState(0);
    const [ty, setTy] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const imgRef = useRef<HTMLImageElement | null>(null);
    // Where the wheel/dblclick handling sits: zoom changes are relative to current zoom,
    // and double-click toggles between fit and 100%. Both need the latest value.
    const fitZoomRef = useRef<number | null>(null);
    const zoomRef = useRef(1);
    zoomRef.current = zoom;
    const dragRef = useRef<{ startX: number; startY: number; baseTx: number; baseTy: number } | null>(null);
    // Guards against the double-click-open conflict: a dblclick on the markdown image fires
    // click #1 (opens this lightbox) then click #2 on the now-fullscreen backdrop — without
    // this, dblclick would open then instantly close. Ignore backdrop closes for the first
    // ~250ms after mount so the second click of a dblclick is swallowed.
    const mountedAtRef = useRef(Date.now());

    // ESC closes.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    // Reset state whenever the lightbox opens for a new image.
    useEffect(() => {
        setZoom(1);
        setTx(0);
        setTy(0);
        // Recompute fit once the new image's natural size is known.
        const img = imgRef.current;
        if (img != null && img.complete && img.naturalWidth > 0) {
            fitZoomRef.current = computeFitZoom(img);
        }
    }, [src]);

    // Start at "fit" so a large image doesn't overflow the viewport on open.
    useLayoutEffect(() => {
        const img = imgRef.current;
        if (img == null) {
            return;
        }
        const applyFit = () => {
            const fit = computeFitZoom(img);
            if (fit == null) {
                return;
            }
            fitZoomRef.current = fit;
            setZoom(fit);
            setTx(0);
            setTy(0);
        };
        if (img.complete && img.naturalWidth > 0) {
            applyFit();
        } else {
            img.addEventListener("load", applyFit, { once: true });
            return () => img.removeEventListener("load", applyFit);
        }
    }, [src]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        // preventDefault stops the background page from scrolling while zooming.
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setZoom((prev) => clampZoom(prev * factor));
    }, []);

    const handleDoubleClick = useCallback(() => {
        const fit = fitZoomRef.current;
        const next = fit != null && Math.abs(zoomRef.current - fit) < 0.001 ? 1 : (fit ?? 1);
        setZoom(next);
        // Re-center on toggle.
        setTx(0);
        setTy(0);
    }, []);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button !== 0) {
                return;
            }
            setIsDragging(true);
            dragRef.current = { startX: e.clientX, startY: e.clientY, baseTx: tx, baseTy: ty };
        },
        [tx, ty]
    );

    const handleMouseMove = useCallback(
        (e: React.MouseEvent) => {
            const drag = dragRef.current;
            if (!isDragging || drag == null) {
                return;
            }
            setTx(drag.baseTx + (e.clientX - drag.startX));
            setTy(drag.baseTy + (e.clientY - drag.startY));
        },
        [isDragging]
    );

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        dragRef.current = null;
    }, []);

    // Pan by dragging anywhere on the stage/backdrop (not just the image), but only when
    // zoomed in — at "fit" the whole image is visible, so drag would be a surprising no-op.
    const panEnabled = zoom > 1;

    const handleBackdropClick = () => {
        if (Date.now() - mountedAtRef.current < 250) {
            return;
        }
        onClose();
    };

    return ReactDOM.createPortal(
        <div
            className="image-lightbox"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onDoubleClick={handleDoubleClick}
        >
            <div className="image-lightbox-backdrop" onClick={handleBackdropClick} />
            <button className="image-lightbox-close" title="Close (ESC)" onClick={onClose} aria-label="Close image">
                <i className="fa-sharp fa-solid fa-xmark" />
            </button>
            <div
                className="image-lightbox-stage"
                onMouseDown={panEnabled ? undefined : (e) => e.stopPropagation()}
            >
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt ?? ""}
                    draggable={false}
                    className={clsx("image-lightbox-img", isDragging && "dragging")}
                    style={{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }}
                />
            </div>
        </div>,
        document.getElementById("main") ?? document.body
    );
}