// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
	"github.com/wavetermdev/waveterm/pkg/agentdispatch"
	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type MultiArg struct {
	Args []any `json:"args"`
}

// Instructions for adding a new RPC call
// * methods must end with Command
// * methods must take context as their first parameter
// * methods may take additional typed parameters, and may return either just an error, or one return value plus an error
// * after modifying WshRpcInterface, run `task generate` to regnerate bindings

type WshRpcInterface interface {
	AuthenticateCommand(ctx context.Context, data string) (CommandAuthenticateRtnData, error)
	AuthenticateTokenCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error)
	AuthenticateTokenVerifyCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error) // (special) validates token without binding, root router only
	AuthenticateJobManagerCommand(ctx context.Context, data CommandAuthenticateJobManagerData) error
	AuthenticateJobManagerVerifyCommand(ctx context.Context, data CommandAuthenticateJobManagerData) error // (special) validates job auth token without binding, root router only
	DisposeCommand(ctx context.Context, data CommandDisposeData) error
	RouteAnnounceCommand(ctx context.Context) error               // (special) announces a new route to the main router
	RouteUnannounceCommand(ctx context.Context) error             // (special) unannounces a route to the main router
	ControlGetRouteIdCommand(ctx context.Context) (string, error) // (special) gets the route for the link that we're on
	SetPeerInfoCommand(ctx context.Context, peerInfo string) error
	GetJwtPublicKeyCommand(ctx context.Context) (string, error) // (special) gets the public JWT signing key

	MessageCommand(ctx context.Context, data CommandMessageData) error
	GetMetaCommand(ctx context.Context, data CommandGetMetaData) (waveobj.MetaMapType, error)
	SetMetaCommand(ctx context.Context, data CommandSetMetaData) error
	ControllerInputCommand(ctx context.Context, data CommandBlockInputData) error
	ControllerDestroyCommand(ctx context.Context, blockId string) error
	ControllerResyncCommand(ctx context.Context, data CommandControllerResyncData) error
	ControllerRedrawCommand(ctx context.Context, blockId string) error
	ControllerAppendOutputCommand(ctx context.Context, data CommandControllerAppendOutputData) error
	ResolveIdsCommand(ctx context.Context, data CommandResolveIdsData) (CommandResolveIdsRtnData, error)
	CreateBlockCommand(ctx context.Context, data CommandCreateBlockData) (waveobj.ORef, error)
	CreateSubBlockCommand(ctx context.Context, data CommandCreateSubBlockData) (waveobj.ORef, error)
	DeleteBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	DeleteSubBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	WaitForRouteCommand(ctx context.Context, data CommandWaitForRouteData) (bool, error)

	EventPublishCommand(ctx context.Context, data wps.WaveEvent) error
	EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error
	EventUnsubCommand(ctx context.Context, data string) error
	EventUnsubAllCommand(ctx context.Context) error
	EventReadHistoryCommand(ctx context.Context, data CommandEventReadHistoryData) ([]*wps.WaveEvent, error)
	AgentStatusCommand(ctx context.Context, data agentstatus.AgentStatusReport) (*agentstatus.AgentStatus, error)

	FileRestoreBackupCommand(ctx context.Context, data CommandFileRestoreBackupData) error
	GetTempDirCommand(ctx context.Context, data CommandGetTempDirData) (string, error)
	WriteTempFileCommand(ctx context.Context, data CommandWriteTempFileData) (string, error)
	StreamTestCommand(ctx context.Context) chan RespOrErrorUnion[int]
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[TimeSeriesData]
	TestCommand(ctx context.Context, data string) error
	TestMultiArgCommand(ctx context.Context, arg1 string, arg2 int, arg3 bool) (string, error)
	SetConfigCommand(ctx context.Context, data MetaSettingsType) error
	// Common Text sync watermark. Exposed over RPC so the `wsh commontext-sync` CLI path records
	// the same watermarks the in-app engine does; writing them straight to the DB would need the
	// CLI to open the app's database file.
	CommonTextSyncPendingCommand(ctx context.Context) (*CommonTextSyncPendingResult, error)
	CommonTextSyncMarkSyncedCommand(ctx context.Context, data CommonTextSyncMarkSyncedData) error
	SetConnectionsConfigCommand(ctx context.Context, data ConnConfigRequest) error
	GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error)
	GetWaveAIModeConfigCommand(ctx context.Context) (wconfig.AIModeConfigUpdate, error)
	BlockInfoCommand(ctx context.Context, blockId string) (*BlockInfoData, error)
	DebugTermCommand(ctx context.Context, data CommandDebugTermData) (*CommandDebugTermRtnData, error)
	BlocksListCommand(ctx context.Context, data BlocksListRequest) ([]BlocksListEntry, error)

	// agent control surface (read-only, used by wsh session *)
	SessionLiveCommand(ctx context.Context, data SessionLiveRequest) (*SessionLiveResult, error)
	SessionGetCommand(ctx context.Context, data SessionGetRequest) (*SessionLiveRecord, error)
	SessionListCommand(ctx context.Context, data SessionListRequest) (*SessionListResult, error)
	// agent control surface (progressive session reading, used by wsh session info/users/turns/turn)
	SessionInfoCommand(ctx context.Context, data SessionInfoRequest) (*SessionInfoResult, error)
	SessionUsersCommand(ctx context.Context, data SessionUsersRequest) (*SessionUsersResult, error)
	SessionTurnsCommand(ctx context.Context, data SessionTurnsRequest) (*SessionTurnsResult, error)
	SessionTurnCommand(ctx context.Context, data SessionTurnRequest) (*SessionTurnResult, error)
	// agent control surface (session card read/write, used by wsh agent card *)
	AgentCardGetCommand(ctx context.Context, data AgentCardGetRequest) (*AgentCardResult, error)
	AgentCardSetCommand(ctx context.Context, data AgentCardSetRequest) (*AgentCardSetResult, error)
	// agent control surface (session timeline annotation write, used by wsh session annotate)
	SessionAnnotateCommand(ctx context.Context, data SessionAnnotateRequest) (*SessionAnnotateResult, error)
	// agent control surface (session emoji read/write + recommendation injection)
	SessionEmojiGetCommand(ctx context.Context, data SessionEmojiGetRequest) (*SessionEmojiGetResult, error)
	// agent control surface (startup bootstrap: every backend emoji prop, read-only)
	SessionEmojiPropsListCommand(ctx context.Context, data SessionEmojiPropsListRequest) (*SessionEmojiPropsListResult, error)
	// agent control surface (UI hand-pick record: props source=user + preference counters)
	SessionEmojiRecordPickCommand(ctx context.Context, data SessionEmojiRecordPickRequest) (*SessionEmojiRecordPickResult, error)
	// agent control surface (one-off localStorage migration: source=user, if-absent, idempotent)
	SessionEmojiMigrateCommand(ctx context.Context, data SessionEmojiMigrateRequest) (*SessionEmojiMigrateResult, error)
	SessionEmojiSetCommand(ctx context.Context, data SessionEmojiSetRequest) (*SessionEmojiSetResult, error)
	SessionEmojiInjectCommand(ctx context.Context, data SessionEmojiInjectRequest) (*SessionEmojiInjectResult, error)
	SessionEmojiRecommendationsCommand(ctx context.Context, data SessionEmojiRecommendationsRequest) (*SessionEmojiRecommendationsResult, error)
	SessionEmojiPrefsCommand(ctx context.Context, data SessionEmojiPrefsRequest) (*SessionEmojiPrefsResult, error)
	// agent control surface (UI observe + navigate, used by wsh ui/block/tab *)
	UIActiveCommand(ctx context.Context, data UIActiveRequest) (*UIActiveSnapshot, error)
	UIStateCommand(ctx context.Context, data UIStateRequest) (*UIStateSnapshot, error)
	BlockReadCommand(ctx context.Context, data BlockReadRequest) (*BlockReadResult, error)
	BlockOpenCommand(ctx context.Context, data BlockOpenRequest) (*BlockOpenResult, error)
	TabListCommand(ctx context.Context, data TabListRequest) (*TabListResult, error)
	TabCreateCommand(ctx context.Context, data TabCreateRequest) (*TabCreateResult, error)
	TabActivateCommand(ctx context.Context, data TabActivateRequest) (*TabActivateResult, error)
	// agent block launch + text injection (programmatic agent-block creation)
	AgentLaunchCommand(ctx context.Context, data AgentLaunchRequest) (*AgentLaunchResult, error)
	// AgentLaunchHeadlessCommand runs the profile's CLI once WITHOUT creating a
	// block (`agent launch --headless`). Tab must be empty (E_USAGE otherwise),
	// Send carries the one-shot prompt, non-zero exit -> E_AGENT_FAILED.
	AgentLaunchHeadlessCommand(ctx context.Context, data AgentLaunchRequest) (*ScheduledTaskRunResult, error)
	AgentSendCommand(ctx context.Context, data AgentSendRequest) (*AgentSendResult, error)
	// AgentResumeCommand recreates an agent block for an existing session
	// (F-1121-agent-resume): resolve -> restore context -> meta -> block (+send).
	AgentResumeCommand(ctx context.Context, data AgentResumeRequest) (*AgentResumeResult, error)
	// SessionMarkCommand stars/unstars a session (view state, design D5).
	SessionMarkCommand(ctx context.Context, data SessionMarkRequest) (*SessionMarkResult, error)
	// agent dispatch queue (server-held delivery state; consumed by desktop UI,
	// CLI, MCP and future mobile clients)
	AgentDispatchListCommand(ctx context.Context, data AgentDispatchListRequest) ([]agentdispatch.Record, error)
	AgentDispatchGetCommand(ctx context.Context, data AgentDispatchGetRequest) (*agentdispatch.Record, error)
	AgentDispatchRetryCommand(ctx context.Context, data AgentDispatchRetryRequest) (*agentdispatch.Record, error)
	// external agent access: mint a scoped token (in-app only)
	AgentAuthGrantCommand(ctx context.Context, data AgentAuthGrantRequest) (*AgentAuthGrantResult, error)
	AgentAuthListCommand(ctx context.Context) (*AgentAuthListResult, error)
	AgentAuthRevokeCommand(ctx context.Context, data AgentAuthRevokeRequest) (*AgentAuthRevokeResult, error)
	AgentSkillInstallCommand(ctx context.Context) (*AgentSkillInstallResult, error)
	AgentMCPConfigCommand(ctx context.Context, host string) (*AgentMCPConfigResult, error)
	WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)
	MacOSVersionCommand(ctx context.Context) (string, error)
	WshActivityCommand(ct context.Context, data map[string]int) error
	ActivityCommand(ctx context.Context, data ActivityUpdate) error
	RecordTEventCommand(ctx context.Context, data telemetrydata.TEvent) error
	GetVarCommand(ctx context.Context, data CommandVarData) (*CommandVarResponseData, error)
	GetAllVarsCommand(ctx context.Context, data CommandVarData) ([]CommandVarResponseData, error)
	SetVarCommand(ctx context.Context, data CommandVarData) error
	GetBlockEnvCommand(ctx context.Context, data CommandGetBlockEnvData) (*CommandGetBlockEnvRtnData, error)
	GetDefaultEnvCommand(ctx context.Context, data CommandGetDefaultEnvData) (*CommandGetBlockEnvRtnData, error)
	PathCommand(ctx context.Context, data PathCommandData) (string, error)
	SendTelemetryCommand(ctx context.Context) error
	FetchSuggestionsCommand(ctx context.Context, data FetchSuggestionsData) (*FetchSuggestionsResponse, error)
	DisposeSuggestionsCommand(ctx context.Context, widgetId string) error
	GetTabCommand(ctx context.Context, tabId string) (*waveobj.Tab, error)
	UpdateTabNameCommand(ctx context.Context, tabId string, newName string) error
	UpdateWorkspaceTabIdsCommand(ctx context.Context, workspaceId string, tabIds []string) error
	GetAllBadgesCommand(ctx context.Context) ([]baseds.BadgeEvent, error)

	// connection functions
	ConnStatusCommand(ctx context.Context) ([]ConnStatus, error)
	WslStatusCommand(ctx context.Context) ([]ConnStatus, error)
	ConnEnsureCommand(ctx context.Context, data ConnExtData) error
	ConnReinstallWshCommand(ctx context.Context, data ConnExtData) error
	ConnPrepareManualWshInstallCommand(ctx context.Context, data ConnExtData) (CommandManualWshInstallData, error)
	ConnConnectCommand(ctx context.Context, connRequest ConnRequest) error
	ConnDisconnectCommand(ctx context.Context, connName string) error
	ConnListCommand(ctx context.Context) ([]string, error)
	// ConnListDetailCommand is ConnListCommand plus provenance. The flat []string shape is kept
	// because it has several callers; both read the same sources so they cannot disagree about
	// which connections exist.
	ConnListDetailCommand(ctx context.Context) ([]ConnectionDetailItem, error)
	WslListCommand(ctx context.Context) ([]string, error)
	WslDefaultDistroCommand(ctx context.Context) (string, error)
	DismissWshFailCommand(ctx context.Context, connName string) error
	ConnUpdateWshCommand(ctx context.Context, remoteInfo RemoteInfo) (bool, error)
	FindGitBashCommand(ctx context.Context, rescan bool) (string, error)
	ConnServerInitCommand(ctx context.Context, data CommandConnServerInitData) error
	NotifySystemResumeCommand(ctx context.Context) error

	// eventrecv is special, it's handled internally by WshRpc with EventListener
	EventRecvCommand(ctx context.Context, data wps.WaveEvent) error

	// remotes
	WshRpcRemoteFileInterface
	RemoteStreamCpuDataCommand(ctx context.Context) chan RespOrErrorUnion[TimeSeriesData]
	RemoteGetInfoCommand(ctx context.Context) (RemoteInfo, error)
	RemoteInstallRcFilesCommand(ctx context.Context) error
	RemoteStartJobCommand(ctx context.Context, data CommandRemoteStartJobData) (*CommandStartJobRtnData, error)
	RemoteReconnectToJobManagerCommand(ctx context.Context, data CommandRemoteReconnectToJobManagerData) (*CommandRemoteReconnectToJobManagerRtnData, error)
	RemoteDisconnectFromJobManagerCommand(ctx context.Context, data CommandRemoteDisconnectFromJobManagerData) error
	RemoteTerminateJobManagerCommand(ctx context.Context, data CommandRemoteTerminateJobManagerData) error
	BadgeWatchPidCommand(ctx context.Context, data CommandBadgeWatchPidData) error
	RemoteProcessListCommand(ctx context.Context, data CommandRemoteProcessListData) (*ProcessListResponse, error)
	RemoteProcessSignalCommand(ctx context.Context, data CommandRemoteProcessSignalData) error
	RemoteFileSearchStreamCommand(ctx context.Context, data CommandRemoteFileSearchData) chan RespOrErrorUnion[CommandRemoteFileSearchRtnData]
	RemoteFileNameSearchStreamCommand(ctx context.Context, data CommandRemoteFileNameSearchData) chan RespOrErrorUnion[CommandRemoteFileNameSearchRtnData]
	RemoteVcsResolvePathCommand(ctx context.Context, data CommandRemoteVcsResolvePathData) (*RemoteVcsResolvePathRtnData, error)
	RemoteVcsRepositoriesCommand(ctx context.Context, data CommandRemoteVcsRepositoriesData) (*RemoteVcsRepositoriesRtnData, error)
	RemoteVcsCommitsCommand(ctx context.Context, data CommandRemoteVcsCommitsData) (*RemoteVcsCommitsRtnData, error)
	RemoteVcsCommitFilesCommand(ctx context.Context, data CommandRemoteVcsCommitFilesData) (*RemoteVcsCommitFilesRtnData, error)
	RemoteVcsCommitCommand(ctx context.Context, data CommandRemoteVcsCommitData) (*RemoteVcsCommitRtnData, error)
	RemoteVcsSyncCommand(ctx context.Context, data CommandRemoteVcsSyncData) (*RemoteVcsSyncRtnData, error)
	RemoteVcsFileHistoryCommand(ctx context.Context, data CommandRemoteVcsFileHistoryData) (*RemoteVcsFileHistoryRtnData, error)
	RemoteVcsFileDiffCommand(ctx context.Context, data CommandRemoteVcsFileDiffData) (*RemoteVcsFileDiffRtnData, error)
	RemoteVcsStatCommand(ctx context.Context, data CommandRemoteVcsStatData) (*RemoteVcsStatRtnData, error)
	RemoteVcsBranchListCommand(ctx context.Context, data CommandRemoteVcsBranchListData) (*RemoteVcsBranchListRtnData, error)
	RemoteVcsSwitchBranchCommand(ctx context.Context, data CommandRemoteVcsSwitchBranchData) (*RemoteVcsSwitchBranchRtnData, error)
	RemoteVcsCreateBranchCommand(ctx context.Context, data CommandRemoteVcsCreateBranchData) (*RemoteVcsCreateBranchRtnData, error)
	RemoteVcsDeleteBranchCommand(ctx context.Context, data CommandRemoteVcsDeleteBranchData) (*RemoteVcsDeleteBranchRtnData, error)
	RemoteVcsPipelineListCommand(ctx context.Context, data CommandRemoteVcsPipelineListData) (*RemoteVcsPipelineListRtnData, error)

	// emain
	WebSelectorCommand(ctx context.Context, data CommandWebSelectorData) ([]string, error)
	NotifyCommand(ctx context.Context, notificationOptions WaveNotificationOptions) error
	FocusWindowCommand(ctx context.Context, windowId string) error
	ElectronEncryptCommand(ctx context.Context, data CommandElectronEncryptData) (*CommandElectronEncryptRtnData, error)
	ElectronDecryptCommand(ctx context.Context, data CommandElectronDecryptData) (*CommandElectronDecryptRtnData, error)
	NetworkOnlineCommand(ctx context.Context) (bool, error)
	ElectronSystemBellCommand(ctx context.Context) error

	// secrets
	GetSecretsCommand(ctx context.Context, names []string) (map[string]string, error)
	GetSecretsNamesCommand(ctx context.Context) ([]string, error)
	SetSecretsCommand(ctx context.Context, secrets map[string]*string) error
	GetSecretsLinuxStorageBackendCommand(ctx context.Context) (string, error)

	// cc-switch integration: read-only list of cc-switch's Claude providers (vendors), for per-block vendor isolation
	CcSwitchListClaudeVendorsCommand(ctx context.Context) (*ccswitch.VendorList, error)
	// cc-switch integration: read-only list of cc-switch's Codex providers (vendors), for per-block vendor isolation
	CcSwitchListCodexVendorsCommand(ctx context.Context) (*ccswitch.VendorList, error)
	// cc-switch integration: read-only list of cc-switch's OpenCode providers (vendors), for per-block vendor isolation
	CcSwitchListOpenCodeVendorsCommand(ctx context.Context) (*ccswitch.VendorList, error)
	// cc-switch integration: read-only list of cc-switch's Pi providers (vendors), for per-block vendor isolation
	CcSwitchListPiVendorsCommand(ctx context.Context) (*ccswitch.VendorList, error)
	CcSwitchListWaveAIVendorsCommand(ctx context.Context) (*ccswitch.WaveAIVendorList, error)

	WorkspaceListCommand(ctx context.Context) ([]WorkspaceInfoData, error)
	GetUpdateChannelCommand(ctx context.Context) (string, error)

	// terminal
	VDomCreateContextCommand(ctx context.Context, data vdom.VDomCreateContext) (*waveobj.ORef, error)
	VDomAsyncInitiationCommand(ctx context.Context, data vdom.VDomAsyncInitiationRequest) error

	// ai
	AiSendMessageCommand(ctx context.Context, data AiMessageData) error
	WaveAIEnableTelemetryCommand(ctx context.Context) error
	GetWaveAIChatCommand(ctx context.Context, data CommandGetWaveAIChatData) (*uctypes.UIChat, error)
	GetWaveAIRateLimitCommand(ctx context.Context) (*uctypes.RateLimitInfo, error)
	WaveAIToolApproveCommand(ctx context.Context, data CommandWaveAIToolApproveData) error
	WaveAIAddContextCommand(ctx context.Context, data CommandWaveAIAddContextData) error
	WaveAIGetToolDiffCommand(ctx context.Context, data CommandWaveAIGetToolDiffData) (*CommandWaveAIGetToolDiffRtnData, error)

	// screenshot
	CaptureBlockScreenshotCommand(ctx context.Context, data CommandCaptureBlockScreenshotData) (string, error)

	// agent catalog (single source of truth for agent profiles + models)
	AgentProfileListCommand(ctx context.Context) ([]agentcatalog.ProfileInfo, error)

	// scheduled tasks
	ScheduledTaskListCommand(ctx context.Context) ([]wconfig.ScheduledTaskType, error)
	ScheduledTaskGetCommand(ctx context.Context, taskId string) (*wconfig.ScheduledTaskType, error)
	ScheduledTaskCreateCommand(ctx context.Context, data wconfig.ScheduledTaskType) (wconfig.ScheduledTaskType, error)
	ScheduledTaskUpdateCommand(ctx context.Context, data wconfig.ScheduledTaskType) error
	ScheduledTaskDeleteCommand(ctx context.Context, taskId string) error
	ScheduledTaskRunNowCommand(ctx context.Context, taskId string) error
	ScheduledTaskHistoryCommand(ctx context.Context, taskId string) ([]wconfig.ScheduledTaskRunRecord, error)
	// ScheduledTaskRunCommand runs a task now and blocks until it finishes,
	// returning the run outcome (status, exit code, duration, log path). It is
	// the synchronous twin of RunNow (fire-and-forget); used by
	// `wsh scheduledtask run` and the MCP run tool. Unknown id -> E_NOT_FOUND.
	ScheduledTaskRunCommand(ctx context.Context, taskId string) (*ScheduledTaskRunResult, error)

	// block focus
	SetBlockFocusCommand(ctx context.Context, blockId string) error
	GetFocusedBlockDataCommand(ctx context.Context) (*FocusedBlockData, error)

	// rtinfo
	GetRTInfoCommand(ctx context.Context, data CommandGetRTInfoData) (*waveobj.ObjRTInfo, error)
	SetRTInfoCommand(ctx context.Context, data CommandSetRTInfoData) error

	// terminal
	TermGetScrollbackLinesCommand(ctx context.Context, data CommandTermGetScrollbackLinesData) (*CommandTermGetScrollbackLinesRtnData, error)

	// file
	WshRpcFileInterface
	WaveFileReadStreamCommand(ctx context.Context, data CommandWaveFileReadStreamData) (*WaveFileInfo, error)

	// builder
	WshRpcBuilderInterface

	// proc
	VDomRenderCommand(ctx context.Context, data vdom.VDomFrontendUpdate) chan RespOrErrorUnion[*vdom.VDomBackendUpdate]
	VDomUrlRequestCommand(ctx context.Context, data VDomUrlRequestData) chan RespOrErrorUnion[VDomUrlRequestResponse]

	// streams
	StreamDataCommand(ctx context.Context, data CommandStreamData) error
	StreamDataAckCommand(ctx context.Context, data CommandStreamAckData) error

	// jobs
	AuthenticateToJobManagerCommand(ctx context.Context, data CommandAuthenticateToJobData) error
	StartJobCommand(ctx context.Context, data CommandStartJobData) (*CommandStartJobRtnData, error)
	JobPrepareConnectCommand(ctx context.Context, data CommandJobPrepareConnectData) (*CommandJobConnectRtnData, error)
	JobStartStreamCommand(ctx context.Context, data CommandJobStartStreamData) error
	JobInputCommand(ctx context.Context, data CommandJobInputData) error
	JobCmdExitedCommand(ctx context.Context, data CommandJobCmdExitedData) error // this is sent FROM the job manager => main server

	// job controller
	JobControllerDeleteJobCommand(ctx context.Context, jobId string) error
	JobControllerListCommand(ctx context.Context) ([]*waveobj.Job, error)
	JobControllerStartJobCommand(ctx context.Context, data CommandJobControllerStartJobData) (string, error)
	JobControllerExitJobCommand(ctx context.Context, jobId string) error
	JobControllerDisconnectJobCommand(ctx context.Context, jobId string) error
	JobControllerReconnectJobCommand(ctx context.Context, jobId string) error
	JobControllerReconnectJobsForConnCommand(ctx context.Context, connName string) error
	JobControllerConnectedJobsCommand(ctx context.Context) ([]string, error)
	JobControllerAttachJobCommand(ctx context.Context, data CommandJobControllerAttachJobData) error
	JobControllerDetachJobCommand(ctx context.Context, jobId string) error
	JobControllerGetAllJobManagerStatusCommand(ctx context.Context) ([]*JobManagerStatusUpdate, error)
	BlockJobStatusCommand(ctx context.Context, blockId string) (*BlockJobStatusData, error)
}

