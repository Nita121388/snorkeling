// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { AgentAccessSettingsContent } from "@/app/view/waveconfig/agentaccesssettings";
import { AgentNotifySettingsContent } from "@/app/view/waveconfig/agentnotifysettings";
import { AIPromptsVisualContent } from "@/app/view/waveconfig/aipromptsettings";
import { HeroSettingsContent } from "@/app/view/waveconfig/herosettings";
import { LocalePickerContent } from "@/app/view/waveconfig/localepicker";
import { SecretsContent } from "@/app/view/waveconfig/secretscontent";
import { SyncSettingsContent } from "@/app/view/waveconfig/syncsettings";
import { ThemePickerContent } from "@/app/view/waveconfig/themepicker";
import { WaveAIVisualContent } from "@/app/view/waveconfig/waveaivisual";
import { WaveConfigView } from "@/app/view/waveconfig/waveconfig";
import { describeJsonFailure, type WaveConfigSaveFailure } from "@/app/view/waveconfig/waveconfig-json-error";
import { applyVisibleSettingsDefaults } from "@/app/view/waveconfig/waveconfig-settings";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { i18n } from "@/i18n/config";
import { localeTextAtom } from "@/i18n/i18nmodel";
import { fileInfoRequest } from "@/util/fileinfo";
import { base64ToString, stringToBase64 } from "@/util/util";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as React from "react";

type ValidationResult = { success: true } | { error: string };
type ConfigValidator = (parsed: any) => ValidationResult;

/**
 * Config-file ids — the i18n key namespace for their sidebar name / description.
 *
 * Pattern C: the registry holds structural keys only, the sidebar translates them at render
 * time (`waveconfig.tsx`). Keeping display strings in the registry would freeze them to whatever
 * locale was active when `makeConfigFiles()` ran.
 */
export const ConfigFileIds = [
    "general",
    "appTheme",
    "language",
    "agentNotifications",
    "agentAccess",
    "sync",
    "hero",
    "connections",
    "sidebarWidgets",
    "waveAiModes",
    "aiPrompts",
    "tabBackgrounds",
    "secrets",
    "presets",
    "aiPresets",
] as const;
export type ConfigFileId = (typeof ConfigFileIds)[number];

/** Ids that carry a description line in the sidebar (their keys must exist in en/zh). */
export const ConfigFileDescribedIds = [
    "appTheme",
    "language",
    "agentNotifications",
    "agentAccess",
    "sync",
    "hero",
    "connections",
    "waveAiModes",
    "aiPrompts",
] as const;

export type ConfigFileNameKey = `waveconfig:files.${ConfigFileId}.name`;
export type ConfigFileDescriptionKey =
    | `waveconfig:files.${(typeof ConfigFileDescribedIds)[number]}.description`
    | "waveconfig:files.connections.descriptionWindows";

export type ConfigFile = {
    /** i18n key for the sidebar name (translated at render time). */
    nameKey: ConfigFileNameKey;
    path: string;
    language?: string;
    deprecated?: boolean;
    /** i18n key for the sidebar description line (translated at render time). */
    descKey?: ConfigFileDescriptionKey;
    docsUrl?: string;
    validator?: ConfigValidator;
    isSecrets?: boolean;
    hasJsonView?: boolean;
    visualComponent?: React.ComponentType<{ model: WaveConfigViewModel }>;
};

export const SecretNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

function validateAiJson(parsed: any): ValidationResult {
    const keys = Object.keys(parsed);
    for (const key of keys) {
        if (!key.startsWith("ai@")) {
            return { error: i18n.t("waveconfig:model.invalidAiKeyPrefix", { key }) };
        }
    }
    return { success: true };
}

function validateWaveAiJson(parsed: any): ValidationResult {
    const keys = Object.keys(parsed);
    const keyPattern = /^[a-zA-Z0-9_@.-]+$/;
    for (const key of keys) {
        if (!keyPattern.test(key)) {
            return { error: i18n.t("waveconfig:model.invalidKeyChars", { key }) };
        }
    }
    return { success: true };
}

