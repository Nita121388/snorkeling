// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian Banner 渲染组件。
// 支持 banner 图片显示、垂直位置调节、锁定位置等功能。

import { memo, useCallback, useEffect, useRef, useState } from "react";
import "./banner.scss";

type BannerRendererProps = {
    /** 图片路径或 wikilink */
    banner: string;
    /** 垂直位置 0-1 */
    bannerY: number;
    /** 是否锁定（滚动时固定） */
    bannerLock: boolean;
    /** 基础路径（用于构建完整 URL） */
    baseUrl?: string;
    /** 可选：点击 banner 的回调 */
    onClick?: () => void;
};

export const BannerRenderer = memo(function BannerRenderer({
    banner,
    bannerY,
    bannerLock,
    baseUrl,
    onClick,
}: BannerRendererProps) {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // 解析图片路径（支持 wikilink 和普通路径）
    const imagePath = banner.replace(/^\[\[|\]\]$/g, "");

    // 构建完整路径
    const fullUrl = baseUrl ? `${baseUrl}/${imagePath}` : imagePath;

    // 图片加载处理
    const handleImageLoad = useCallback(() => {
        setImageLoaded(true);
        setImageError(false);
    }, []);

    const handleImageError = useCallback(() => {
        setImageLoaded(false);
        setImageError(true);
    }, []);

    // 滚动处理（仅在锁定模式下）
    useEffect(() => {
        if (!bannerLock || !containerRef.current) {
            return;
        }

        const handleScroll = () => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            // 当 banner 顶部超出视口时，进入折叠状态
            setIsCollapsed(rect.top < 0);
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [bannerLock]);

    // 点击处理（打开图片查看器）
    const handleClick = useCallback(() => {
        if (onClick) {
            onClick();
            return;
        }
        // 默认行为：打开图片查看器
        // 注意：实际使用时需要根据项目配置处理图片路径
        console.log("Banner clicked:", fullUrl);
    }, [onClick, fullUrl]);

    // 计算 banner 高度
    const height = bannerLock && isCollapsed ? 60 : 200;

    return (
        <div
            ref={containerRef}
            className={`snorkeling-banner-container ${bannerLock ? "locked" : ""} ${
                isCollapsed ? "collapsed" : ""
            }`}
            style={{
                "--banner-height": `${height}px`,
                "--banner-y": `${bannerY * 100}%`,
            } as React.CSSProperties}
            onClick={handleClick}
        >
            {/* 图片容器 */}
            <div className="snorkeling-banner-image-wrapper">
                {!imageError && (
                    <img
                        className={`snorkeling-banner-image ${imageLoaded ? "loaded" : "loading"}`}
                        src={fullUrl}
                        alt="Banner"
                        onLoad={handleImageLoad}
                        onError={handleImageError}
                        draggable={false}
                    />
                )}
                {imageError && (
                    <div className="snorkeling-banner-placeholder">
                        <i className="fa fa-image" />
                        <span>无法加载图片</span>
                    </div>
                )}
            </div>

            {/* 渐变遮罩 */}
            <div className="snorkeling-banner-overlay" />

            {/* 锁定指示器 */}
            {bannerLock && (
                <div className="snorkeling-banner-lock-indicator">
                    <i className="fa fa-lock" />
                </div>
            )}
        </div>
    );
});

// 导出样式类名常量，便于外部使用
export const BannerClassNames = {
    container: "snorkeling-banner-container",
    imageWrapper: "snorkeling-banner-image-wrapper",
    image: "snorkeling-banner-image",
    overlay: "snorkeling-banner-overlay",
    placeholder: "snorkeling-banner-placeholder",
    lockIndicator: "snorkeling-banner-lock-indicator",
};