// for frontend
// CommonTextSyncPendingResult carries the items the remote has not confirmed yet.
type CommonTextSyncPendingResult struct {
	// Pending is the derived state per item; kept parallel to Ids so a caller can show a title
	// without a second query.
	Pending []wconfig.CommonTextItemType `json:"pending"`
}

// CommonTextSyncMarkSyncedData is the per-item push outcome, so the receiver can record
// syncedrev / syncedupdatedat exactly like the in-app engine does.
type CommonTextSyncMarkSyncedData struct {
	Results []syncproto.PushItemResult `json:"results"`
}

type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type RpcOpts struct {
	Timeout    int64  `json:"timeout,omitempty"`
	NoResponse bool   `json:"noresponse,omitempty"`
	Route      string `json:"route,omitempty"`

	StreamCancelFn func(context.Context) error `json:"-"` // this is an *output* parameter, set by the handler
}

type RpcContext struct {
	SockName  string `json:"sockname,omitempty"`  // the domain socket name
	RouteId   string `json:"routeid"`             // the routeid from the jwt
	ProcRoute bool   `json:"procroute,omitempty"` // use a random procid for route
	BlockId   string `json:"blockid,omitempty"`   // blockid for this rpc
	Conn      string `json:"conn,omitempty"`      // the conn name
	IsRouter  bool   `json:"isrouter,omitempty"`  // if this is for a sub-router
	// External agent access (design §10.5.3). Empty Scope = in-app token.
	AgentName string   `json:"agentname,omitempty"`
	Scope     []string `json:"scope,omitempty"`
}

func (rc RpcContext) GenerateRouteId() string {
	if rc.RouteId != "" {
		return rc.RouteId
	}
	return "proc:" + uuid.New().String()
}