function makeConfigFiles(isWindows: boolean): ConfigFile[] {
    return [
        {
            nameKey: "waveconfig:files.general.name",
            path: "settings.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/config",
            hasJsonView: true,
        },
        {
            nameKey: "waveconfig:files.appTheme.name",
            path: "apptheme",
            descKey: "waveconfig:files.appTheme.description",
            hasJsonView: false,
            visualComponent: ThemePickerContent,
        },
        {
            nameKey: "waveconfig:files.language.name",
            path: "uilocale",
            descKey: "waveconfig:files.language.description",
            hasJsonView: false,
            visualComponent: LocalePickerContent,
        },
        {
            nameKey: "waveconfig:files.agentNotifications.name",
            path: "agentnotifications",
            descKey: "waveconfig:files.agentNotifications.description",
            hasJsonView: false,
            visualComponent: AgentNotifySettingsContent,
        },
        {
            nameKey: "waveconfig:files.agentAccess.name",
            path: "agentaccess",
            descKey: "waveconfig:files.agentAccess.description",
            hasJsonView: false,
            visualComponent: AgentAccessSettingsContent,
        },
        {
            // Common Text cloud sync lives here rather than in its own modal: this is the app's
            // single settings surface, and a second shell would drift from it.
            nameKey: "waveconfig:files.sync.name",
            path: "commontextsync",
            descKey: "waveconfig:files.sync.description",
            hasJsonView: false,
            visualComponent: SyncSettingsContent,
        },
        {
            // A5.5: the hero home base lives on a configurable root, so the panel that moves it,
            // measures it and caps its growth belongs on this surface next to Sync — both answer
            // "what of this leaves the machine?".
            nameKey: "waveconfig:files.hero.name",
            path: "herosettings",
            descKey: "waveconfig:files.hero.description",
            hasJsonView: false,
            visualComponent: HeroSettingsContent,
        },
        {
            nameKey: "waveconfig:files.connections.name",
            path: "connections.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/connections",
            descKey: isWindows
                ? "waveconfig:files.connections.descriptionWindows"
                : "waveconfig:files.connections.description",
            hasJsonView: true,
        },
        {
            nameKey: "waveconfig:files.sidebarWidgets.name",
            path: "widgets.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/customwidgets",
            hasJsonView: true,
        },
        {
            nameKey: "waveconfig:files.waveAiModes.name",
            path: "waveai.json",
            language: "json",
            descKey: "waveconfig:files.waveAiModes.description",
            docsUrl: "https://docs.waveterm.dev/waveai-modes",
            validator: validateWaveAiJson,
            hasJsonView: true,
            visualComponent: WaveAIVisualContent,
        },
        {
            nameKey: "waveconfig:files.aiPrompts.name",
            path: "aiprompts.json",
            language: "json",
            descKey: "waveconfig:files.aiPrompts.description",
            hasJsonView: true,
            visualComponent: AIPromptsVisualContent,
        },
        {
            nameKey: "waveconfig:files.tabBackgrounds.name",
            path: "backgrounds.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/tab-backgrounds",
            hasJsonView: true,
        },
        {
            nameKey: "waveconfig:files.secrets.name",
            path: "secrets",
            isSecrets: true,
            hasJsonView: false,
            visualComponent: SecretsContent,
        },
    ];
}

const deprecatedConfigFiles: ConfigFile[] = [
    {
        nameKey: "waveconfig:files.presets.name",
        path: "presets.json",
        language: "json",
        deprecated: true,
        hasJsonView: true,
    },
    {
        nameKey: "waveconfig:files.aiPresets.name",
        path: "presets/ai.json",
        language: "json",
        deprecated: true,
        docsUrl: "https://docs.waveterm.dev/ai-presets",
        validator: validateAiJson,
        hasJsonView: true,
    },
];

export class WaveConfigViewModel implements ViewModel {
    blockId: string;
    viewType = "waveconfig";
    viewIcon = atom("gear");
    viewName = localeTextAtom(() => i18n.t("waveconfig:header.viewName"));
    viewComponent = WaveConfigView;
    noPadding = atom(true);
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveConfigEnv;

