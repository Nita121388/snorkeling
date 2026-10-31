// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 外部会话根（AI Sessions origin）管理弹窗。
//
// 写入 settings.json 的 `ai:sessions:externalorigins`，每项 { label, path, source,
// readonly }。外部根默认只读（防止误改/误删另一台机器的历史数据），这里也允许显式
// 关闭只读（readonly=false）——但那需要用户主动勾选，默认保持只读。

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";

type EditRow = {
    label: string;
    path: string;
    readonly: boolean;
};

function rowsFromSettings(settings: SettingsType | undefined): EditRow[] {
    const items = settings?.["ai:sessions:externalorigins"] ?? [];
    return items.map((item) => ({
        label: item.label ?? "",
        path: item.path ?? "",
        readonly: item.readonly !== false,
    }));
}

export interface EditOriginsModalProps {
    /** 保存成功后回调（通常用来重新拉取 origins 列表）。 */
    onSaved?: () => void;
}

function EditOriginsModal({ onSaved }: EditOriginsModalProps) {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const initial = useMemo(() => rowsFromSettings(fullConfig?.settings), [fullConfig?.settings]);
    const [rows, setRows] = useState<EditRow[]>(initial);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    const updateRow = (index: number, patch: Partial<EditRow>) => {
        setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    };

    const removeRow = (index: number) => {
        setRows((current) => current.filter((_, i) => i !== index));
    };

    const addRow = () => {
        setRows((current) => [...current, { label: "", path: "", readonly: true }]);
    };

    const save = async () => {
        const cleaned = rows.filter((row) => row.path.trim() !== "");
        const missingLabel = cleaned.find((row) => row.label.trim() === "");
        if (missingLabel != null) {
            setError("Every origin needs a label.");
            return;
        }
        setSaving(true);
        setError("");
        try {
            const payload = cleaned.map((row) => ({
                label: row.label.trim(),
                path: row.path.trim(),
                source: "pi",
                readonly: row.readonly,
            }));
            await RpcApi.SetConfigCommand(TabRpcClient, {
                "ai:sessions:externalorigins": payload,
            } as SettingsType);
            modalsModel.popModal();
            onSaved?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            className="pt-6 pb-4 px-5"
            onOk={() => fireAndForget(save)}
            okLabel={saving ? "Saving…" : "Save"}
            onCancel={() => modalsModel.popModal()}
            onClose={() => modalsModel.popModal()}
        >
            <div className="mx-4 pb-3 font-bold text-primary">External session origins</div>
            <div className="mx-4 mb-3 max-w-[640px] text-[12px] text-secondary">
                Point at another machine's session dump (e.g. a Pi session library copied from a Windows
                machine). Imported origins are read-only by default.
            </div>
            <div className="mx-4 mb-3 flex max-h-[45vh] max-w-[640px] flex-col gap-2 overflow-y-auto">
                {rows.length === 0 ? (
                    <div className="rounded border border-border/60 px-3 py-4 text-center text-[12px] text-secondary">
                        No external origins yet.
                    </div>
                ) : null}
                {rows.map((row, index) => (
                    <div
                        key={index}
                        className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-surface/60 p-2"
                    >
                        <div className="flex items-center gap-2">
                            <input
                                className="h-7 min-w-0 flex-1 rounded border border-border/60 bg-background px-2 text-[12px] outline-none focus:border-accent"
                                placeholder="Label (shown in the switcher)"
                                value={row.label}
                                onChange={(e) => updateRow(index, { label: e.target.value })}
                            />
                            <label className="flex shrink-0 items-center gap-1 text-[11px] text-secondary">
                                <input
                                    type="checkbox"
                                    checked={row.readonly}
                                    onChange={(e) => updateRow(index, { readonly: e.target.checked })}
                                />
                                read-only
                            </label>
                            <Button
                                className="shrink-0 px-2 py-1"
                                onClick={() => removeRow(index)}
                                title="Remove origin"
                            >
                                Remove
                            </Button>
                        </div>
                        <input
                            className="h-7 w-full rounded border border-border/60 bg-background px-2 font-mono text-[12px] outline-none focus:border-accent"
                            placeholder="/path/to/dump (e.g. ~/Primary/MyData/pi)"
                            value={row.path}
                            onChange={(e) => updateRow(index, { path: e.target.value })}
                        />
                    </div>
                ))}
            </div>
            <div className="mx-4 mb-3 max-w-[640px]">
                <Button onClick={addRow} className="px-2.5 py-1">
                    + Add folder
                </Button>
            </div>
            {error ? <div className="mx-4 mb-2 text-[12px] text-error">{error}</div> : null}
        </Modal>
    );
}

EditOriginsModal.displayName = "EditOriginsModal";

export { EditOriginsModal };