type CommandAuthenticateRtnData struct {
	RouteId string `json:"routeid"`
	// external agent scopes proved by the token (empty = app-level)
	Scopes    []string `json:"scopes,omitempty"`
	AgentName string   `json:"agentname,omitempty"`
	TokenId   string   `json:"tokenid,omitempty"` // jti, for audit + revocation

	// these fields are only set when doing a token swap
	Env            map[string]string `json:"env,omitempty"`
	InitScriptText string            `json:"initscripttext,omitempty"`
	RpcContext     *RpcContext       `json:"rpccontext,omitempty"`
}

type CommandAuthenticateTokenData struct {
	Token string `json:"token"`
}

type CommandDisposeData struct {
	RouteId string `json:"routeid"`
	// auth token travels in the packet directly
}

type CommandMessageData struct {
	Message string `json:"message"`
}

type CommandGetMetaData struct {
	ORef waveobj.ORef `json:"oref"`
}

type CommandSetMetaData struct {
	ORef waveobj.ORef        `json:"oref"`
	Meta waveobj.MetaMapType `json:"meta"`
}

type CommandResolveIdsData struct {
	BlockId string   `json:"blockid"`
	Ids     []string `json:"ids"`
}

type CommandResolveIdsRtnData struct {
	ResolvedIds map[string]waveobj.ORef `json:"resolvedids"`
}

type CommandCreateBlockData struct {
	TabId         string               `json:"tabid"`
	BlockDef      *waveobj.BlockDef    `json:"blockdef"`
	RtOpts        *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
	Magnified     bool                 `json:"magnified,omitempty"`
	Ephemeral     bool                 `json:"ephemeral,omitempty"`
	Focused       bool                 `json:"focused,omitempty"`
	TargetBlockId string               `json:"targetblockid,omitempty"`
	TargetAction  string               `json:"targetaction,omitempty"` // "replace", "splitright", "splitdown", "splitleft", "splitup"
}

type CommandCreateSubBlockData struct {
	ParentBlockId string            `json:"parentblockid"`
	BlockDef      *waveobj.BlockDef `json:"blockdef"`
}

type CommandControllerResyncData struct {
	ForceRestart bool                 `json:"forcerestart,omitempty"`
	TabId        string               `json:"tabid"`
	BlockId      string               `json:"blockid"`
	RtOpts       *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
}

type CommandControllerAppendOutputData struct {
	BlockId string `json:"blockid"`
	Data64  string `json:"data64"`
}

type CommandBlockInputData struct {
	BlockId     string            `json:"blockid"`
	InputData64 string            `json:"inputdata64,omitempty"`
	SigName     string            `json:"signame,omitempty"`
	TermSize    *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandJobInputData struct {
	JobId          string            `json:"jobid"`
	InputSessionId string            `json:"inputsessionid,omitempty"`
	SeqNum         int               `json:"seqnum,omitempty"`
	InputData64    string            `json:"inputdata64,omitempty"`
	SigName        string            `json:"signame,omitempty"`
	TermSize       *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandWaitForRouteData struct {
	RouteId string `json:"routeid"`
	WaitMs  int    `json:"waitms"`
}

type CommandDeleteBlockData struct {
	BlockId string `json:"blockid"`
}

type CommandEventReadHistoryData struct {
	Event    string `json:"event"`
	Scope    string `json:"scope"`
	MaxItems int    `json:"maxitems"`
}

type CpuDataRequest struct {
	Id    string `json:"id"`
	Count int    `json:"count"`
}

type CpuDataType struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

type CommandFileRestoreBackupData struct {
	BackupFilePath    string `json:"backupfilepath"`
	RestoreToFileName string `json:"restoretofilename"`
}

type CommandGetTempDirData struct {
	FileName string `json:"filename,omitempty"`
}

type CommandWriteTempFileData struct {
	FileName string `json:"filename"`
	Data64   string `json:"data64"`
}

type ConnRequest struct {
	Host       string               `json:"host"`
	Keywords   wconfig.ConnKeywords `json:"keywords,omitempty"`
	LogBlockId string               `json:"logblockid,omitempty"`
}

type RemoteInfo struct {
	ClientArch    string `json:"clientarch"`
	ClientOs      string `json:"clientos"`
	ClientVersion string `json:"clientversion"`
	Shell         string `json:"shell"`
	HomeDir       string `json:"homedir"`
}

const (
	TimeSeries_Cpu = "cpu"
)

type TimeSeriesData struct {
	Ts     int64              `json:"ts"`
	Values map[string]float64 `json:"values"`
}

type MetaSettingsType struct {
	waveobj.MetaMapType
}

func (m *MetaSettingsType) UnmarshalJSON(data []byte) error {
	var metaMap waveobj.MetaMapType
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&metaMap); err != nil {
		return err
	}
	*m = MetaSettingsType{MetaMapType: metaMap}
	return nil
}

func (m MetaSettingsType) MarshalJSON() ([]byte, error) {
	return json.Marshal(m.MetaMapType)
}

type ConnConfigRequest struct {
	Host        string              `json:"host"`
	MetaMapType waveobj.MetaMapType `json:"metamaptype"`
}

// ConnectionSource records where a connection name came from. The Connect-to list merges several
// sources and used to flatten them into []string, which threw the provenance away — a user could
// not tell an entry they typed into settings.json from one their ~/.ssh/config owns (deleting the
// former works, deleting the latter just brings it back).
type ConnectionSource string

const (
	// ConnSourceSshConfig: the name appears in ~/.ssh/config or /etc/ssh/config.
	ConnSourceSshConfig ConnectionSource = "sshconfig"
	// ConnSourceSettings: the name is configured in settings.json (connections.<name>).
	ConnSourceSettings ConnectionSource = "settings"
	// ConnSourceHistory: no current config, but this machine connected to it before.
	ConnSourceHistory ConnectionSource = "history"
)

// ConnectionDetailItem is one row of the Connect-to list with its provenance.
type ConnectionDetailItem struct {
	Name string `json:"name"`
	// Sources is ordered by precedence (settings > sshconfig > history) so a consumer can show the
	// first entry when it only has room for one badge.
	Sources []ConnectionSource `json:"sources"`
	// Connected / HasConnected mirror ConnStatus so the caller does not need a second RPC.
	Connected    bool `json:"connected"`
	HasConnected bool `json:"hasconnected"`
}

type ConnStatus struct {
	Status                        string `json:"status"`
	ConnHealthStatus              string `json:"connhealthstatus,omitempty"`
	WshEnabled                    bool   `json:"wshenabled"`
	Connection                    string `json:"connection"`
	Connected                     bool   `json:"connected"`
	HasConnected                  bool   `json:"hasconnected"` // true if it has *ever* connected successfully
	ActiveConnNum                 int    `json:"activeconnnum"`
	Error                         string `json:"error,omitempty"`
	WshError                      string `json:"wsherror,omitempty"`
	NoWshReason                   string `json:"nowshreason,omitempty"`
	WshErrorCode                  string `json:"wsherrorcode,omitempty"`
	WshInstallStatus              string `json:"wshinstallstatus,omitempty"`
	WshInstallMsg                 string `json:"wshinstallmsg,omitempty"`
	WshVersion                    string `json:"wshversion,omitempty"`
	LastActivityBeforeStalledTime int64  `json:"lastactivitybeforestalledtime,omitempty"`
	KeepAliveSentTime             int64  `json:"keepalivesenttime,omitempty"`
}

type WebSelectorOpts struct {
	All   bool `json:"all,omitempty"`
	Inner bool `json:"inner,omitempty"`
}

type CommandWebSelectorData struct {
	WorkspaceId string           `json:"workspaceid"`
	BlockId     string           `json:"blockid"`
	TabId       string           `json:"tabid"`
	Selector    string           `json:"selector"`
	Opts        *WebSelectorOpts `json:"opts,omitempty"`
}

type BlockInfoData struct {
	BlockId     string          `json:"blockid"`
	TabId       string          `json:"tabid"`
	WorkspaceId string          `json:"workspaceid"`
	Block       *waveobj.Block  `json:"block"`
	Files       []*WaveFileInfo `json:"files"`
}

type WaveNotificationOptions struct {
	Title  string `json:"title,omitempty"`
	Body   string `json:"body,omitempty"`
	Silent bool   `json:"silent,omitempty"`

	// Agent toast — when AgentKind is set, the main process routes the call through the
	// agent-status OS-notify module (settings-driven suppression, focused-window check, click
	// → focus the originating block). Omit for plain notifications (updater / wsh notify).
	AgentKind     string `json:"agentkind,omitempty"`     // "done" | "blocked"
	AgentBlockId  string `json:"agentblockid,omitempty"`  // emit block; click focuses its tab
	AgentProvider string `json:"agentprovider,omitempty"` // claude/codex/... for the body label
}

type VDomUrlRequestData struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body,omitempty"`
}

type VDomUrlRequestResponse struct {
	StatusCode int               `json:"statuscode,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       []byte            `json:"body,omitempty"`
}

type WaveInfoData struct {
	Version   string `json:"version"`
	ClientId  string `json:"clientid"`
	BuildTime string `json:"buildtime"`
	ConfigDir string `json:"configdir"`
	DataDir   string `json:"datadir"`
}

type WorkspaceInfoData struct {
	WindowId      string             `json:"windowid"`
	WorkspaceData *waveobj.Workspace `json:"workspacedata"`
}

type BlocksListRequest struct {
	WindowId    string `json:"windowid,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
}

type BlocksListEntry struct {
	WindowId    string              `json:"windowid"`
	WorkspaceId string              `json:"workspaceid"`
	TabId       string              `json:"tabid"`
	BlockId     string              `json:"blockid"`
	Meta        waveobj.MetaMapType `json:"meta"`
}

// ---- Agent Control Surface: live session DTOs ----

const AgentControlVersion = 1

type SessionLiveRequest struct {
	IncludeIdle bool     `json:"includeidle,omitempty"`
	MaxRows     int      `json:"maxrows,omitempty"`
	BlockIds    []string `json:"blockids,omitempty"`
}

type SessionLiveIssue struct {
	State       string `json:"state"`
	PrevState   string `json:"prevstate,omitempty"`
	Phase       string `json:"phase,omitempty"`
	ToolName    string `json:"toolname,omitempty"`
	Message     string `json:"message,omitempty"`
	Reason      string `json:"reason,omitempty"`
	Source      string `json:"source,omitempty"`
	Confidence  string `json:"confidence,omitempty"`
	ActiveSince int64  `json:"activesince,omitempty"`
	UpdatedAt   int64  `json:"updatedat,omitempty"`
	ExpiresAt   int64  `json:"expiresat,omitempty"`
	Seq         int64  `json:"seq,omitempty"`
	Freshness   string `json:"freshness"`
}

type SessionLiveChat struct {
	State           string   `json:"state"`
	Provisional     bool     `json:"provisional,omitempty"`
	IsStreaming     bool     `json:"isstreaming,omitempty"`
	ModelProvider   string   `json:"modelprovider,omitempty"`
	ModelId         string   `json:"modelid,omitempty"`
	ThinkingLevel   string   `json:"thinkinglevel,omitempty"`
	ContextUsagePct *float64 `json:"contextusagepct,omitempty"`
	MessageCount    int      `json:"messagecount,omitempty"`
	LastUsedAt      int64    `json:"lastusedat,omitempty"`
}

// AgentPropValue is the wire form of aisessions.PropertyCell. It is duplicated
// here (instead of importing pkg/aisessions) because pkg/aisessions already
// imports wshrpc; importing it back would create a cycle.
type AgentPropValue struct {
	Type      string `json:"type,omitempty"`
	Value     any    `json:"value,omitempty"`
	Source    string `json:"source,omitempty"`
	UpdatedAt int64  `json:"updatedat,omitempty"`
}

type SessionLiveCard struct {
	Note  string                    `json:"note,omitempty"`
	Tags  []string                  `json:"tags,omitempty"`
	Props map[string]AgentPropValue `json:"props,omitempty"`
	Hash  string                    `json:"hash,omitempty"`
}

type SessionLiveRecord struct {
	BlockId     string            `json:"blockid"`
	TabId       string            `json:"tabid,omitempty"`
	WindowId    string            `json:"windowid,omitempty"`
	View        string            `json:"view"`
	Conn        string            `json:"conn,omitempty"`
	Provider    string            `json:"provider,omitempty"`
	SessionId   string            `json:"sessionid,omitempty"`
	SessionKey  string            `json:"sessionkey,omitempty"`
	Title       string            `json:"title,omitempty"`
	TitleSource string            `json:"titlesource,omitempty"`
	ProjectPath string            `json:"projectpath,omitempty"`
	Issue       *SessionLiveIssue `json:"issue"`
	Chat        *SessionLiveChat  `json:"chat"`
	Card        *SessionLiveCard  `json:"card"`
	Warnings    []string          `json:"warnings,omitempty"`
}

type SessionLiveResult struct {
	Version     int                 `json:"version"`
	GeneratedAt int64               `json:"generatedat"`
	Partial     bool                `json:"partial,omitempty"`
	Records     []SessionLiveRecord `json:"records"`
	Warnings    []string            `json:"warnings,omitempty"`
}

type SessionGetRequest struct {
	Identifier  string `json:"identifier"`
	BlockId     string `json:"blockid,omitempty"`
	IncludeIdle bool   `json:"includeidle,omitempty"`
}

type SessionListRequest struct {
	Source  string `json:"source,omitempty"`
	Query   string `json:"query,omitempty"`
	Tag     string `json:"tag,omitempty"`
	Project string `json:"project,omitempty"`
	Marked  string `json:"marked,omitempty"`
	Limit   int    `json:"limit,omitempty"`
}