    selectedFileAtom: PrimitiveAtom<ConfigFile>;
    fileContentAtom: PrimitiveAtom<string>;
    originalContentAtom: PrimitiveAtom<string>;
    hasEditedAtom: PrimitiveAtom<boolean>;
    isLoadingAtom: PrimitiveAtom<boolean>;
    isSavingAtom: PrimitiveAtom<boolean>;
    errorMessageAtom: PrimitiveAtom<string>;
    validationErrorAtom: PrimitiveAtom<string>;
    /** 保存校验失败的细节（行列/片段），Copy for Agent 的数据源。 */
    saveFailureAtom: PrimitiveAtom<WaveConfigSaveFailure | null>;
    isMenuOpenAtom: PrimitiveAtom<boolean>;
    presetsJsonExistsAtom: PrimitiveAtom<boolean>;
    activeTabAtom: PrimitiveAtom<"visual" | "json">;
    configErrorFilesAtom: Atom<Set<string>>;
    configDir: string;
    saveShortcut: string;
    editorRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    secretNamesAtom: PrimitiveAtom<string[]>;
    selectedSecretAtom: PrimitiveAtom<string | null>;
    secretValueAtom: PrimitiveAtom<string>;
    secretShownAtom: PrimitiveAtom<boolean>;
    isAddingNewAtom: PrimitiveAtom<boolean>;
    newSecretNameAtom: PrimitiveAtom<string>;
    newSecretValueAtom: PrimitiveAtom<string>;
    storageBackendErrorAtom: PrimitiveAtom<string | null>;
    secretValueRef: HTMLTextAreaElement | null = null;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv as WaveConfigEnv;
        this.configDir = this.env.electron.getConfigDir();
        const platform = this.env.electron.getPlatform();
        this.saveShortcut = platform === "darwin" ? "Cmd+S" : "Alt+S";

        this.selectedFileAtom = atom(null) as PrimitiveAtom<ConfigFile>;
        this.fileContentAtom = atom("");
        this.originalContentAtom = atom("");
        this.hasEditedAtom = atom(false);
        this.isLoadingAtom = atom(false);
        this.isSavingAtom = atom(false);
        this.errorMessageAtom = atom(null) as PrimitiveAtom<string>;
        this.validationErrorAtom = atom(null) as PrimitiveAtom<string>;
        this.saveFailureAtom = atom(null) as PrimitiveAtom<WaveConfigSaveFailure | null>;
        this.isMenuOpenAtom = atom(false);
        this.presetsJsonExistsAtom = atom(false);
        this.activeTabAtom = atom<"visual" | "json">("visual");
        this.configErrorFilesAtom = atom((get) => {
            const fullConfig = get(this.env.atoms.fullConfigAtom);
            const errorSet = new Set<string>();
            for (const cerr of fullConfig?.configerrors ?? []) {
                errorSet.add(cerr.file);
            }
            return errorSet;
        });
        this.editorRef = React.createRef();

        this.secretNamesAtom = atom<string[]>([]);
        this.selectedSecretAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
        this.secretValueAtom = atom<string>("");
        this.secretShownAtom = atom<boolean>(false);
        this.isAddingNewAtom = atom<boolean>(false);
        this.newSecretNameAtom = atom<string>("");
        this.newSecretValueAtom = atom<string>("");
        this.storageBackendErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

