// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveEnv } from "@/app/waveenv/waveenv";
import { type Placement } from "@floating-ui/react";
import type * as jotai from "jotai";
import type * as rxjs from "rxjs";

declare global {
    type GlobalAtomsType = {
        builderId: jotai.Atom<string>; // readonly (for builder mode)
        builderAppId: jotai.PrimitiveAtom<string>; // app being edited in builder mode
        uiContext: jotai.Atom<UIContext>; // driven from windowId, tabId
        workspaceId: jotai.Atom<string>; // derived from window WOS object
        workspace: jotai.Atom<Workspace>; // driven from workspaceId via WOS
        fullConfigAtom: jotai.PrimitiveAtom<FullConfigType>; // driven from WOS, settings -- updated via WebSocket
        waveaiModeConfigAtom: jotai.PrimitiveAtom<Record<string, AIModeConfigType>>; // resolved AI mode configs -- updated via WebSocket
        settingsAtom: jotai.Atom<SettingsType>; // derrived from fullConfig
        systemAppThemeAtom: jotai.PrimitiveAtom<ResolvedAppTheme>;
        previewThemeOverrideAtom: jotai.PrimitiveAtom<AppThemeMode | null>;
        resolvedAppThemeAtom: jotai.Atom<ResolvedAppTheme>;
        hasCustomAIPresetsAtom: jotai.Atom<boolean>; // derived from fullConfig
        hasConfigErrors: jotai.Atom<boolean>; // derived from fullConfig
        staticTabId: jotai.Atom<string>;
        isFullScreen: jotai.PrimitiveAtom<boolean>;
        zoomFactorAtom: jotai.PrimitiveAtom<number>;
        controlShiftDelayAtom: jotai.PrimitiveAtom<boolean>;
        prefersReducedMotionAtom: jotai.Atom<boolean>;
        documentHasFocus: jotai.PrimitiveAtom<boolean>;
        updaterStatusAtom: jotai.PrimitiveAtom<UpdaterStatus>;
        modalOpen: jotai.PrimitiveAtom<boolean>;
        allConnStatus: jotai.Atom<ConnStatus[]>;
        reinitVersion: jotai.PrimitiveAtom<number>;
        waveAIRateLimitInfoAtom: jotai.PrimitiveAtom<RateLimitInfo>;
    };

    type ThrottledValueAtom<T> = jotai.WritableAtom<T, [update: jotai.SetStateAction<T>], void>;

    type AtomWithThrottle<T> = {
        currentValueAtom: jotai.Atom<T>;
        throttledValueAtom: ThrottledValueAtom<T>;
    };

    type DebouncedValueAtom<T> = jotai.WritableAtom<T, [update: jotai.SetStateAction<T>], void>;

    type AtomWithDebounce<T> = {
        currentValueAtom: jotai.Atom<T>;
        debouncedValueAtom: DebouncedValueAtom<T>;
    };

    type SplitAtom<Item> = Atom<Atom<Item>[]>;
    type WritableSplitAtom<Item> = WritableAtom<PrimitiveAtom<Item>[], [SplitAtomAction<Item>], void>;

    type TabLayoutData = {
        blockId?: string;
        blockIds?: string[];
        activeBlockId?: string;
        blockTabTitles?: Record<string, string>;
    };

    type GlobalInitOptions = {
        tabId?: string;
        platform: NodeJS.Platform;
        windowId: string;
        clientId: string;
        environment: "electron" | "renderer";
        primaryTabStartup?: boolean;
        builderId?: string;
        isPreview?: boolean;
    };

    type WaveInitOpts = {
        tabId: string;
        clientId: string;
        windowId: string;
        activate: boolean;
        primaryTabStartup?: boolean;
    };

    type BuilderInitOpts = {
        builderId: string;
        clientId: string;
        windowId: string;
    };

    type ElectronApi = {
        getAuthKey(): string; // get-auth-key
        getIsDev(): boolean; // get-is-dev
        getCursorPoint: () => Electron.Point; // get-cursor-point
        getPlatform: () => NodeJS.Platform; // get-platform
        getEnv: (varName: string) => string; // get-env
        getUserName: () => string; // get-user-name
        getHostName: () => string; // get-host-name
        getDataDir: () => string; // get-data-dir
        getConfigDir: () => string; // get-config-dir
        getHomeDir: () => string; // get-home-dir
        getWebviewPreload: () => string; // get-webview-preload
        getAboutModalDetails: () => AboutModalDetails; // get-about-modal-details
        getAppDebugInfo: () => Promise<AppDebugInfo>; // get-app-debug-info
        getDevRuntimeInfo: () => DevRuntimeInfo | null; // get-dev-runtime-info
        getZoomFactor: () => number; // get-zoom-factor
        showWorkspaceAppMenu: (workspaceId: string) => void; // workspace-appmenu-show
        showBuilderAppMenu: (builderId: string) => void; // builder-appmenu-show
        showContextMenu: (workspaceId: string, menu: ElectronContextMenuItem[]) => void; // contextmenu-show
        onContextMenuClick: (callback: (id: string | null) => void) => void; // contextmenu-click
        onNavigate: (callback: (url: string) => void) => void;
        onIframeNavigate: (callback: (url: string) => void) => void;
        downloadFile: (path: string) => void; // download
        openExternal: (url: string) => void; // open-external
        onFullScreenChange: (callback: (isFullScreen: boolean) => void) => void; // fullscreen-change
        onZoomFactorChange: (callback: (zoomFactor: number) => void) => void; // zoom-factor-change
        onUpdaterStatusChange: (callback: (status: UpdaterStatus) => void) => void; // app-update-status
        getUpdaterStatus: () => UpdaterStatus; // get-app-update-status
        getUpdaterChannel: () => string; // get-updater-channel
        installAppUpdate: () => void; // install-app-update
        onMenuItemAbout: (callback: () => void) => void; // menu-item-about
        updateWindowControlsOverlay: (rect: Dimensions) => void; // update-window-controls-overlay
        onReinjectKey: (callback: (waveEvent: WaveKeyboardEvent) => void) => void; // reinject-key
        setWebviewFocus: (focusedId: number) => void; // webview-focus, focusedId is the getWebContentsId of the webview
        registerGlobalWebviewKeys: (keys: string[]) => void; // register-global-webview-keys
        onControlShiftStateUpdate: (callback: (state: boolean) => void) => void; // control-shift-state-update
        createWorkspace: () => void; // create-workspace
        switchWorkspace: (workspaceId: string) => void; // switch-workspace
        deleteWorkspace: (workspaceId: string) => void; // delete-workspace
        setActiveTab: (tabId: string) => void; // set-active-tab
        createTab: () => void; // create-tab
        getOpenedThisLaunchTabIds: () => string[]; // get-opened-this-launch-tab-ids
        markTabOpenedThisLaunch: (tabId: string) => void; // mark-tab-opened-this-launch
        onOpenedThisLaunchTabIdsChange: (callback: (tabIds: string[]) => void) => void; // opened-this-launch-tab-ids-change
        closeTab: (workspaceId: string, tabId: string, confirmClose: boolean) => Promise<boolean>; // close-tab
        moveTabToNewWindow: (tabId: string) => Promise<boolean>; // move-tab-to-new-window
        moveTabBack: (tabId: string) => Promise<boolean>; // move-tab-back
        setWindowInitStatus: (status: "ready" | "wave-ready") => void; // set-window-init-status
        onWaveInit: (callback: (initOpts: WaveInitOpts) => void) => void; // wave-init
        onBuilderInit: (callback: (initOpts: BuilderInitOpts) => void) => void; // builder-init
        sendLog: (log: string) => void; // fe-log
        onQuicklook: (filePath: string) => void; // quicklook
        openNativePath(filePath: string): void; // open-native-path
        revealNativePath(filePath: string): void; // reveal-native-path
        pickDirectory: () => Promise<string | null>; // pick-directory
        obsidianReadVaults: () => Promise<string[]>; // obsidian-read-vaults
        openInVSCode(filePath: string): Promise<boolean>; // open-in-vscode
        captureScreenshot(rect: Electron.Rectangle): Promise<string>; // capture-screenshot
        setKeyboardChordMode: () => void; // set-keyboard-chord-mode
        clearWebviewStorage: (webContentsId: number) => Promise<void>; // clear-webview-storage
        setWaveAIOpen: (isOpen: boolean) => void; // set-waveai-open
        closeBuilderWindow: () => void; // close-builder-window
        incrementTermCommands: (opts?: { isRemote?: boolean; isWsl?: boolean; isDurable?: boolean }) => void; // increment-term-commands
        nativePaste: () => void; // native-paste
        writeClipboardText: (text: string) => Promise<boolean>; // write-clipboard-text
        writeClipboardFiles: (filePaths: string[], fallbackText?: string) => Promise<boolean>; // write-clipboard-files
        openBuilder: (appId?: string) => void; // open-builder
        setBuilderWindowAppId: (appId: string) => void; // set-builder-window-appid
        doRefresh: () => void; // do-refresh
        getPathForFile: (file: File) => string; // webUtils.getPathForFile
        saveTextFile: (fileName: string, content: string) => Promise<boolean>; // save-text-file
        setIsActive: () => Promise<void>; // set-is-active
        startWindowDrag: () => void; // window-start-drag
        endWindowDrag: () => void; // window-end-drag
    };

    type ElectronContextMenuItem = {
        id: string; // unique id, used for communication
        label: string;
        role?: string; // electron role (optional)
        type?: "separator" | "normal" | "submenu" | "checkbox" | "radio" | "header";
        submenu?: ElectronContextMenuItem[];
        checked?: boolean;
        visible?: boolean;
        enabled?: boolean;
        sublabel?: string;
    };

    type ContextMenuItem = {
        label?: string;
        type?: "separator" | "normal" | "submenu" | "checkbox" | "radio" | "header";
        role?: string; // electron role (optional)
        click?: () => void; // not required if role is set
        submenu?: ContextMenuItem[];
        checked?: boolean;
        visible?: boolean;
        enabled?: boolean;
        sublabel?: string;
    };

    type KeyPressDecl = {
        mods: {
            Cmd?: boolean;
            Option?: boolean;
            Shift?: boolean;
            Ctrl?: boolean;
            Alt?: boolean;
            Meta?: boolean;
        };
        key: string;
        keyType: string;
    };

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

    type HeaderElem =
        | IconButtonDecl
        | ToggleIconButtonDecl
        | HeaderText
        | HeaderCopyText
        | HeaderInput
        | HeaderDiv
        | HeaderTextButton
        | ConnectionButton
        | MenuButton;

    type IconButtonCommon = {
        icon: string | React.ReactNode;
        iconColor?: string;
        iconSpin?: boolean;
        className?: string;
        title?: string;
        disabled?: boolean;
        noAction?: boolean;
    };

    type IconButtonDecl = IconButtonCommon & {
        elemtype: "iconbutton";
        click?: (e: React.MouseEvent<any>) => void;
        longClick?: (e: React.MouseEvent<any>) => void;
    };

    type ToggleIconButtonDecl = IconButtonCommon & {
        elemtype: "toggleiconbutton";
        active: jotai.WritableAtom<boolean, [boolean], void>;
    };

    type HeaderTextButton = {
        elemtype: "textbutton";
        text: string;
        className?: string;
        title?: string;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderCopyText = {
        elemtype: "copytext";
        text: string;
        displayText: string;
        tooltipText?: string;
        title?: string;
        className?: string;
    };

    type HeaderText = {
        elemtype: "text";
        text: string;
        ref?: React.RefObject<HTMLDivElement>;
        className?: string;
        noGrow?: boolean;
        title?: string;
        onClick?: (e: React.MouseEvent<any>) => void;
        // Optional rich Tooltip. When present, the renderer wraps the element in the shared
        // `<Tooltip>` component (replacing the native `title`). Used by agent-block header
        // status badges that want the same styled tooltip as the block path copy element.
        tooltipNode?: React.ReactNode;
        tooltipProps?: {
            forceOpen?: boolean;
            openDelay?: number;
            hideOnClick?: boolean;
            divClassName?: string;
        };
    };

    type HeaderInput = {
        elemtype: "input";
        value: string;
        className?: string;
        isDisabled?: boolean;
        ref?: React.RefObject<HTMLInputElement>;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
        onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
        onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    };

    type HeaderDiv = {
        elemtype: "div";
        className?: string;
        children: HeaderElem[];
        onMouseOver?: (e: React.MouseEvent<any>) => void;
        onMouseOut?: (e: React.MouseEvent<any>) => void;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type ConnectionButton = {
        elemtype: "connectionbutton";
        icon: string;
        text: string;
        iconColor: string;
        onClick?: (e: React.MouseEvent<any>) => void;
        connected: boolean;
    };

    type MenuItem = {
        label: string;
        icon?: string | React.ReactNode;
        subItems?: MenuItem[];
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type MenuButtonProps = {
        items: MenuItem[];
        className?: string;
        text: string;
        icon?: string | React.ReactNode;
        title?: string;
        menuPlacement?: Placement;
    };

    type MenuButton = {
        elemtype: "menubutton";
    } & MenuButtonProps;

    type SearchAtoms = {
        searchValue: PrimitiveAtom<string>;
        resultsIndex: PrimitiveAtom<number>;
        resultsCount: PrimitiveAtom<number>;
        isOpen: PrimitiveAtom<boolean>;
        focusInput: PrimitiveAtom<number>;
        regex?: PrimitiveAtom<boolean>;
        caseSensitive?: PrimitiveAtom<boolean>;
        wholeWord?: PrimitiveAtom<boolean>;
        replaceValue?: PrimitiveAtom<string>;
    };

    declare type ViewComponentProps<T extends ViewModel> = {
        blockId: string;
        blockRef: React.RefObject<HTMLDivElement>;
        contentRef: React.RefObject<HTMLDivElement>;
        model: T;
    };

    declare type ViewComponent = React.FC<ViewComponentProps>;

    type ViewModelInitType = {
        blockId: string;
        nodeModel: BlockNodeModel;
        tabModel: TabModel;
        waveEnv: WaveEnv;
    };

    type ViewModelClass = new (initOpts: ViewModelInitType) => ViewModel;

    interface ViewModel {
        // The type of view, used for identifying and rendering the appropriate component.
        viewType: string;

        useTermHeader?: jotai.Atom<boolean>;

        hideViewName?: jotai.Atom<boolean>;

        // Icon representing the view, can be a string or an IconButton declaration.
        viewIcon?: jotai.Atom<string | IconButtonDecl>;

        // Display name for the view, used in UI headers.
        viewName?: jotai.Atom<string>;

        // Optional header text or elements for the view.
        viewText?: jotai.Atom<string | HeaderElem[]>;

        termDurableStatus?: jotai.Atom<BlockJobStatusData | null>;
        termConfigedDurable?: jotai.Atom<null | boolean>;

        // Icon button displayed before the title in the header.
        preIconButton?: jotai.Atom<IconButtonDecl>;

        // Icon buttons displayed at the end of the block header.
        endIconButtons?: jotai.Atom<IconButtonDecl[]>;

        // Background styling metadata for the block.
        blockBg?: jotai.Atom<MetaType>;

        noHeader?: jotai.Atom<boolean>;

        // Whether the block manages its own connection (e.g., for remote access).
        manageConnection?: jotai.Atom<boolean>;

        // If true, filters out 'nowsh' connections (when managing connections)
        filterOutNowsh?: jotai.Atom<boolean>;

        // If true, removes padding inside the block content area.
        noPadding?: jotai.Atom<boolean>;

        // Atoms used for managing search functionality within the block.
        searchAtoms?: SearchAtoms;

        // The main view component associated with this ViewModel.
        viewComponent: ViewComponent<ViewModel>;

        // Function to determine if this is a basic terminal block.
        isBasicTerm?: (getFn: jotai.Getter) => boolean;

        // Returns menu items for the settings dropdown.
        getSettingsMenuItems?: () => ContextMenuItem[];

        // Attempts to give focus to the block, returning true if successful.
        giveFocus?: () => boolean;

        // Handles keydown events within the block.
        keyDownHandler?: (e: WaveKeyboardEvent) => boolean;

        // Return false to cancel closing when a view has pending user state.
        confirmClose?: () => Promise<boolean>;

        // Cleans up resources when the block is disposed.
        dispose?: () => void;
    }

    type UpdaterStatus = "up-to-date" | "checking" | "downloading" | "ready" | "manual-update" | "error" | "installing";

    // jotai doesn't export this type :/
    type Loadable<T> = { state: "loading" } | { state: "hasData"; data: T } | { state: "hasError"; error: unknown };

    interface Dimensions {
        width: number;
        height: number;
        left: number;
        top: number;
    }

    type TypeAheadModalType = { [key: string]: boolean };

    interface AboutModalDetails {
        version: string;
        buildTime: number;
    }

    interface AppDebugInfoLog {
        path: string;
        exists: boolean;
        size?: number;
        modifiedAt?: string;
        tail?: string;
        error?: string;
    }

    interface DevRuntimeEndpoint {
        port: number;
        requestedPort: number;
        url: string;
    }

    interface DevRuntimeInfo {
        profile: string;
        gitBranch: string | null;
        portMode: "auto" | "strict";
        vite: DevRuntimeEndpoint | null;
        cdp: DevRuntimeEndpoint | null;
        cdpJsonUrl: string | null;
        inspectCommand: string | null;
        appVersion: string | null;
        electronVersion: string | null;
        nodeVersion: string | null;
        dirs: { data: string; config: string; logFile: string } | null;
    }

    interface AppDebugInfo {
        generatedAt: string;
        devRuntime: DevRuntimeInfo | null;
        app: {
            name: string;
            version: string;
            buildTime: number;
            isPackaged: boolean;
            isDev: boolean;
        };
        runtime: {
            platform: NodeJS.Platform;
            arch: string;
            electron?: string;
            chrome?: string;
            node?: string;
            v8?: string;
        };
        updater: {
            status: UpdaterStatus | null;
            channel: string;
            autoCheckEnabled: boolean | null;
            intervalms: number | null;
            lastUpdateCheck: string | null;
            updateSupport: {
                supported: boolean;
                reason?: string;
                manualInstallOnly?: boolean;
            } | null;
            availableUpdateReleaseName: string | null;
        };
        paths: {
            home: string;
            data: string;
            config: string;
            logFile: string;
        };
        logs: {
            waveapp: AppDebugInfoLog;
        };
    }

    type BlockComponentModel = {
        openSwitchConnection?: () => void;
        viewModel: ViewModel;
    };

    type ConnStatusType = "connected" | "connecting" | "disconnected" | "error" | "init";

    interface SuggestionBaseItem {
        label: string;
        value: string;
        icon?: string | React.ReactNode;
    }

    interface SuggestionConnectionItem extends SuggestionBaseItem {
        status: ConnStatusType;
        iconColor: string;
        onSelect?: (_: string) => void;
        current?: boolean;
    }

    interface SuggestionConnectionScope {
        headerText?: string;
        items: SuggestionConnectionItem[];
    }

    type SuggestionsType = SuggestionConnectionItem | SuggestionConnectionScope;

    type MarkdownResolveOpts = {
        connName: string;
        baseDir: string;
        openLink?: (
            path: string,
            options: { lineNumber?: number | null; forceNewBlock?: boolean }
        ) => Promise<void>;
    };

    interface AbstractWshClient {
        recvRpcMessage(msg: RpcMessage): void;
    }

    type ClientRpcEntry = {
        reqId: string;
        startTs: number;
        command: string;
        msgFn: (msg: RpcMessage) => void;
    };

    type TimeSeriesMeta = {
        name?: string;
        color?: string;
        label?: string;
        maxy?: string | number;
        miny?: string | number;
        decimalPlaces?: number;
    };

    interface SuggestionRequestContext {
        widgetid: string;
        reqnum: number;
        dispose?: boolean;
    }

    type SuggestionsFnType = (query: string, reqContext: SuggestionRequestContext) => Promise<FetchSuggestionsResponse>;

    type DraggedFile = {
        uri: string;
        absParent: string;
        relName: string;
        isDir: boolean;
    };

    type ErrorButtonDef = {
        text: string;
        onClick: () => void;
    };

    type ErrorMsg = {
        status: string;
        text: string;
        level?: "error" | "warning";
        buttons?: Array<ErrorButtonDef>;
        closeAction?: () => void;
        showDismiss?: boolean;
    };

    type AIMessage = {
        messageid: string;
        parts: AIMessagePart[];
    };

    type AIMessagePart =
        | {
              type: "text";
              text: string;
          }
        | {
              type: "file";
              mimetype: string; // required
              filename?: string;
              data?: string; // base64 encoded data
              url?: string;
              size?: number;
              previewurl?: string;
          };

    type AIModeConfigWithMode = { mode: string } & AIModeConfigType;
}

export {};