type SessionListResult struct {
	Version     int                 `json:"version"`
	GeneratedAt int64               `json:"generatedat"`
	Partial     bool                `json:"partial,omitempty"`
	Records     []SessionLiveRecord `json:"records"`
	Warnings    []string            `json:"warnings,omitempty"`
}

// ---- Agent Control Surface: progressive session reading DTOs ----
// Four layers over one session (design: .trellis/tasks/11-18-aisessions-turn-reading):
// info (size probe) -> users (paged prompts) -> turns (paged turn summaries) ->
// turn (one turn's original messages). All single-session point reads on the
// message index; nothing here loads a whole session.

// SessionInfoRequest probes one session's size before reading it.
type SessionInfoRequest struct {
	Identifier string `json:"identifier"`
	// Refresh re-parses this one session's messages when the message index is
	// stale (single-file, no directory scan) before probing.
	Refresh bool `json:"refresh,omitempty"`
}

// SessionUsersRequest reads one page of user prompts.
type SessionUsersRequest struct {
	Identifier string `json:"identifier"`
	// Limit defaults to 20, max 100.
	Limit int `json:"limit,omitempty"`
	// BeforeSeq pages older prompts (seq < BeforeSeq); 0 starts from the newest.
	BeforeSeq int  `json:"beforeSeq,omitempty"`
	Refresh   bool `json:"refresh,omitempty"`
}

// SessionTurnsRequest reads one page of turn summaries. Limit must be passed
// explicitly and be within 1-10: the stateless gate that guarantees a page can
// never pull the whole session.
type SessionTurnsRequest struct {
	Identifier string `json:"identifier"`
	Limit      int    `json:"limit"`
	// BeforeTurn pages older turns (turn < BeforeTurn); 0 starts from the newest.
	BeforeTurn int  `json:"beforeTurn,omitempty"`
	Refresh    bool `json:"refresh,omitempty"`
}

// SessionTurnRequest reads one turn's original messages under a chars budget.
// Chars must be passed explicitly and be within 1-8000.
type SessionTurnRequest struct {
	Identifier string `json:"identifier"`
	Turn       int    `json:"turn"`
	Chars      int    `json:"chars"`
	Refresh    bool   `json:"refresh,omitempty"`
}

// SessionInfoResult is the size probe: counts/bytes/verdict/stale, no content.
type SessionInfoResult struct {
	SessionKey       string `json:"sessionKey"`
	MessageCount     int    `json:"messageCount"`
	UserMessageCount int    `json:"userMessageCount"`
	Bytes            int64  `json:"bytes"`
	LastMessageAt    int64  `json:"lastMessageAt,omitempty"`
	Verdict          string `json:"verdict"`
	Stale            bool   `json:"stale,omitempty"`
}

// SessionUserEntry is one user prompt on a SessionUsersResult page.
type SessionUserEntry struct {
	Seq       int    `json:"seq"`
	At        int64  `json:"at,omitempty"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}

// SessionUsersResult is one page of user prompts (oldest -> newest inside the
// page; pages walk backwards via NextBeforeSeq).
type SessionUsersResult struct {
	Rows          []SessionUserEntry `json:"rows"`
	NextBeforeSeq int                `json:"nextBeforeSeq,omitempty"`
	HasMore       bool               `json:"hasMore"`
	Stale         bool               `json:"stale,omitempty"`
}

// SessionTurnEntry is one turn summary on a SessionTurnsResult page.
type SessionTurnEntry struct {
	Turn      int    `json:"turn"`
	Seq       int    `json:"seq"`
	At        int64  `json:"at,omitempty"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
	ToolCount int    `json:"toolCount"`
	Chars     int    `json:"chars"`
	Ms        int64  `json:"ms"`
}

// SessionTurnsResult is one page of turn summaries. Turn numbers start at 1 and
// never include the preface (rows before the first user message).
type SessionTurnsResult struct {
	Rows           []SessionTurnEntry `json:"rows"`
	NextBeforeTurn int                `json:"nextBeforeTurn,omitempty"`
	HasMore        bool               `json:"hasMore"`
	Stale          bool               `json:"stale,omitempty"`
}

// SessionTurnMessageEntry is one original message of a SessionTurnResult.
type SessionTurnMessageEntry struct {
	Seq       int    `json:"seq"`
	Role      string `json:"role"`
	At        int64  `json:"at,omitempty"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}

// SessionTurnResult is one turn's original messages under the chars budget.
type SessionTurnResult struct {
	Turn       int                       `json:"turn"`
	Rows       []SessionTurnMessageEntry `json:"rows"`
	Truncated  bool                      `json:"truncated"`
	TotalChars int                       `json:"totalChars"`
	Stale      bool                      `json:"stale,omitempty"`
}

// ---- Agent Control Surface: session card DTOs ----

// AgentCardGetRequest identifies the session whose card should be read. `this`
// resolves from BlockId (WAVETERM_BLOCKID in a block).
type AgentCardGetRequest struct {
	Identifier string `json:"identifier"`
	BlockId    string `json:"blockid,omitempty"`
}

// AgentCardResult is the read side of a session card. Hash is the value the
// caller must echo back as ExpectedHash to prove it saw the current state.
type AgentCardResult struct {
	Version     int              `json:"version"`
	SessionKey  string           `json:"sessionkey"`
	SessionId   string           `json:"sessionid"`
	Provider    string           `json:"provider"`
	Summary     *SessionLiveCard `json:"summary"`
	Title       string           `json:"title"`
	TitleSource string           `json:"titlesource"`
	// Persona is intentionally always nil in v1: avatar/persona live only in
	// frontend localStorage (design §15 D3), so the backend cannot read or write them.
	Persona   *any   `json:"persona"`
	Hash      string `json:"hash"`
	UpdatedAt int64  `json:"updatedat"`
	// Schema lists the property definitions visible to this session, already
	// filtered by scope ("" = global, "agent:<source>" = this agent). External
	// callers use it to learn which properties exist and where they apply.
	Schema []wconfig.AgentPropertyDefType `json:"schema,omitempty"`
}

// AgentCardTagPatch mirrors agentdata.TagPatch without importing it: agentdata
// transitively imports wshrpc, so referencing its types here would be a cycle.
type AgentCardTagPatch struct {
	Set    []string `json:"set,omitempty"`
	Add    []string `json:"add,omitempty"`
	Remove []string `json:"remove,omitempty"`
	// HasSet distinguishes "set to empty" (clear) from "not provided".
	HasSet bool `json:"hasset,omitempty"`
}

// AgentCardPropPatch mirrors agentdata.PropPatch.
type AgentCardPropPatch struct {
	Type  string `json:"type"`
	Value any    `json:"value"`
	Name  string `json:"name,omitempty"`
	// Scope is "session" (default/empty), "agent" or "all". agent/all also
	// upsert the property definition into agent:propertyschema.
	Scope string `json:"scope,omitempty"`
	// AddOptions appends option values to the property definition
	// (select/multi_select/status only). Requires scope agent or all, because
	// the appended options live in agent:propertyschema.
	AddOptions []string `json:"addoptions,omitempty"`
}

// AgentCardChangeReport mirrors agentdata.ChangeReport.
type AgentCardChangeReport struct {
	Field  string `json:"field"`
	Before any    `json:"before"`
	After  any    `json:"after"`
}

// AgentCardSetResult is the flattened agentdata.Report the CLI renders.
type AgentCardSetResult struct {
	DryRun    bool                    `json:"dryrun"`
	Changed   bool                    `json:"changed"`
	Target    string                  `json:"target,omitempty"`
	Changes   []AgentCardChangeReport `json:"changes,omitempty"`
	Messages  []string                `json:"messages,omitempty"`
	Skipped   []string                `json:"skipped,omitempty"`
	BackupIds []string                `json:"backupids,omitempty"`
}

// AgentCardSetRequest is the write side. Exactly one patch operation is built
// from these fields, so note/tags/title/props applied together are atomic.
type AgentCardSetRequest struct {
	Identifier        string                        `json:"identifier"`
	BlockId           string                        `json:"blockid,omitempty"`
	Note              *string                       `json:"note,omitempty"`
	Tags              *AgentCardTagPatch            `json:"tags,omitempty"`
	Title             *string                       `json:"title,omitempty"`
	Props             map[string]AgentCardPropPatch `json:"props,omitempty"`
	Force             bool                          `json:"force,omitempty"`
	ExpectedHash      string                        `json:"expectedhash,omitempty"`
	ExpectedUpdatedAt int64                         `json:"expectedupdatedat,omitempty"`
	DryRun            bool                          `json:"dryrun,omitempty"`
	Yes               bool                          `json:"yes,omitempty"`
}

// ---- Agent Control Surface: session annotate DTOs ----

// SessionAnnotateRequest writes one machine annotation draft onto a session
// timeline node. Anchors are "tail" (the last anchorable message) or an exact
// message itemKey; a hallucinated key is refused with E_NOT_FOUND.
type SessionAnnotateRequest struct {
	Identifier string   `json:"identifier"`
	BlockId    string   `json:"blockid,omitempty"`
	Anchor     string   `json:"anchor"`
	Kind       string   `json:"kind,omitempty"`
	Title      string   `json:"title,omitempty"`
	Body       string   `json:"body,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	// Status defaults to draft. accepted requires Force (a machine never claims
	// acceptance on its own).
	Status string `json:"status,omitempty"`
	Force  bool   `json:"force,omitempty"`
	// ExpectedHash is the card hash from a fresh `session get` / `agent card get`;
	// a real write (Yes) requires it and a mismatch is E_CONFLICT.
	ExpectedHash string `json:"expectedhash,omitempty"`
	// DryRun previews without writing; the effective mode is DryRun || !Yes.
	DryRun  bool   `json:"dryrun,omitempty"`
	Yes     bool   `json:"yes,omitempty"`
	AIModel string `json:"aimodel,omitempty"`
}

// SessionAnnotateRow is the wire form of the written (or would-be) annotation.
// It duplicates aisessions.AnnotationRow because aisessions imports wshrpc.
type SessionAnnotateRow struct {
	ID         int64    `json:"id"`
	AnchorKey  string   `json:"anchorKey"`
	Seq        int      `json:"seq"`
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	Tags       []string `json:"tags"`
	Status     string   `json:"status"`
	Source     string   `json:"source"`
	AIModel    string   `json:"aiModel,omitempty"`
	AnchorHash string   `json:"anchorHash,omitempty"`
	UpdatedAt  int64    `json:"updatedAt"`
}

// SessionAnnotatePreview describes the resolved anchor and what a repeat
// write would replace (ReplacedID is 0 on a fresh create).
type SessionAnnotatePreview struct {
	AnchorKey         string `json:"anchorKey"`
	AnchorPreview     string `json:"anchorPreview,omitempty"`
	AnchorRole        string `json:"anchorRole,omitempty"`
	Seq               int    `json:"seq"`
	ReplacedID        int64  `json:"replacedId,omitempty"`
	ReplacedUpdatedAt int64  `json:"replacedUpdatedAt,omitempty"`
}

// SessionAnnotateResult reports the dry-run preview or the written row.
type SessionAnnotateResult struct {
	DryRun  bool                   `json:"dryRun"`
	Written bool                   `json:"written"`
	Created bool                   `json:"created"`
	Row     SessionAnnotateRow     `json:"row"`
	Preview SessionAnnotatePreview `json:"preview"`
}

// ---- Agent Control Surface: session emoji DTOs ----

// SessionEmojiMigrationEntry is one legacy localStorage value to migrate
// (design.md §2.4): written as source=user, only when the slot is empty, with
// the three preference counters recorded on first success (idempotent by
// construction — a repeat run sees the slot occupied and skips).
type SessionEmojiMigrationEntry struct {
	Identifier string `json:"identifier"`
	Emoji      string `json:"emoji"`
}

type SessionEmojiMigrateRequest struct {
	Entries []SessionEmojiMigrationEntry `json:"entries"`
}

type SessionEmojiMigrationResult struct {
	Identifier string `json:"identifier"`
	SessionKey string `json:"sessionKey"`
	Emoji      string `json:"emoji"`
}

type SessionEmojiMigrationSkip struct {
	Identifier string `json:"identifier"`
	Reason     string `json:"reason"`
}

type SessionEmojiMigrateResult struct {
	Migrated []SessionEmojiMigrationResult `json:"migrated,omitempty"`
	Skipped  []SessionEmojiMigrationSkip   `json:"skipped,omitempty"`
}

// SessionEmojiPropsListRequest is the no-arg read of every backend emoji
// prop (startup bootstrap of the frontend backend-emoji layer). The empty
// struct is kept explicit for future filters.
type SessionEmojiPropsListRequest struct{}

// SessionEmojiPropEntry is one emoji prop joined to its session. ID is empty
// when the ai_sessions row is gone; SessionKey always identifies the slot.
type SessionEmojiPropEntry struct {
	SessionKey string `json:"sessionKey"`
	ID         string `json:"id"`
	Emoji      string `json:"emoji"`
	Source     string `json:"source"`
	UpdatedAt  int64  `json:"updatedAt"`
}

type SessionEmojiPropsListResult struct {
	Entries []SessionEmojiPropEntry `json:"entries"`
}

// SessionEmojiGetRequest reads the backend emoji prop (ai_session_props
// prop_key='emoji') of one session.
type SessionEmojiGetRequest struct {
	Identifier string `json:"identifier"`
	BlockId    string `json:"blockid,omitempty"`
}