        this.checkPresetsJsonExists();
        this.initialize();
    }

    async checkPresetsJsonExists() {
        try {
            const fullPath = `${this.configDir}/presets.json`;
            const fileInfo = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                info: fileInfoRequest(fullPath),
            });
            if (!fileInfo.notfound) {
                globalStore.set(this.presetsJsonExistsAtom, true);
            }
        } catch {
            // File doesn't exist
        }
    }

    initialize() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile) {
            const metaFileAtom = this.env.getBlockMetaKeyAtom(this.blockId, "file");
            const savedFilePath = globalStore.get(metaFileAtom);
            const configFiles = this.getConfigFiles();
            const deprecatedConfigFiles = this.getDeprecatedConfigFiles();

            let fileToLoad: ConfigFile | null = null;
            if (savedFilePath) {
                fileToLoad =
                    configFiles.find((f) => f.path === savedFilePath) ||
                    deprecatedConfigFiles.find((f) => f.path === savedFilePath) ||
                    null;
            }

            if (!fileToLoad) {
                fileToLoad = configFiles[0];
            }

            if (fileToLoad) {
                this.loadFile(fileToLoad);
            }
        }
    }

    getConfigFiles(): ConfigFile[] {
        return makeConfigFiles(this.env.isWindows());
    }

    getDeprecatedConfigFiles(): ConfigFile[] {
        const presetsJsonExists = globalStore.get(this.presetsJsonExistsAtom);
        return deprecatedConfigFiles.filter((f) => {
            if (f.path === "presets.json") {
                return presetsJsonExists;
            }
            return true;
        });
    }

    hasChanges(): boolean {
        return globalStore.get(this.hasEditedAtom);
    }

    confirmDiscardChanges(): boolean {
        if (!this.hasChanges()) {
            return true;
        }
        return window.confirm(i18n.t("waveconfig:model.discardConfirm"));
    }

    discardChanges() {
        const originalContent = globalStore.get(this.originalContentAtom);
        globalStore.set(this.fileContentAtom, originalContent);
        globalStore.set(this.hasEditedAtom, false);
        globalStore.set(this.validationErrorAtom, null);
        globalStore.set(this.errorMessageAtom, null);
    }

    markAsEdited() {
        globalStore.set(this.hasEditedAtom, true);
    }

    async loadFile(file: ConfigFile) {
        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);
        globalStore.set(this.hasEditedAtom, false);

        if (file.isSecrets) {
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
            globalStore.set(this.isLoadingAtom, false);
            this.checkStorageBackend();
            this.refreshSecrets();
            return;
        }

        if (!file.hasJsonView) {
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
            globalStore.set(this.fileContentAtom, "");
            globalStore.set(this.originalContentAtom, "");
            globalStore.set(this.isLoadingAtom, false);
            return;
        }

        try {
            const fullPath = `${this.configDir}/${file.path}`;
            const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                info: fileInfoRequest(fullPath),
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            const visibleContent = applyVisibleSettingsDefaults(file.path, content);
            globalStore.set(this.originalContentAtom, content);
            if (visibleContent.content.trim() === "") {
                globalStore.set(this.fileContentAtom, "{\n\n}");
            } else {
                globalStore.set(this.fileContentAtom, visibleContent.content);
            }
            globalStore.set(this.hasEditedAtom, visibleContent.changed);
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
        } catch (err) {
            globalStore.set(
                this.errorMessageAtom,
                i18n.t("waveconfig:model.loadFailed", { name: i18n.t(file.nameKey), error: err.message || String(err) })
            );
            globalStore.set(this.fileContentAtom, "");
            globalStore.set(this.originalContentAtom, "");
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async saveFile() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile) return;

        const fileContent = globalStore.get(this.fileContentAtom);

        if (fileContent.trim() === "") {
            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${selectedFile.path}`;
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: fileInfoRequest(fullPath),
                    data64: stringToBase64(""),
                });
                globalStore.set(this.fileContentAtom, "");
                globalStore.set(this.originalContentAtom, "");
                globalStore.set(this.hasEditedAtom, false);
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    i18n.t("waveconfig:model.saveFailed", {
                        name: i18n.t(selectedFile.nameKey),
                        error: err.message || String(err),
                    })
                );
            } finally {
                globalStore.set(this.isSavingAtom, false);
            }
            return;
        }

        try {
            const parsed = JSON.parse(fileContent);

            if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
                this.setValidationFailure(i18n.t("waveconfig:model.jsonMustBeObject"));
                return;
            }

            if (selectedFile.validator) {
                const validationResult = selectedFile.validator(parsed);
                if ("error" in validationResult) {
                    this.setValidationFailure(validationResult.error);
                    return;
                }
            }

            const formatted = JSON.stringify(parsed, null, 2);

            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${selectedFile.path}`;
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: fileInfoRequest(fullPath),
                    data64: stringToBase64(formatted),
                });
                globalStore.set(this.fileContentAtom, formatted);
                globalStore.set(this.originalContentAtom, formatted);
                globalStore.set(this.hasEditedAtom, false);
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    i18n.t("waveconfig:model.saveFailed", {
                        name: i18n.t(selectedFile.nameKey),
                        error: err.message || String(err),
                    })
                );
            } finally {
                globalStore.set(this.isSavingAtom, false);
            }
        } catch (err) {
            this.setValidationFailure(i18n.t("waveconfig:model.invalidJson", { error: err.message || String(err) }));
        }
    }

    clearError() {
        globalStore.set(this.errorMessageAtom, null);
    }

    clearValidationError() {
        globalStore.set(this.validationErrorAtom, null);
        globalStore.set(this.saveFailureAtom, null);
    }

    /** 统一出口：设置校验错误时同步收集可复制细节（行列/片段），别的地方不重复拼。 */
    private setValidationFailure(message: string) {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        const fileContent = globalStore.get(this.fileContentAtom);
        globalStore.set(this.validationErrorAtom, message);
        globalStore.set(
            this.saveFailureAtom,
            describeJsonFailure(`${this.configDir}/${selectedFile?.path ?? "(unknown)"}`, message, fileContent)
        );
    }

    async checkStorageBackend() {
        try {
            const backend = await this.env.rpc.GetSecretsLinuxStorageBackendCommand(TabRpcClient);
            if (backend === "basic_text" || backend === "unknown") {
                globalStore.set(this.storageBackendErrorAtom, i18n.t("waveconfig:model.storageBackendUnavailable"));
            } else {
                globalStore.set(this.storageBackendErrorAtom, null);
            }
        } catch (error) {
            globalStore.set(
                this.storageBackendErrorAtom,
                i18n.t("waveconfig:model.storageBackendError", { error: error.message })
            );
        }
    }

    async refreshSecrets() {
        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            const names = await this.env.rpc.GetSecretsNamesCommand(TabRpcClient);
            globalStore.set(this.secretNamesAtom, names || []);
        } catch (error) {
            globalStore.set(
                this.errorMessageAtom,
                i18n.t("waveconfig:model.secretsListFailed", { error: error.message })
            );
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async viewSecret(name: string) {
        globalStore.set(this.errorMessageAtom, null);
        globalStore.set(this.selectedSecretAtom, name);
        globalStore.set(this.secretShownAtom, false);
        globalStore.set(this.secretValueAtom, "");
    }

    closeSecretView() {
        globalStore.set(this.selectedSecretAtom, null);
        globalStore.set(this.secretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    async showSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);
        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            const secrets = await this.env.rpc.GetSecretsCommand(TabRpcClient, [selectedSecret]);
            const value = secrets[selectedSecret];
            if (value !== undefined) {
                globalStore.set(this.secretValueAtom, value);
                globalStore.set(this.secretShownAtom, true);
            } else {
                globalStore.set(
                    this.errorMessageAtom,
                    i18n.t("waveconfig:model.secretNotFound", { name: selectedSecret })
                );
            }
        } catch (error) {
            globalStore.set(
                this.errorMessageAtom,
                i18n.t("waveconfig:model.secretLoadFailed", { error: error.message })
            );
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async saveSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);
        const secretValue = globalStore.get(this.secretValueAtom);

        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [selectedSecret]: secretValue });
            this.env.rpc.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveconfig:savesecret",
                    },
                },
                { noresponse: true }
            );
            this.closeSecretView();
        } catch (error) {
            globalStore.set(
                this.errorMessageAtom,
                i18n.t("waveconfig:model.secretSaveFailed", { error: error.message })
            );
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async deleteSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);

        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [selectedSecret]: null });
            this.closeSecretView();
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(
                this.errorMessageAtom,
                i18n.t("waveconfig:model.secretDeleteFailed", { error: error.message })
            );
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    startAddingSecret() {
        globalStore.set(this.isAddingNewAtom, true);
        globalStore.set(this.newSecretNameAtom, "");
        globalStore.set(this.newSecretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    cancelAddingSecret() {
        globalStore.set(this.isAddingNewAtom, false);
        globalStore.set(this.newSecretNameAtom, "");
        globalStore.set(this.newSecretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    async addNewSecret() {
        const name = globalStore.get(this.newSecretNameAtom).trim();
        const value = globalStore.get(this.newSecretValueAtom);

        if (!name) {
            globalStore.set(this.errorMessageAtom, i18n.t("waveconfig:model.secretNameEmpty"));
            return;
        }

        if (!SecretNameRegex.test(name)) {
            globalStore.set(this.errorMessageAtom, i18n.t("waveconfig:model.secretNameInvalid"));
            return;
        }

        const existingNames = globalStore.get(this.secretNamesAtom);
        if (existingNames.includes(name)) {
            globalStore.set(this.errorMessageAtom, i18n.t("waveconfig:model.secretExists", { name }));
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [name]: value });
            this.env.rpc.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveconfig:savesecret",
                    },
                },
                { noresponse: true }
            );
            globalStore.set(this.isAddingNewAtom, false);
            globalStore.set(this.newSecretNameAtom, "");
            globalStore.set(this.newSecretValueAtom, "");
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(
                this.errorMessageAtom,
                i18n.t("waveconfig:model.secretAddFailed", { error: error.message })
            );
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    giveFocus(): boolean {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (selectedFile?.isSecrets && this.secretValueRef) {
            this.secretValueRef.focus();
            return true;
        }
        if (this.editorRef?.current) {
            this.editorRef.current.focus();
            return true;
        }
        return false;
    }
}
