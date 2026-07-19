// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useId, useRef } from "react";
import { cn } from "@/util/util";
import "./toggle.scss";

interface ToggleProps {
    checked: boolean;
    onChange: (value: boolean) => void;
    label?: string;
    id?: string;
    className?: string;
    disabled?: boolean;
    error?: boolean;
}

const Toggle = ({ checked, onChange, label, id, className, disabled = false, error = false }: ToggleProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const generatedId = useId();

    const handleChange = (e: any) => {
        if (!disabled && onChange != null) {
            onChange(e.target.checked);
        }
    };

    const handleLabelClick = () => {
        if (!disabled && inputRef.current) {
            inputRef.current.click();
        }
    };

    const inputId = id ?? `toggle-${generatedId}`;

    return (
        <div className={cn("check-toggle-wrapper", className, { disabled, error })}>
            <label htmlFor={inputId} className="checkbox-toggle">
                <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={handleChange}
                    ref={inputRef}
                    disabled={disabled}
                    aria-invalid={error || undefined}
                />
                <span className="slider" />
            </label>
            {label && (
                <span className="toggle-label" onClick={handleLabelClick}>
                    {label}
                </span>
            )}
        </div>
    );
};

export { Toggle };