// SessionEmojiGetResult is the current emoji value (empty = never set) plus its
// source (user | ai) and last-write time.
type SessionEmojiGetResult struct {
	SessionKey string `json:"sessionKey"`
	ID         string `json:"id"`
	Emoji      string `json:"emoji"`
	Source     string `json:"source"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// SessionEmojiRecordPickRequest records one UI hand-pick (source=user): the
// emoji prop plus the three preference counters, in one transaction. An empty
// Emoji is the "clear" action (prop deleted, counters decremented with floor 0).
// This is the UI channel; agent writes must use sessionemojiset instead.
type SessionEmojiRecordPickRequest struct {
	Identifier string `json:"identifier"`
	BlockId    string `json:"blockid,omitempty"`
	// Emoji is the picked single emoji grapheme; empty string = clear.
	Emoji string `json:"emoji"`
}

type SessionEmojiRecordPickResult struct {
	SessionKey string `json:"sessionKey"`
	ID         string `json:"id"`
	Emoji      string `json:"emoji"`
	Cleared    bool   `json:"cleared"`
}

// SessionEmojiSetRequest writes the emoji with agent-channel semantics: the
// stored source is always "ai", a user-authored value is skipped (force
// overrides), and ifAbsent makes an existing slot an idempotent no-op. A real
// write requires --yes plus a concurrency precondition (expected-hash or
// expected-updated-at); ifAbsent alone is the idempotence guard, not a
// precondition substitute (拍板 #2: --if-absent 免 --expected-hash).
type SessionEmojiSetRequest struct {
	Identifier        string `json:"identifier"`
	BlockId           string `json:"blockid,omitempty"`
	Emoji             string `json:"emoji"`
	IfAbsent          bool   `json:"ifabsent,omitempty"`
	Force             bool   `json:"force,omitempty"`
	ExpectedHash      string `json:"expectedhash,omitempty"`
	ExpectedUpdatedAt int64  `json:"expectedupdatedat,omitempty"`
	DryRun            bool   `json:"dryrun,omitempty"`
	Yes               bool   `json:"yes,omitempty"`
}

// SessionEmojiSetResult mirrors the agentdata report shape: Changed reports
// whether the value moved, Skipped carries the per-slot skip reasons (e.g.
// "emoji: exists (--if-absent)", "emoji: user-authored value").
type SessionEmojiSetResult struct {
	DryRun   bool     `json:"dryRun"`
	Changed  bool     `json:"changed"`
	Target   string   `json:"target,omitempty"`
	Skipped  []string `json:"skipped,omitempty"`
	Messages []string `json:"messages,omitempty"`
}

// SessionEmojiRecommendation is one externally injected candidate (design.md
// §8.2: 所有推荐来源都是外部 agent，内部只展示).
type SessionEmojiRecommendation struct {
	Emoji  string `json:"emoji"`
	Reason string `json:"reason,omitempty"`
}

// SessionEmojiInjectRequest writes an external agent's live recommendations
// for one session, replacing any previous injection wholesale.
type SessionEmojiInjectRequest struct {
	Identifier string                       `json:"identifier"`
	BlockId    string                       `json:"blockid,omitempty"`
	InjectedBy string                       `json:"injectedBy,omitempty"`
	Candidates []SessionEmojiRecommendation `json:"candidates"`
	// TTLSeconds expires the injection; <= 0 keeps it until replaced or cleared
	// (an empty candidates list clears it immediately).
	TTLSeconds int64 `json:"ttlSeconds,omitempty"`
}

type SessionEmojiInjectResult struct {
	SessionKey string `json:"sessionKey"`
	Candidates int    `json:"candidates"`
}

// SessionEmojiRecommendationsRequest reads the current injected recommendation
// payload: Found=false when absent or expired, and the picker then hides the
// recommendation section entirely (有就显示，没有就不显示).
type SessionEmojiRecommendationsRequest struct {
	Identifier string `json:"identifier"`
	BlockId    string `json:"blockid,omitempty"`
}

type SessionEmojiRecommendationsResult struct {
	SessionKey string                       `json:"sessionKey"`
	Found      bool                         `json:"found"`
	InjectedBy string                       `json:"injectedBy,omitempty"`
	InjectedAt int64                        `json:"injectedAt,omitempty"`
	ExpiresAt  int64                        `json:"expiresAt,omitempty"`
	Candidates []SessionEmojiRecommendation `json:"candidates,omitempty"`
}

// SessionEmojiPrefsRequest reads the preference counters an external recommender
// can consult (project / persona / global dims) before injecting.
type SessionEmojiPrefsRequest struct {
	Identifier string `json:"identifier"`
	BlockId    string `json:"blockid,omitempty"`
}

type SessionEmojiPrefsResult struct {
	SessionKey  string         `json:"sessionKey"`
	Project     map[string]int `json:"project,omitempty"`
	Persona     map[string]int `json:"persona,omitempty"`
	Global      map[string]int `json:"global,omitempty"`
	PrefVersion int64          `json:"prefVersion"`
}

// ---- Agent Control Surface: UI observe + navigate DTOs ----

// UIActiveRequest is the input for `wsh ui active`. BlockId/TabId carry the
// caller's own location when env (WAVETERM_BLOCKID/TABID) is unavailable.
type UIActiveRequest struct {
	BlockId string `json:"blockid,omitempty"`
	TabId   string `json:"tabid,omitempty"`
}

// UIActiveSelf is where the caller (the agent) is standing.
type UIActiveSelf struct {
	TabId    string `json:"tabid,omitempty"`
	BlockId  string `json:"blockid,omitempty"`
	BlockNum int    `json:"blocknum,omitempty"`
}

// UIActiveTarget is where the user is actually looking.
type UIActiveTarget struct {
	WindowId    string `json:"windowid,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
	TabId       string `json:"tabid,omitempty"`
	TabName     string `json:"tabname,omitempty"`
	BlockId     string `json:"blockid,omitempty"`
	View        string `json:"view,omitempty"`
	Title       string `json:"title,omitempty"`
}

// UIActiveSnapshot answers "where am I" vs "where is the user". Self and
// Active are separate objects on purpose: the whole point is that they differ.
type UIActiveSnapshot struct {
	Version     int             `json:"version"`
	GeneratedAt int64           `json:"generatedat"`
	Self        UIActiveSelf    `json:"self"`
	Active      *UIActiveTarget `json:"active"`
	Warnings    []string        `json:"warnings,omitempty"`
}

type UIStateRequest struct {
	WindowId    string `json:"windowid,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
	IncludeIdle bool   `json:"includeidle,omitempty"`
}

type UIBlockState struct {
	BlockId     string              `json:"blockid"`
	TabId       string              `json:"tabid,omitempty"`
	WorkspaceId string              `json:"workspaceid,omitempty"`
	View        string              `json:"view,omitempty"`
	Title       string              `json:"title,omitempty"`
	Controller  string              `json:"controller,omitempty"`
	Runtime     *UIBlockRuntime     `json:"runtime,omitempty"`
	Agent       *SessionLiveIssue   `json:"agent,omitempty"`
	Meta        waveobj.MetaMapType `json:"meta,omitempty"`
}

type UIBlockRuntime struct {
	ShellProcStatus string `json:"shellprocstatus,omitempty"`
	TsunamiPort     int    `json:"tsunamiport,omitempty"`
}

type UIStateTab struct {
	TabId       string `json:"tabid"`
	Name        string `json:"name,omitempty"`
	Active      bool   `json:"active,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
}

type UIStateSnapshot struct {
	Version     int               `json:"version"`
	GeneratedAt int64             `json:"generatedat"`
	Windows     []string          `json:"windows,omitempty"`
	Tabs        []UIStateTab      `json:"tabs,omitempty"`
	Blocks      []UIBlockState    `json:"blocks,omitempty"`
	Sources     map[string]string `json:"sources,omitempty"`
	Warnings    []string          `json:"warnings,omitempty"`
}

type BlockReadRequest struct {
	BlockId     string `json:"blockid"`
	Tail        int    `json:"tail,omitempty"`
	MaxBytes    int    `json:"maxbytes,omitempty"`
	LastCommand bool   `json:"lastcommand,omitempty"`
}

type BlockReadResult struct {
	Version   int            `json:"version"`
	BlockId   string         `json:"blockid"`
	View      string         `json:"view"`
	Kind      string         `json:"kind"`
	Truncated bool           `json:"truncated"`
	Bytes     int            `json:"bytes"`
	Payload   map[string]any `json:"payload"`
	Warnings  []string       `json:"warnings,omitempty"`
}

type BlockOpenRequest struct {
	View        string              `json:"view"`
	Tab         string              `json:"tab,omitempty"` // active | new | <tabid>
	WorkspaceId string              `json:"workspaceid,omitempty"`
	Split       string              `json:"split,omitempty"`   // right|down|left|up
	Replace     string              `json:"replace,omitempty"` // block id to replace
	Magnified   bool                `json:"magnified,omitempty"`
	NoFocus     bool                `json:"nofocus,omitempty"`
	Wait        bool                `json:"wait,omitempty"`
	WaitMs      int                 `json:"waitms,omitempty"`
	Dedupe      bool                `json:"dedupe,omitempty"`
	Meta        waveobj.MetaMapType `json:"meta,omitempty"`
}

type BlockOpenResult struct {
	Version   int      `json:"version"`
	Ok        bool     `json:"ok"`
	TabId     string   `json:"tabid,omitempty"`
	BlockId   string   `json:"blockid,omitempty"`
	BlockNum  int      `json:"blocknum,omitempty"`
	View      string   `json:"view,omitempty"`
	Deduped   bool     `json:"deduped,omitempty"`
	SyncState string   `json:"syncstate,omitempty"` // db-only | layout-applied
	WaitedMs  int      `json:"waitedms,omitempty"`
	Warnings  []string `json:"warnings,omitempty"`
}

// AgentLaunchRequest is the programmatic agent-block creation surface. It
// mirrors what the GUI's "New Agent" flow produces (frontend agent-launch.ts
// createAgentBlockDef), constrained to the agent catalog: the caller picks a
// profile and optionally a model, never a raw command.
type AgentLaunchRequest struct {
	Profile     string `json:"profile"`               // required, must exist in the catalog
	Model       string `json:"model,omitempty"`       // "id" or "provider/id"; empty = profile default
	Tab         string `json:"tab,omitempty"`         // active (default) | new | <tabid>
	WorkspaceId string `json:"workspaceid,omitempty"` // only for --tab new
	Split       string `json:"split,omitempty"`       // right|down|left|up
	Cwd         string `json:"cwd,omitempty"`         // block cwd (meta cmd:cwd)
	Connection  string `json:"connection,omitempty"`  // empty = local; non-local is rejected for now
	Magnified   bool   `json:"magnified,omitempty"`
	NoFocus     bool   `json:"nofocus,omitempty"`
	Wait        bool   `json:"wait,omitempty"` // wait for the frontend to apply the layout
	WaitMs      int    `json:"waitms,omitempty"`
	// Send, when non-nil, makes launch a one-shot "create + deliver": after the
	// block is created the text is injected into the agent TUI (bracketed paste
	// + enter submit). See AgentSendRequest.
	Send *AgentSendRequest `json:"send,omitempty"`
}

// AgentLaunchResult reports the created block with the meta the caller can
// assert on (view=term, controller=cmd, agent:* keys). SyncState semantics are
// identical to BlockOpenResult.
type AgentLaunchResult struct {
	Version   int            `json:"version"`
	Ok        bool           `json:"ok"`
	TabId     string         `json:"tabid,omitempty"`
	BlockId   string         `json:"blockid,omitempty"`
	Profile   string         `json:"profile"`
	Model     string         `json:"model,omitempty"` // the model actually used (provider/id form kept)
	Cmd       string         `json:"cmd"`
	Args      []string       `json:"args,omitempty"`
	Isolation string         `json:"isolationmode"` // always "system" in v1
	SyncState string         `json:"syncstate,omitempty"`
	WaitedMs  int            `json:"waitedms,omitempty"`
	Meta      map[string]any `json:"meta,omitempty"` // the agent-relevant meta written to the block
	Warnings  []string       `json:"warnings,omitempty"`
	// Send carries the text-delivery outcome when AgentLaunchRequest.Send was set.
	Send *AgentSendResult `json:"send,omitempty"`
}

