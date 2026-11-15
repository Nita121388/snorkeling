// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SecretNameRegex, type WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface ErrorDisplayProps {
    message: string;
    variant?: "error" | "warning";
}

const ErrorDisplay = memo(({ message, variant = "error" }: ErrorDisplayProps) => {
    const icon = variant === "error" ? "fa-circle-exclamation" : "fa-triangle-exclamation";
    const baseClasses = "flex items-center gap-2 p-4 border rounded-lg";
    const variantClasses =
        variant === "error" ? "bg-error/10 border-error/20 text-error" : "bg-warning/10 border-warning/20 text-warning";

    return (
        <div className={`${baseClasses} ${variantClasses}`}>
            <i className={`fa-sharp fa-solid ${icon}`} />
            <span>{message}</span>
        </div>
    );
});
ErrorDisplay.displayName = "ErrorDisplay";

const LoadingSpinner = memo(({ message }: { message: string }) => {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
            <i className="fa-sharp fa-solid fa-spinner fa-spin text-2xl text-secondary" />
            <span className="text-secondary">{message}</span>
        </div>
    );
});
LoadingSpinner.displayName = "LoadingSpinner";

const EmptyState = memo(({ onAddSecret }: { onAddSecret: () => void }) => {
    const { t } = useTranslation("waveconfig");
    return (
        <div className="flex flex-col items-center justify-center gap-4 py-12 h-full bg-panel rounded-lg">
            <i className="fa-sharp fa-solid fa-key text-4xl text-muted" />
            <h3 className="text-lg font-semibold text-secondary">{t("waveconfig:secrets.emptyTitle")}</h3>
            <p className="text-muted">{t("waveconfig:secrets.emptyHint")}</p>
            <button
                className="flex items-center gap-2 px-4 py-2 bg-action text-actiontext hover:bg-actionhover rounded cursor-pointer transition-colors"
                onClick={onAddSecret}
            >
                <i className="fa-sharp fa-solid fa-plus" />
                <span className="font-medium">{t("waveconfig:secrets.addNewSecret")}</span>
            </button>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

const CLIInfoBubble = memo(() => {
    const { t } = useTranslation("waveconfig");
    return (
        <div className="flex flex-col gap-2 p-4 m-4 bg-panel rounded-lg">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-terminal text-secondary" />
                <div className="text-sm font-medium text-primary">{t("waveconfig:secrets.cliAccess")}</div>
            </div>
            <div className="font-mono text-xs bg-surface-strong px-3 py-2 rounded leading-relaxed text-secondary">
                wsh secret list
                <br />
                wsh secret get [name]
                <br />
                wsh secret set [name]=[value]
            </div>
        </div>
    );
});
CLIInfoBubble.displayName = "CLIInfoBubble";

interface SecretListViewProps {
    secretNames: string[];
    onSelectSecret: (name: string) => void;
    onAddSecret: () => void;
}

const SecretListView = memo(({ secretNames, onSelectSecret, onAddSecret }: SecretListViewProps) => {
    const { t } = useTranslation("waveconfig");
    return (
        <div className="flex flex-col h-full w-full rounded-lg">
            <div className="flex flex-col divide-y divide-border">
                {secretNames.map((name) => (
                    <div
                        key={name}
                        className={cn("flex items-center gap-3 p-4 hover:bg-hover cursor-pointer transition-colors")}
                        onClick={() => onSelectSecret(name)}
                    >
                        <i className="fa-sharp fa-solid fa-key text-accent" />
                        <span className="flex-1 font-mono">{name}</span>
                        <i className="fa-sharp fa-solid fa-chevron-right text-muted text-sm" />
                    </div>
                ))}
                <div
                    className={cn(
                        "flex items-center justify-center gap-2 p-4 hover:bg-hover cursor-pointer transition-colors border-t-2 border-border"
                    )}
                    onClick={onAddSecret}
                >
                    <i className="fa-sharp fa-solid fa-plus text-accent" />
                    <span className="font-medium text-accent">{t("waveconfig:secrets.addNewSecret")}</span>
                </div>
            </div>
            <CLIInfoBubble />
        </div>
    );
});
SecretListView.displayName = "SecretListView";

interface AddSecretFormProps {
    newSecretName: string;
    newSecretValue: string;
    isLoading: boolean;
    onNameChange: (name: string) => void;
    onValueChange: (value: string) => void;
    onCancel: () => void;
    onSubmit: () => void;
}

const AddSecretForm = memo(
    ({
        newSecretName,
        newSecretValue,
        isLoading,
        onNameChange,
        onValueChange,
        onCancel,
        onSubmit,
    }: AddSecretFormProps) => {
        const { t } = useTranslation("waveconfig");
        const isNameInvalid = newSecretName !== "" && !SecretNameRegex.test(newSecretName);

        return (
            <div className="flex flex-col gap-4 min-h-full p-6 bg-panel rounded-lg">
                <h3 className="text-lg font-semibold">{t("waveconfig:secrets.addNewSecret")}</h3>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("waveconfig:secrets.secretName")}</label>
                    <input
                        type="text"
                        className={cn(
                            "px-3 py-2 bg-surface border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                            isNameInvalid ? "border-error focus:border-error" : "border-border focus:border-accent"
                        )}
                        value={newSecretName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="MY_SECRET_NAME"
                        disabled={isLoading}
                    />
                    <div className="text-xs text-secondary">
                        {t("waveconfig:secrets.nameRule")}
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("waveconfig:secrets.secretValue")}</label>
                    <textarea
                        className="px-3 py-2 bg-surface border border-border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus:border-accent font-mono text-sm"
                        value={newSecretValue}
                        onChange={(e) => onValueChange(e.target.value)}
                        placeholder={t("waveconfig:secrets.valuePlaceholder")}
                        disabled={isLoading}
                        rows={4}
                    />
                </div>
                <div className="flex gap-2 justify-end">
                    <button
                        className="px-4 py-2 bg-surface border border-border text-primary hover:bg-hover rounded cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        onClick={onCancel}
                        disabled={isLoading}
                    >
                        {t("common:common.cancel")}
                    </button>
                    <button
                        className="px-4 py-2 bg-action text-actiontext hover:bg-actionhover rounded cursor-pointer disabled:opacity-50 disabled:cursor-default flex items-center gap-2"
                        onClick={onSubmit}
                        disabled={isLoading || isNameInvalid || newSecretName.trim() === ""}
                    >
                        {isLoading ? (
                            <>
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                {t("waveconfig:secrets.adding")}
                            </>
                        ) : (
                            t("waveconfig:secrets.addSecret")
                        )}
                    </button>
                </div>
            </div>
        );
    }
);
AddSecretForm.displayName = "AddSecretForm";

interface SecretDetailViewProps {
    model: WaveConfigViewModel;
}

const SecretDetailView = memo(({ model }: SecretDetailViewProps) => {
    const { t } = useTranslation("waveconfig");
    const secretName = useAtomValue(model.selectedSecretAtom);
    const secretValue = useAtomValue(model.secretValueAtom);
    const secretShown = useAtomValue(model.secretShownAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const setSecretValue = useSetAtom(model.secretValueAtom);

    if (!secretName) {
        return null;
    }

    return (
        <div className="flex flex-col gap-4 min-h-full p-6 bg-panel rounded-lg">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-key text-accent" />
                <h3 className="text-lg font-semibold">{secretName}</h3>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">{t("waveconfig:secrets.secretValue")}</label>
                <textarea
                    ref={(ref) => {
                        model.secretValueRef = ref;
                        if (ref) {
                            ref.focus();
                        }
                    }}
                    className="px-3 py-2 bg-surface border border-border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus:border-accent font-mono text-sm"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            model.closeSecretView();
                        }
                    }}
                    disabled={isLoading}
                    rows={6}
                    placeholder={!secretShown ? t("waveconfig:secrets.newValuePlaceholder") : ""}
                />
                {!secretShown && (
                    <div className="text-sm text-secondary">
                        {t("waveconfig:secrets.notShownNote")}{" "}
                        {isLoading ? (
                            <span className="text-muted">
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" /> {t("common:common.loading")}
                            </span>
                        ) : (
                            <button
                                className="text-accent underline hover:text-accenthover cursor-pointer disabled:opacity-50 disabled:cursor-default"
                                onClick={() => model.showSecret()}
                                disabled={isLoading}
                            >
                                {t("waveconfig:secrets.showSecret")}
                            </button>
                        )}
                    </div>
                )}
            </div>
            <div className="flex gap-2 justify-between">
                <button
                    className="px-4 py-2 bg-error hover:bg-error/90 text-primary rounded cursor-pointer disabled:opacity-50 disabled:cursor-default flex items-center gap-2"
                    onClick={() => model.deleteSecret()}
                    disabled={isLoading}
                    title={t("waveconfig:secrets.deleteThisSecret")}
                >
                    {isLoading ? (
                        <>
                            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            {t("waveconfig:secrets.deleting")}
                        </>
                    ) : (
                        <>
                            <i className="fa-sharp fa-solid fa-trash" />
                            {t("common:common.delete")}
                        </>
                    )}
                </button>
                <div className="flex gap-2">
                    <button
                        className="px-4 py-2 bg-surface border border-border text-primary hover:bg-hover rounded cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        onClick={() => model.closeSecretView()}
                        disabled={isLoading}
                    >
                        {t("common:common.cancel")}
                    </button>
                    <button
                        className="px-4 py-2 bg-action text-actiontext hover:bg-actionhover rounded cursor-pointer disabled:opacity-50 disabled:cursor-default flex items-center gap-2"
                        onClick={() => model.saveSecret()}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                {t("waveconfig:secrets.saving")}
                            </>
                        ) : (
                            t("common:common.save")
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});
SecretDetailView.displayName = "SecretDetailView";

interface SecretsContentProps {
    model: WaveConfigViewModel;
}

export const SecretsContent = memo(({ model }: SecretsContentProps) => {
    const { t } = useTranslation("waveconfig");
    const secretNames = useAtomValue(model.secretNamesAtom);
    const selectedSecret = useAtomValue(model.selectedSecretAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const errorMessage = useAtomValue(model.errorMessageAtom);
    const storageBackendError = useAtomValue(model.storageBackendErrorAtom);
    const isAddingNew = useAtomValue(model.isAddingNewAtom);
    const newSecretName = useAtomValue(model.newSecretNameAtom);
    const newSecretValue = useAtomValue(model.newSecretValueAtom);

    const setNewSecretName = useSetAtom(model.newSecretNameAtom);
    const setNewSecretValue = useSetAtom(model.newSecretValueAtom);

    const sortedSecretNames = useMemo(() => {
        return [...secretNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }, [secretNames]);

    if (storageBackendError) {
        return (
            <div className="w-full h-full">
                <div className="p-4">
                    <ErrorDisplay message={storageBackendError} variant="warning" />
                </div>
            </div>
        );
    }

    if (isLoading && secretNames.length === 0 && !selectedSecret) {
        return (
            <div className="w-full h-full">
                <div>
                    <LoadingSpinner message={t("waveconfig:secrets.loadingSecrets")} />
                </div>
            </div>
        );
    }

    const renderContent = () => {
        if (isAddingNew) {
            return (
                <AddSecretForm
                    newSecretName={newSecretName}
                    newSecretValue={newSecretValue}
                    isLoading={isLoading}
                    onNameChange={setNewSecretName}
                    onValueChange={setNewSecretValue}
                    onCancel={() => model.cancelAddingSecret()}
                    onSubmit={() => model.addNewSecret()}
                />
            );
        }

        if (selectedSecret) {
            return <SecretDetailView model={model} />;
        }

        if (secretNames.length === 0) {
            return <EmptyState onAddSecret={() => model.startAddingSecret()} />;
        }

        return (
            <SecretListView
                secretNames={sortedSecretNames}
                onSelectSecret={(name) => model.viewSecret(name)}
                onAddSecret={() => model.startAddingSecret()}
            />
        );
    };

    return (
        <div className="w-full h-full">
            {errorMessage && (
                <div className="p-4">
                    <ErrorDisplay message={errorMessage} />
                </div>
            )}
            {renderContent()}
        </div>
    );
});

SecretsContent.displayName = "SecretsContent";
