// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import "./copybutton.scss";
import { Button } from "./button";
import { IconButton } from "./iconbutton";
import { makeIconClass } from "@/util/util";

type CopyButtonProps = {
    title: string;
    className?: string;
    /**
     * 返回 Promise 时，只有 resolve 后才给「已复制」反馈；reject 走 onError，
     * 避免复制失败也报一个绿勾（以前没有反馈、或假报成功，都源于此）。
     */
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
    /** 复制失败回调。不传则失败时静默保持原图标（不假装成功）。 */
    onError?: () => void;
    /**
     * 文本按钮形态（如 "Copy for agent"）：渲染「图标 + 文字」的小按钮，
     * 而不是纯 IconButton。不传则维持纯图标形态（既有消费面行为不变）。
     */
    label?: React.ReactNode;
    /** 图标名（makeIconClass）。默认 "copy"；成功后统一换成 "check"。 */
    icon?: string;
};

const CopyButton = ({ title, className, onClick, onError, label, icon }: CopyButtonProps) => {
    const [isCopied, setIsCopied] = useState(false);
    // 懒取形态（onClick 返回 Promise）在 settle 前的 loading 态：图标转圈 + 禁点。
    const [isBusy, setIsBusy] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const markCopied = () => {
        setIsCopied(true);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
            setIsCopied(false);
            timeoutRef.current = null;
        }, 2000);
    };

    const handleOnClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isCopied || isBusy) {
            return;
        }

        let result: void | Promise<unknown>;
        try {
            result = onClick?.(e);
        } catch {
            onError?.();
            return;
        }

        if (result != null && typeof (result as Promise<unknown>).then === "function") {
            setIsBusy(true);
            void (result as Promise<unknown>).then(
                () => {
                    setIsBusy(false);
                    markCopied();
                },
                () => {
                    setIsBusy(false);
                    onError?.();
                }
            );
            return;
        }

        markCopied();
    };

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    if (label != null) {
        return (
            <Button
                title={title}
                aria-label={title}
                className={clsx("copy-button", "ghost", "grey", { copied: isCopied }, className)}
                onClick={handleOnClick}
                disabled={isBusy}
            >
                <i className={makeIconClass(isCopied ? "check" : (icon ?? "copy"), true, { spin: isBusy })} />
                {label}
            </Button>
        );
    }

    return (
        <IconButton
            decl={{
                elemtype: "iconbutton",
                icon: isCopied ? "check" : (icon ?? "copy"),
                iconSpin: isBusy,
                title,
                className: clsx("copy-button", { copied: isCopied }),
                click: handleOnClick,
            }}
            className={className}
        ></IconButton>
    );
};

export { CopyButton };