// AgentSendRequest injects text into an existing term/agent block's PTY via the
// single write path (blockcontroller.SendInput). This is the backend twin of
// the frontend CommonText pending-input chain; it never touches the frontend
// pending-input store, so the two paths cannot double-inject.
type AgentSendRequest struct {
	BlockId string `json:"blockid,omitempty"` // block id or "this"
	// Text is plain text; Text64 is base64. Exactly one must be set (Text64 wins).
	Text   string `json:"text,omitempty"`
	Text64 string `json:"text64,omitempty"`
	// Submit sends a real Enter after the paste (default true). Paste without
	// submit means the agent never receives the text (measured, see
	// commontext-insert.ts SubmitAfterPasteDelayMs). Pointer so an explicit
	// false is distinguishable from "unset".
	Submit *bool `json:"submit,omitempty"`
	// Wait waits for the TUI to be quiet before injecting (default true).
	Wait    *bool `json:"wait,omitempty"`
	WaitMs  int   `json:"waitms,omitempty"`  // readiness deadline, default 30000, max 120000
	QuietMs int   `json:"quietms,omitempty"` // output-quiet threshold, default 400, range [100,5000]
	// SubmitDelayMs is the paste→enter delay, default 150, range [0,2000].
	SubmitDelayMs int `json:"submitdelayms,omitempty"`
	// SubmitVerifyMs bounds each "did the TUI take the submit?" poll window,
	// default 700, range [200,5000]. While the poll sees no new output the CR
	// is re-sent (the pasted text is still in the input buffer).
	SubmitVerifyMs int `json:"submitverifyms,omitempty"`
	// SubmitWaitMs bounds the whole submit-confirmation window (re-sending CR
	// while the TUI stays silent, e.g. pi's 40s+ startup update checks),
	// default 60000, cap 300000. Independent of the quiet-wait WaitMs.
	SubmitWaitMs int `json:"submitwaitms,omitempty"`
	// Async turns the call into a dispatch: the server records it and returns
	// {queued:true, dispatchid} immediately, then delivers in the background
	// (readiness gate + submit confirmation, minutes-scale windows are fine).
	// Any surface that must not block (desktop UI, future mobile client) uses this.
	Async bool `json:"async,omitempty"`
	// Requester names the submitting surface (desktop / cli / mcp / mobile) so
	// dispatch records stay attributable across clients. Empty defaults to desktop.
	Requester string `json:"requester,omitempty"`
}

// AgentSendResult reports what actually happened to the text.
type AgentSendResult struct {
	Version       int    `json:"version"`
	Ok            bool   `json:"ok"`
	BlockId       string `json:"blockid"`
	View          string `json:"view"`
	Injected      bool   `json:"injected"`
	Submitted     bool   `json:"submitted"`
	WaitedMs      int    `json:"waitedms,omitempty"`
	QuietMs       int    `json:"quietms"`
	SubmitDelayMs int    `json:"submitdelayms"`
	// SubmitRetries counts re-sent CRs while the TUI stayed silent after the first
	// submit (agent TUIs swallow Enter during startup, e.g. pi "Startup is still in
	// progress"). SubmitConfirmed reports whether the term output finally moved,
	// i.e. the TUI actually took the submit.
	SubmitRetries   int      `json:"submitretries,omitempty"`
	SubmitConfirmed bool     `json:"submitconfirmed,omitempty"`
	Warnings        []string `json:"warnings,omitempty"`
	// Queued/DispatchId are set when the request carried async:true: the
	// delivery runs in the background; read AgentDispatch* for the receipt.
	Queued     bool   `json:"queued,omitempty"`
	DispatchId string `json:"dispatchid,omitempty"`
}

// AgentResumeRequest recreates an agent block for one existing session
// (`wsh agent resume`, MCP snorkeling_agent_resume). It is the programmatic
// twin of the GUI restore flow: the meta it builds (agentcontrol.
// BuildResumeBlockMeta) is field-for-field the frontend restoreMetaForSession
// contract, and the shellcontroller turns that meta into real resume args.
//
// The optional Send group mirrors AgentSendRequest semantics exactly (same
// defaults, same ranges, same normalizeSendParams); it is flattened here so a
// single RPC both recreates the block and delivers one message.
type AgentResumeRequest struct {
	Identifier  string `json:"identifier,omitempty"`  // session key / session id / "this"
	BlockId     string `json:"blockid,omitempty"`     // "this" resolution
	Connection  string `json:"connection,omitempty"`  // non-local is rejected (same as launch)
	Tab         string `json:"tab,omitempty"`         // active (default) | new | <tabid>
	WorkspaceId string `json:"workspaceid,omitempty"` // required with --tab new
	Cwd         string `json:"cwd,omitempty"`         // overrides the session project path
	NoFocus     bool   `json:"nofocus,omitempty"`
	Wait        bool   `json:"wait,omitempty"`   // wait for the frontend to apply the layout
	WaitMs      int    `json:"waitms,omitempty"` // layout wait budget, default 5000
	// Send, SendText64: the text to deliver after the block exists (Send is
	// plain text, SendText64 is base64 and wins). Delivery reuses
	// AgentSendCommand, so injected/submitted and its warnings come back in
	// Result.Send.
	Send          *string `json:"send,omitempty"`
	SendText64    string  `json:"sendtext64,omitempty"`
	Submit        *bool   `json:"submit,omitempty"`        // default true
	SendWait      *bool   `json:"sendwait,omitempty"`      // readiness wait, default true
	SendWaitMs    int     `json:"sendwaitms,omitempty"`    // readiness deadline, default 30000
	QuietMs       int     `json:"quietms,omitempty"`       // TUI quiet window, default 400
	SubmitDelayMs int     `json:"submitdelayms,omitempty"` // paste -> enter delay, default 150
}

// AgentResumeResult reports the recreated block. A delivery failure never
// rolls the block back (same atomicity as agent launch): the partial result
// carries BlockId together with the error.
type AgentResumeResult struct {
	Version     int              `json:"version"`
	Ok          bool             `json:"ok"`
	BlockId     string           `json:"blockid"`
	SessionId   string           `json:"sessionid"`
	Source      string           `json:"source"`
	ProjectPath string           `json:"projectpath,omitempty"`
	SyncState   string           `json:"syncstate,omitempty"`
	Warnings    []string         `json:"warnings,omitempty"`
	Send        *AgentSendResult `json:"send,omitempty"`
}

// SessionMarkRequest stars (`marked=true`) or unstars one session. BlockId is
// only used to resolve the `this` identifier.
type SessionMarkRequest struct {
	Identifier string `json:"identifier,omitempty"` // session key / session id / "this"
	BlockId    string `json:"blockid,omitempty"`
	Marked     bool   `json:"marked"`
}

// SessionMarkResult is the updated session summary fields a caller can assert
// on after a mark toggle (a subset of the card/record surface).
type SessionMarkResult struct {
	Version     int    `json:"version"`
	SessionKey  string `json:"sessionkey"`
	SessionId   string `json:"sessionid"`
	Source      string `json:"source"`
	Title       string `json:"title,omitempty"`
	TitleSource string `json:"titlesource,omitempty"`
	ProjectPath string `json:"projectpath,omitempty"`
	Marked      bool   `json:"marked"`
	UpdatedAt   int64  `json:"updatedat,omitempty"`
}

// AgentDispatchListRequest lists dispatch records (newest first).
type AgentDispatchListRequest struct {
	// BlockId filters to one block; empty lists all.
	BlockId string `json:"blockid,omitempty"`
	// Limit caps the result, default 50.
	Limit int `json:"limit,omitempty"`
}

// AgentDispatchGetRequest fetches one dispatch record by id.
type AgentDispatchGetRequest struct {
	DispatchId string `json:"dispatchid"`
}

// AgentDispatchRetryRequest re-queues a failed dispatch. Same id, no new record.
type AgentDispatchRetryRequest struct {
	DispatchId string `json:"dispatchid"`
}

