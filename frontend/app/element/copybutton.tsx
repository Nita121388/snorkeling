// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import "./copybutton.scss";
import { IconButton } from "./iconbutton";

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
};

const CopyButton = ({ title, className, onClick, onError }: CopyButtonProps) => {
    const [isCopied, setIsCopied] = useState(false);
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
        if (isCopied) {
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
            void (result as Promise<unknown>).then(
                () => markCopied(),
                () => onError?.()
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

    return (
        <IconButton
            decl={{
                elemtype: "iconbutton",
                icon: isCopied ? "check" : "copy",
                title,
                className: clsx("copy-button", { copied: isCopied }),
                click: handleOnClick,
            }}
            className={className}
        ></IconButton>
    );
};

export { CopyButton };