// ScheduledTaskRunResult is the synchronous outcome of `wsh scheduledtask run`
// and the MCP run tool (also reused by `agent launch --headless`). Output is
// bounded for the wire; the full combined output lives in the file behind
// OutputPath (headless runs only).
type ScheduledTaskRunResult struct {
	TaskId     string `json:"taskid,omitempty"`
	Status     string `json:"status"` // success / error / timeout / cancelled / missed-run
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"durationms,omitempty"`
	ExitCode   int    `json:"exitcode"`
	OutputPath string `json:"outputpath,omitempty"`
	Output     string `json:"output,omitempty"` // bounded combined output
}

type TabListRequest struct {
	WorkspaceId string `json:"workspaceid,omitempty"`
}
type TabListResult struct {
	Version     int          `json:"version"`
	GeneratedAt int64        `json:"generatedat"`
	WorkspaceId string       `json:"workspaceid,omitempty"`
	ActiveTabId string       `json:"activetabid,omitempty"`
	Tabs        []UIStateTab `json:"tabs,omitempty"`
	Warnings    []string     `json:"warnings,omitempty"`
}

type TabCreateRequest struct {
	WorkspaceId string `json:"workspaceid,omitempty"`
	Name        string `json:"name,omitempty"`
	Activate    bool   `json:"activate,omitempty"`
	Wait        bool   `json:"wait,omitempty"`
	WaitMs      int    `json:"waitms,omitempty"`
}

type TabCreateResult struct {
	Version  int      `json:"version"`
	Ok       bool     `json:"ok"`
	TabId    string   `json:"tabid,omitempty"`
	TabName  string   `json:"tabname,omitempty"`
	WaitedMs int      `json:"waitedms,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

type TabActivateRequest struct {
	TabId  string `json:"tabid"`
	Wait   bool   `json:"wait,omitempty"`
	WaitMs int    `json:"waitms,omitempty"`
}

type TabActivateResult struct {
	Version  int      `json:"version"`
	Ok       bool     `json:"ok"`
	TabId    string   `json:"tabid,omitempty"`
	WaitedMs int      `json:"waitedms,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

// ---- External agent access (design §10.5.3) ----

// AgentAuthGrantRequest asks the app to mint a short-lived, revocable token for
// a process outside the app. Only callable from inside a block, because the
// socket name comes from the caller's own authenticated context.
type AgentAuthGrantRequest struct {
	Name       string   `json:"name"`
	Scope      []string `json:"scope"`
	TTLSeconds int      `json:"ttlseconds,omitempty"`
	// Out is where the app writes the token file (0600). Empty means the caller
	// stores the token itself. Letting the app write it keeps one implementation
	// of the file-permission rule for both the CLI and the settings panel.
	Out string `json:"out,omitempty"`
}

// AgentAuthTokenInfo is one row of the Agent Access panel. It never carries the
// token: the registry does not store tokens, so there is nothing to leak here.
type AgentAuthTokenInfo struct {
	Name      string   `json:"name"`
	JtiPrefix string   `json:"jtiprefix"`
	Scopes    []string `json:"scopes"`
	CreatedAt int64    `json:"createdat"`
	ExpiresAt int64    `json:"expiresat"`
	Expired   bool     `json:"expired"`
	Revoked   bool     `json:"revoked"`
}

// AgentAuthListResult lists every granted token (including revoked/expired, so
// the panel can show history; the UI filters).
type AgentAuthListResult struct {
	Version int                  `json:"version"`
	Tokens  []AgentAuthTokenInfo `json:"tokens"`
	Path    string               `json:"path"`
}

// AgentAuthRevokeRequest revokes by name, by jti, or everything.
type AgentAuthRevokeRequest struct {
	Name string `json:"name,omitempty"`
	Jti  string `json:"jti,omitempty"`
	All  bool   `json:"all,omitempty"`
}

// AgentAuthRevokeResult reports how many live tokens were revoked.
type AgentAuthRevokeResult struct {
	Revoked int `json:"revoked"`
}

// AgentSkillInstallResult reports where the bundled skill was written.
type AgentSkillInstallResult struct {
	Skill     string   `json:"skill"`
	Installed []string `json:"installed"`
	Skipped   []string `json:"skipped"`
}

// AgentMCPConfigResult carries the host config snippet for `wsh mcp serve`.
type AgentMCPConfigResult struct {
	Config string `json:"config"`
}

// AgentAuthGrantResult carries the signed token. The caller writes it to a file
// with 0600; it is never logged.
type AgentAuthGrantResult struct {
	Version   int      `json:"version"`
	Name      string   `json:"name"`
	Token     string   `json:"token"`
	Socket    string   `json:"socket"`
	RouteId   string   `json:"routeid"`
	Scopes    []string `json:"scopes"`
	ExpiresAt int64    `json:"expiresat"`
	CreatedAt int64    `json:"createdat"`
	// OutPath is the absolute path written when the request set Out.
	OutPath string `json:"outpath,omitempty"`
}

type AiMessageData struct {
	Message string `json:"message,omitempty"`
}

type CommandGetWaveAIChatData struct {
	ChatId string `json:"chatid"`
}

type CommandWaveAIToolApproveData struct {
	ToolCallId string `json:"toolcallid"`
	Approval   string `json:"approval,omitempty"`
}

type AIAttachedFile struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Size   int    `json:"size"`
	Data64 string `json:"data64"`
}

type CommandWaveAIAddContextData struct {
	Files   []AIAttachedFile `json:"files,omitempty"`
	Text    string           `json:"text,omitempty"`
	Submit  bool             `json:"submit,omitempty"`
	NewChat bool             `json:"newchat,omitempty"`
}

type CommandWaveAIGetToolDiffData struct {
	ChatId     string `json:"chatid"`
	ToolCallId string `json:"toolcallid"`
}

type CommandWaveAIGetToolDiffRtnData struct {
	OriginalContents64 string `json:"originalcontents64"`
	ModifiedContents64 string `json:"modifiedcontents64"`
}

type CommandCaptureBlockScreenshotData struct {
	BlockId string `json:"blockid"`
}

type CommandVarData struct {
	Key      string `json:"key"`
	Val      string `json:"val,omitempty"`
	Remove   bool   `json:"remove,omitempty"`
	ZoneId   string `json:"zoneid"`
	FileName string `json:"filename"`
}

type CommandVarResponseData struct {
	Key    string `json:"key"`
	Val    string `json:"val"`
	Exists bool   `json:"exists"`
}

type CommandGetBlockEnvData struct {
	BlockId  string `json:"blockid"`
	ConnName string `json:"connname,omitempty"`
}

// 无 block 的默认环境（New Agent / New Terminal 弹窗在目标无既有 block 时参考用）：
// 本地连接 = OS 基线 + waveshell 默认 + connection cmd:env；远端 = 仅 connection cmd:env delta。
type CommandGetDefaultEnvData struct {
	ConnName string `json:"connname,omitempty"`
}

type CommandGetBlockEnvRtnData struct {
	Env map[string]string `json:"env"`
}

type CommandDebugTermData struct {
	BlockId string `json:"blockid"`
	Size    int64  `json:"size"`
}

type CommandDebugTermRtnData struct {
	Offset int64  `json:"offset"`
	Data64 string `json:"data64"`
}

type PathCommandData struct {
	PathType     string `json:"pathtype"`
	Open         bool   `json:"open"`
	OpenExternal bool   `json:"openexternal"`
	TabId        string `json:"tabid"`
}

type ActivityDisplayType struct {
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	DPR      float64 `json:"dpr"`
	Internal bool    `json:"internal,omitempty"`
}

type ActivityUpdate struct {
	FgMinutes           int                   `json:"fgminutes,omitempty"`
	ActiveMinutes       int                   `json:"activeminutes,omitempty"`
	OpenMinutes         int                   `json:"openminutes,omitempty"`
	WaveAIFgMinutes     int                   `json:"waveaifgminutes,omitempty"`
	WaveAIActiveMinutes int                   `json:"waveaiactiveminutes,omitempty"`
	NumTabs             int                   `json:"numtabs,omitempty"`
	NewTab              int                   `json:"newtab,omitempty"`
	NumBlocks           int                   `json:"numblocks,omitempty"`
	NumWindows          int                   `json:"numwindows,omitempty"`
	NumWS               int                   `json:"numws,omitempty"`
	NumWSNamed          int                   `json:"numwsnamed,omitempty"`
	NumSSHConn          int                   `json:"numsshconn,omitempty"`
	NumWSLConn          int                   `json:"numwslconn,omitempty"`
	NumMagnify          int                   `json:"nummagnify,omitempty"`
	TermCommandsRun     int                   `json:"termcommandsrun,omitempty"`
	NumPanics           int                   `json:"numpanics,omitempty"`
	NumAIReqs           int                   `json:"numaireqs,omitempty"`
	Startup             int                   `json:"startup,omitempty"`
	Shutdown            int                   `json:"shutdown,omitempty"`
	SetTabTheme         int                   `json:"settabtheme,omitempty"`
	BuildTime           string                `json:"buildtime,omitempty"`
	Displays            []ActivityDisplayType `json:"displays,omitempty"`
	Renderers           map[string]int        `json:"renderers,omitempty"`
	Blocks              map[string]int        `json:"blocks,omitempty"`
	WshCmds             map[string]int        `json:"wshcmds,omitempty"`
	Conn                map[string]int        `json:"conn,omitempty"`
}

type ConnExtData struct {
	ConnName   string `json:"connname"`
	LogBlockId string `json:"logblockid,omitempty"`
}

type CommandManualWshInstallData struct {
	ConnName        string `json:"connname"`
	ClientOs        string `json:"clientos"`
	ClientArch      string `json:"clientarch"`
	LocalWshPath    string `json:"localwshpath"`
	RemoteTempPath  string `json:"remotetemppath"`
	RemoteWshPath   string `json:"remotewshpath"`
	RemoteSshTarget string `json:"remotesshtarget"`
	Cmd             string `json:"cmd"`
}

type CommandConnServerInitData struct {
	ClientId string `json:"clientid"`
}

type FetchSuggestionsData struct {
	SuggestionType string `json:"suggestiontype"`
	Query          string `json:"query"`
	WidgetId       string `json:"widgetid"`
	ReqNum         int    `json:"reqnum"`
	FileCwd        string `json:"file:cwd,omitempty"`
	FileDirOnly    bool   `json:"file:dironly,omitempty"`
	FileConnection string `json:"file:connection,omitempty"`
}

type FetchSuggestionsResponse struct {
	ReqNum      int              `json:"reqnum"`
	Suggestions []SuggestionType `json:"suggestions"`
}

type SuggestionType struct {
	Type         string `json:"type"`
	SuggestionId string `json:"suggestionid"`
	Display      string `json:"display"`
	SubText      string `json:"subtext,omitempty"`
	Icon         string `json:"icon,omitempty"`
	IconColor    string `json:"iconcolor,omitempty"`
	IconSrc      string `json:"iconsrc,omitempty"`
	MatchPos     []int  `json:"matchpos,omitempty"`
	SubMatchPos  []int  `json:"submatchpos,omitempty"`
	Score        int    `json:"score,omitempty"`
	FileMimeType string `json:"file:mimetype,omitempty"`
	FilePath     string `json:"file:path,omitempty"`
	FileName     string `json:"file:name,omitempty"`
	UrlUrl       string `json:"url:url,omitempty"`
}

type CommandGetRTInfoData struct {
	ORef waveobj.ORef `json:"oref"`
}

type CommandSetRTInfoData struct {
	ORef   waveobj.ORef   `json:"oref"`
	Data   map[string]any `json:"data" tstype:"ObjRTInfo"`
	Delete bool           `json:"delete,omitempty"`
}

type CommandTermGetScrollbackLinesData struct {
	LineStart   int  `json:"linestart"`
	LineEnd     int  `json:"lineend"`
	LastCommand bool `json:"lastcommand"`
}

type CommandTermGetScrollbackLinesRtnData struct {
	TotalLines  int      `json:"totallines"`
	LineStart   int      `json:"linestart"`
	Lines       []string `json:"lines"`
	LastUpdated int64    `json:"lastupdated"`
}

type CommandTermUpdateAttachedJobData struct {
	BlockId string `json:"blockid"`
	JobId   string `json:"jobid,omitempty"`
}

type CommandElectronEncryptData struct {
	PlainText string `json:"plaintext"`
}

type CommandElectronEncryptRtnData struct {
	CipherText     string `json:"ciphertext"`
	StorageBackend string `json:"storagebackend"` // only returned for linux
}

type CommandElectronDecryptData struct {
	CipherText string `json:"ciphertext"`
}

type CommandElectronDecryptRtnData struct {
	PlainText      string `json:"plaintext"`
	StorageBackend string `json:"storagebackend"` // only returned for linux
}

type CommandStreamData struct {
	Id     string `json:"id"`  // streamid
	Seq    int64  `json:"seq"` // start offset (bytes)
	Data64 string `json:"data64,omitempty"`
	Eof    bool   `json:"eof,omitempty"`   // can be set with data or without
	Error  string `json:"error,omitempty"` // stream terminated with error
}

type CommandStreamAckData struct {
	Id     string `json:"id"`               // streamid
	Seq    int64  `json:"seq"`              // next expected byte
	RWnd   int64  `json:"rwnd"`             // receive window size
	Fin    bool   `json:"fin,omitempty"`    // observed end-of-stream (eof or error)
	Delay  int64  `json:"delay,omitempty"`  // ack delay in microseconds (from when data was received to when we sent out ack -- monotonic clock)
	Cancel bool   `json:"cancel,omitempty"` // used to cancel the stream
	Error  string `json:"error,omitempty"`  // reason for cancel (may only be set if cancel is true)
}

type StreamMeta struct {
	Id            string `json:"id"`   // streamid
	RWnd          int64  `json:"rwnd"` // initial receive window size
	ReaderRouteId string `json:"readerrouteid"`
	WriterRouteId string `json:"writerrouteid"`
}

type CommandAuthenticateToJobData struct {
	JobAccessToken string `json:"jobaccesstoken"`
}

type CommandAuthenticateJobManagerData struct {
	JobId        string `json:"jobid"`
	JobAuthToken string `json:"jobauthtoken"`
}

type CommandStartJobData struct {
	Cmd        string            `json:"cmd"`
	Args       []string          `json:"args"`
	Env        map[string]string `json:"env"`
	TermSize   waveobj.TermSize  `json:"termsize"`
	StreamMeta *StreamMeta       `json:"streammeta,omitempty"`
}

type CommandRemoteStartJobData struct {
	Cmd                string            `json:"cmd"`
	Args               []string          `json:"args"`
	Env                map[string]string `json:"env"`
	TermSize           waveobj.TermSize  `json:"termsize"`
	StreamMeta         *StreamMeta       `json:"streammeta,omitempty"`
	JobAuthToken       string            `json:"jobauthtoken"`
	JobId              string            `json:"jobid"`
	MainServerJwtToken string            `json:"mainserverjwttoken"`
	ClientId           string            `json:"clientid"`
	PublicKeyBase64    string            `json:"publickeybase64"`
}

type CommandRemoteReconnectToJobManagerData struct {
	JobId              string `json:"jobid"`
	JobAuthToken       string `json:"jobauthtoken"`
	MainServerJwtToken string `json:"mainserverjwttoken"`
	JobManagerPid      int    `json:"jobmanagerpid"`
	JobManagerStartTs  int64  `json:"jobmanagerstartts"`
}

type CommandRemoteReconnectToJobManagerRtnData struct {
	Success        bool   `json:"success"`
	JobManagerGone bool   `json:"jobmanagergone"`
	Error          string `json:"error,omitempty"`
}

type CommandRemoteDisconnectFromJobManagerData struct {
	JobId string `json:"jobid"`
}

type CommandRemoteTerminateJobManagerData struct {
	JobId             string `json:"jobid"`
	JobManagerPid     int    `json:"jobmanagerpid"`
	JobManagerStartTs int64  `json:"jobmanagerstartts"`
}

type CommandStartJobRtnData struct {
	CmdPid            int   `json:"cmdpid"`
	CmdStartTs        int64 `json:"cmdstartts"`
	JobManagerPid     int   `json:"jobmanagerpid"`
	JobManagerStartTs int64 `json:"jobmanagerstartts"`
}

type CommandJobPrepareConnectData struct {
	StreamMeta StreamMeta       `json:"streammeta"`
	Seq        int64            `json:"seq"`
	TermSize   waveobj.TermSize `json:"termsize"`
}

type CommandJobStartStreamData struct {
}

type CommandJobConnectRtnData struct {
	Seq         int64  `json:"seq"`
	StreamDone  bool   `json:"streamdone,omitempty"`
	StreamError string `json:"streamerror,omitempty"`
	HasExited   bool   `json:"hasexited,omitempty"`
	ExitCode    *int   `json:"exitcode,omitempty"`
	ExitSignal  string `json:"exitsignal,omitempty"`
	ExitErr     string `json:"exiterr,omitempty"`
}

type CommandJobCmdExitedData struct {
	JobId      string `json:"jobid"`
	ExitCode   *int   `json:"exitcode,omitempty"`
	ExitSignal string `json:"exitsignal,omitempty"`
	ExitErr    string `json:"exiterr,omitempty"`
	ExitTs     int64  `json:"exitts,omitempty"`
}

type CommandJobControllerStartJobData struct {
	ConnName string            `json:"connname"`
	JobKind  string            `json:"jobkind"`
	Cmd      string            `json:"cmd"`
	Args     []string          `json:"args"`
	Env      map[string]string `json:"env"`
	TermSize *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandJobControllerAttachJobData struct {
	JobId   string `json:"jobid"`
	BlockId string `json:"blockid"`
}

type JobManagerStatusUpdate struct {
	JobId            string `json:"jobid"`
	JobManagerStatus string `json:"jobmanagerstatus"`
}

type CommandWaveFileReadStreamData struct {
	ZoneId     string     `json:"zoneid"`
	Name       string     `json:"name"`
	StreamMeta StreamMeta `json:"streammeta"`
}

// see blockstore.go (WaveFile)
type WaveFileInfo struct {
	ZoneId    string   `json:"zoneid"`
	Name      string   `json:"name"`
	Opts      FileOpts `json:"opts"`
	CreatedTs int64    `json:"createdts"`
	Size      int64    `json:"size"`
	ModTs     int64    `json:"modts"`
	Meta      FileMeta `json:"meta"`
}

type CommandBadgeWatchPidData struct {
	Pid     int          `json:"pid"`
	ORef    waveobj.ORef `json:"oref"`
	BadgeId string       `json:"badgeid"`
}

type BlockJobStatusData struct {
	BlockId       string `json:"blockid"`
	JobId         string `json:"jobid"`
	Status        string `json:"status,omitempty" tstype:"null | \"init\" | \"connected\" | \"disconnected\" | \"done\""`
	VersionTs     int64  `json:"versionts"`
	DoneReason    string `json:"donereason,omitempty"`
	StartupError  string `json:"startuperror,omitempty"`
	CmdExitTs     int64  `json:"cmdexitts,omitempty"`
	CmdExitCode   *int   `json:"cmdexitcode,omitempty"`
	CmdExitSignal string `json:"cmdexitsignal,omitempty"`
}

type FocusedBlockData struct {
	BlockId                    string              `json:"blockid"`
	ViewType                   string              `json:"viewtype"`
	Controller                 string              `json:"controller"`
	ConnName                   string              `json:"connname"`
	BlockMeta                  waveobj.MetaMapType `json:"blockmeta"`
	TermJobStatus              *BlockJobStatusData `json:"termjobstatus,omitempty"`
	ConnStatus                 *ConnStatus         `json:"connstatus,omitempty"`
	TermShellIntegrationStatus string              `json:"termshellintegrationstatus,omitempty"`
	TermLastCommand            string              `json:"termlastcommand,omitempty"`
}

// ProcessInfo holds per-process information for the process viewer.
// Mem, MemPct, Cpu, and NumThreads are set to -1 when the data is unavailable
// (e.g. permission denied reading another user's process on macOS).
type ProcessInfo struct {
	Pid        int32   `json:"pid"`
	Ppid       int32   `json:"ppid,omitempty"`
	Command    string  `json:"command,omitempty"`
	Status     string  `json:"status,omitempty"`
	User       string  `json:"user,omitempty"`
	Mem        int64   `json:"mem"`        // resident set size in bytes; -1 if unavailable
	MemPct     float64 `json:"mempct"`     // memory percent; -1 if unavailable
	Cpu        float64 `json:"cpu"`        // cpu percent; -1 if unavailable
	NumThreads int32   `json:"numthreads"` // -1 if unavailable
	Gone       bool    `json:"gone,omitempty"`
}

type ProcessSummary struct {
	Total    int     `json:"total"`
	Load1    float64 `json:"load1,omitempty"`
	Load5    float64 `json:"load5,omitempty"`
	Load15   float64 `json:"load15,omitempty"`
	MemTotal uint64  `json:"memtotal,omitempty"`
	MemUsed  uint64  `json:"memused,omitempty"`
	MemFree  uint64  `json:"memfree,omitempty"`
	NumCPU   int     `json:"numcpu,omitempty"`
	CpuSum   float64 `json:"cpusum,omitempty"`
}

type ProcessListResponse struct {
	Processes     []ProcessInfo  `json:"processes"`
	Summary       ProcessSummary `json:"summary"`
	Ts            int64          `json:"ts"`
	HasCPU        bool           `json:"hascpu,omitempty"`
	Platform      string         `json:"platform,omitempty"`
	TotalCount    int            `json:"totalcount,omitempty"`
	FilteredCount int            `json:"filteredcount,omitempty"`
}

type CommandRemoteProcessListData struct {
	WidgetId   string `json:"widgetid,omitempty"`
	SortBy     string `json:"sortby,omitempty"`
	SortDesc   bool   `json:"sortdesc,omitempty"`
	Start      int    `json:"start,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	TextSearch string `json:"textsearch,omitempty"`
	// LastPidOrder, when set, ignores SortBy/SortDesc/TextSearch and returns processes in the order
	// they were returned in the previous request for this WidgetId (with Gone=true for dead pids).
	LastPidOrder bool `json:"lastpidorder,omitempty"`
	// KeepAlive, when set, overrides all other fields and simply keeps the backend cache alive (returns nil).
	KeepAlive bool `json:"keepalive,omitempty"`
}

type CommandRemoteProcessSignalData struct {
	Pid    int32  `json:"pid"`
	Signal string `json:"signal"`
}

type CommandRemoteFileSearchData struct {
	Path          string `json:"path"`
	Query         string `json:"query"`
	Limit         int    `json:"limit,omitempty"`
	MaxFileSize   int64  `json:"maxfilesize,omitempty"`
	IncludeHidden bool   `json:"includehidden,omitempty"`
}

type FileSearchMatch struct {
	Path       string `json:"path"`
	RelPath    string `json:"relpath,omitempty"`
	LineNumber int    `json:"linenumber"`
	LineText   string `json:"linetext"`
}

type CommandRemoteFileSearchRtnData struct {
	Matches   []FileSearchMatch `json:"matches,omitempty"`
	Truncated bool              `json:"truncated,omitempty"`
}

type CommandRemoteFileNameSearchData struct {
	Path          string `json:"path"`
	Query         string `json:"query"`
	Limit         int    `json:"limit,omitempty"`
	IncludeHidden bool   `json:"includehidden,omitempty"`
}

type FileNameSearchMatch struct {
	Path    string `json:"path"`
	RelPath string `json:"relpath,omitempty"`
	IsDir   bool   `json:"isdir,omitempty"`
}

type CommandRemoteFileNameSearchRtnData struct {
	Matches   []FileNameSearchMatch `json:"matches,omitempty"`
	Truncated bool                  `json:"truncated,omitempty"`
}

// wshrpc.VcsBranchInfo
type VcsBranchInfo struct {
	Name      string `json:"name"`
	Hash      string `json:"hash,omitempty"`
	IsCurrent bool   `json:"iscurrent,omitempty"`
	Ahead     int    `json:"ahead,omitempty"`
	Behind    int    `json:"behind,omitempty"`
	IsRemote  bool   `json:"isremote,omitempty"`
}

// wshrpc.CommandRemoteVcsBranchListData
type CommandRemoteVcsBranchListData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
}

type CommandRemoteVcsSwitchBranchData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	Branch   string `json:"branch"`
}

type RemoteVcsSwitchBranchRtnData struct {
	RepoPath string `json:"repopath"`
	Branch   string `json:"branch,omitempty"`
	Error    string `json:"error,omitempty"`
}

// wshrpc.CommandRemoteVcsCreateBranchData
// CreateBranch creates a new branch at the current HEAD (or an optional start point),
// then checks it out. For git repositories only.
type CommandRemoteVcsCreateBranchData struct {
	RepoType   string `json:"repotype"`
	RepoPath   string `json:"repopath"`
	Branch     string `json:"branch"`
	StartPoint string `json:"startpoint,omitempty"`
}

type RemoteVcsCreateBranchRtnData struct {
	RepoPath string `json:"repopath"`
	Branch   string `json:"branch,omitempty"`
	Error    string `json:"error,omitempty"`
}

// wshrpc.CommandRemoteVcsDeleteBranchData
// DeleteBranch removes a local branch that is not currently checked out.
// For git repositories only.
type CommandRemoteVcsDeleteBranchData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	Branch   string `json:"branch"`
}

type RemoteVcsDeleteBranchRtnData struct {
	RepoPath string `json:"repopath"`
	Branch   string `json:"branch,omitempty"`
	Error    string `json:"error,omitempty"`
}

// wshrpc.RemoteVcsBranchListRtnData
type RemoteVcsBranchListRtnData struct {
	RepoPath string          `json:"repopath"`
	RepoType string          `json:"repotype"`
	Current  string          `json:"current,omitempty"`
	Local    []VcsBranchInfo `json:"local,omitempty"`
	Remote   []VcsBranchInfo `json:"remote,omitempty"`
	Error    string          `json:"error,omitempty"`
}

// wshrpc.VcsPipelineRunInfo
type VcsPipelineRunInfo struct {
	Id         int64  `json:"id"`
	Name       string `json:"name,omitempty"`
	Branch     string `json:"branch,omitempty"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion,omitempty"`
	Commit     string `json:"commit,omitempty"`
	Author     string `json:"author,omitempty"`
	StartedAt  string `json:"startedat,omitempty"`
	EndedAt    string `json:"endedat,omitempty"`
	Url        string `json:"url,omitempty"`
}

// wshrpc.CommandRemoteVcsPipelineListData
type CommandRemoteVcsPipelineListData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	Limit    int    `json:"limit,omitempty"`
}

// wshrpc.RemoteVcsPipelineListRtnData
type RemoteVcsPipelineListRtnData struct {
	RepoPath string               `json:"repopath"`
	RepoType string               `json:"repotype"`
	Runs     []VcsPipelineRunInfo `json:"runs,omitempty"`
	Error    string               `json:"error,omitempty"`
}

// wshrpc.CommandRemoteVcsRepositoriesData
type CommandRemoteVcsRepositoriesData struct {
	Path          string `json:"path"`
	StatusLimit   int    `json:"statuslimit,omitempty"`
	ScanDepth     int    `json:"scandepth,omitempty"`
	IncludeParent bool   `json:"includeparent,omitempty"`
}

type VcsFileStatus struct {
	Path      string `json:"path"`
	Code      string `json:"code"`
	Staged    bool   `json:"staged,omitempty"`
	Untracked bool   `json:"untracked,omitempty"`
}

type VcsRemoteState struct {
	Upstream string          `json:"upstream,omitempty"`
	Ahead    int             `json:"ahead,omitempty"`
	Behind   int             `json:"behind,omitempty"`
	Incoming []VcsCommitInfo `json:"incoming,omitempty"`
	Outgoing []VcsCommitInfo `json:"outgoing,omitempty"`
	Files    []VcsFileStatus `json:"files,omitempty"`
	Error    string          `json:"error,omitempty"`
}

type VcsRepositoryInfo struct {
	RepoId    string          `json:"repoid"`
	RepoType  string          `json:"repotype"`
	RootPath  string          `json:"rootpath"`
	Name      string          `json:"name"`
	Branch    string          `json:"branch,omitempty"`
	RemoteUrl string          `json:"remoteurl,omitempty"`
	BrowseUrl string          `json:"browseurl,omitempty"`
	Remote    *VcsRemoteState `json:"remote,omitempty"`
	Status    []VcsFileStatus `json:"status,omitempty"`
	StatusErr string          `json:"statuserr,omitempty"`
}

type RemoteVcsRepositoriesRtnData struct {
	BasePath     string              `json:"basepath"`
	Repositories []VcsRepositoryInfo `json:"repositories"`
	Error        string              `json:"error,omitempty"`
}

type CommandRemoteVcsResolvePathData struct {
	Path string `json:"path"`
}

type RemoteVcsResolvePathRtnData struct {
	Path         string              `json:"path"`
	BasePath     string              `json:"basepath,omitempty"`
	Matched      bool                `json:"matched,omitempty"`
	Repositories []VcsRepositoryInfo `json:"repositories,omitempty"`
	RepoId       string              `json:"repoid,omitempty"`
	RepoType     string              `json:"repotype,omitempty"`
	RepoPath     string              `json:"repopath,omitempty"`
	RepoName     string              `json:"reponame,omitempty"`
	Error        string              `json:"error,omitempty"`
}

type CommandRemoteVcsCommitsData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	Limit    int    `json:"limit,omitempty"`
	Offset   int    `json:"offset,omitempty"`
	Since    string `json:"since,omitempty"`
	Until    string `json:"until,omitempty"`
	Keyword  string `json:"keyword,omitempty"`
}

type VcsCommitInfo struct {
	Hash        string   `json:"hash,omitempty"`
	Author      string   `json:"author,omitempty"`
	AuthorEmail string   `json:"authoremail,omitempty"`
	Date        string   `json:"date,omitempty"`
	Subject     string   `json:"subject,omitempty"`
	Parents     []string `json:"parents,omitempty"`
	Refs        []string `json:"refs,omitempty"`
}

type RemoteVcsCommitsRtnData struct {
	RepoPath string          `json:"repopath"`
	RepoType string          `json:"repotype"`
	Commits  []VcsCommitInfo `json:"commits"`
	Offset   int             `json:"offset,omitempty"`
	Limit    int             `json:"limit,omitempty"`
	HasMore  bool            `json:"hasmore,omitempty"`
	Error    string          `json:"error,omitempty"`
}

type CommandRemoteVcsCommitFilesData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	Revision string `json:"revision"`
	FilePath string `json:"filepath,omitempty"`
}

type VcsCommitFileInfo struct {
	Path    string `json:"path"`
	Code    string `json:"code,omitempty"`
	Added   int    `json:"added,omitempty"`
	Deleted int    `json:"deleted,omitempty"`
}

type RemoteVcsCommitFilesRtnData struct {
	RepoPath string              `json:"repopath"`
	RepoType string              `json:"repotype"`
	Revision string              `json:"revision"`
	Files    []VcsCommitFileInfo `json:"files"`
	Error    string              `json:"error,omitempty"`
}

type CommandRemoteVcsCommitData struct {
	RepoType string   `json:"repotype"`
	RepoPath string   `json:"repopath"`
	Message  string   `json:"message"`
	Files    []string `json:"files"`
}

type RemoteVcsCommitRtnData struct {
	Success bool   `json:"success"`
	Output  string `json:"output,omitempty"`
	Error   string `json:"error,omitempty"`
}

type CommandRemoteVcsSyncData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	Action   string `json:"action,omitempty"`
}

type RemoteVcsSyncRtnData struct {
	Success bool   `json:"success"`
	Output  string `json:"output,omitempty"`
	Error   string `json:"error,omitempty"`
}

type CommandRemoteVcsFileHistoryData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	FilePath string `json:"filepath"`
	Limit    int    `json:"limit,omitempty"`
}

type RemoteVcsFileHistoryRtnData struct {
	RepoPath string          `json:"repopath"`
	RepoType string          `json:"repotype"`
	FilePath string          `json:"filepath"`
	Commits  []VcsCommitInfo `json:"commits"`
	Error    string          `json:"error,omitempty"`
}

type CommandRemoteVcsFileDiffData struct {
	RepoType string `json:"repotype"`
	RepoPath string `json:"repopath"`
	FilePath string `json:"filepath"`
	Revision string `json:"revision,omitempty"`
}

type RemoteVcsFileDiffRtnData struct {
	RepoPath string  `json:"repopath"`
	RepoType string  `json:"repotype"`
	FilePath string  `json:"filepath"`
	Diff     string  `json:"diff"`
	Original *string `json:"original,omitempty"`
	Modified *string `json:"modified,omitempty"`
	Error    string  `json:"error,omitempty"`
}

// lightweight stat for the composer bar: branch + added/removed/files
type CommandRemoteVcsStatData struct {
	Path string `json:"path"`
}

type RemoteVcsStatRtnData struct {
	Branch  string `json:"branch,omitempty"`
	Added   int    `json:"added"`
	Removed int    `json:"removed"`
	Files   int    `json:"files"`
	Error   string `json:"error,omitempty"`
}
