// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const VendorConfigurationUnavailableError = "Vendor configuration is no longer available"

type AISessionsService struct{}

type AISessionsListRequest struct {
	Source              string   `json:"source,omitempty"`
	Project             string   `json:"project,omitempty"`
	Projects            []string `json:"projects,omitempty"`
	ExcludeProjects     []string `json:"excludeProjects,omitempty"`
	Query               string   `json:"query,omitempty"`
	Connection          string   `json:"connection,omitempty"`
	Limit               int      `json:"limit,omitempty"`
	Refresh             bool     `json:"refresh,omitempty"`
	Marked              string   `json:"marked,omitempty"`
	Since               int64    `json:"since,omitempty"`
	Before              int64    `json:"before,omitempty"`
	TagFilters          []string `json:"tagFilters,omitempty"`
	ExcludeTags         []string `json:"excludeTags,omitempty"`
	TagPresence         string   `json:"tagPresence,omitempty"`
	IncludeProjectPaths bool     `json:"includeProjectPaths,omitempty"`
}

type AISessionsListResponse struct {
	Sessions     []aisessions.SessionSummary     `json:"sessions"`
	ProjectPaths []aisessions.ProjectPathSummary `json:"projectPaths,omitempty"`
	// Scanning reports that a background summary scan is still filling the
	// index; the GUI renders skeleton rows plus a progress strip until it ends.
	Scanning bool `json:"scanning"`
	Scanned  int  `json:"scanned"`
	Total    int  `json:"total"`
}

type AISessionsTagsRequest struct {
	Source          string   `json:"source,omitempty"`
	Project         string   `json:"project,omitempty"`
	Projects        []string `json:"projects,omitempty"`
	ExcludeProjects []string `json:"excludeProjects,omitempty"`
	Connection      string   `json:"connection,omitempty"`
	Marked          string   `json:"marked,omitempty"`
	Since           int64    `json:"since,omitempty"`
	Before          int64    `json:"before,omitempty"`
	TagFilters      []string `json:"tagFilters,omitempty"`
	ExcludeTags     []string `json:"excludeTags,omitempty"`
	TagPresence     string   `json:"tagPresence,omitempty"`
	Refresh         bool     `json:"refresh,omitempty"`
}

type AISessionsTagsResponse struct {
	Tags []aisessions.SessionTagSummary `json:"tags"`
}

type AISessionsNoteAndTagsRequest struct {
	ID   string   `json:"id"`
	Note string   `json:"note"`
	Tags []string `json:"tags,omitempty"`
}

type AISessionsRenameTagRequest struct {
	From       string `json:"from"`
	To         string `json:"to"`
	Connection string `json:"connection,omitempty"`
}

type AISessionsRenameTagResponse struct {
	Count int `json:"count"`
}

type AISessionsDetailRequest struct {
	ID           string `json:"id"`
	Connection   string `json:"connection,omitempty"`
	Refresh      bool   `json:"refresh,omitempty"`
	Tail         int    `json:"tail,omitempty"`
	IncludeTools bool   `json:"includeTools,omitempty"`
	// LoadAll streams the whole session instead of returning one snapshot: the
	// first frame carries the EARLIEST content plus hasMore/nextMessageOffset,
	// and the caller keeps appending with DetailDelta(loadAll,messageOffset) until
	// hasMore is false. Left false, Detail behaves exactly as before.
	LoadAll bool `json:"loadAll,omitempty"`
}

type AISessionsDetailDeltaRequest struct {
	ID           string                          `json:"id"`
	Connection   string                          `json:"connection,omitempty"`
	Source       string                          `json:"source,omitempty"`
	FilePath     string                          `json:"filePath,omitempty"`
	Cursor       aisessions.SessionMessageCursor `json:"cursor"`
	MaxBytes     int64                           `json:"maxBytes,omitempty"`
	MessageCount int                             `json:"messageCount,omitempty"`
	// LoadAll + MessageOffset continue a Detail(loadAll) stream by message index
	// instead of by file byte cursor. Both unset keeps the legacy byte-delta path.
	LoadAll       bool `json:"loadAll,omitempty"`
	MessageOffset int  `json:"messageOffset,omitempty"`
	// IncludeTools keeps tool calls in continuation frames. Without it a
	// LoadAll stream shows tool cards for the first frame only, which is what
	// the GUI (agent detail, subagent cards) expects to avoid.
	IncludeTools bool `json:"includeTools,omitempty"`
}

type AISessionsUserOutlineRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	Refresh    bool   `json:"refresh,omitempty"`
	Limit      int    `json:"limit,omitempty"`
}

type AISessionsUserOutlineResponse struct {
	Summary          aisessions.SessionSummary `json:"summary"`
	Messages         []aisessions.Message      `json:"messages"`
	UserMessageCount int                       `json:"userMessageCount"`
}

type AISessionsSummaryRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	Refresh    bool   `json:"refresh,omitempty"`
}

type AISessionsGenerateMetadataRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	AIMode     string `json:"aiMode,omitempty"`
}

type AISessionsGenerateMetadataResponse struct {
	Summary    aisessions.SessionSummary     `json:"summary"`
	Suggestion aisessions.MetadataSuggestion `json:"suggestion"`
}

// AISessionsAnnotationsRequest lists the annotations of one session. anchors is
// the live message/tool list (anchorKey + seq + role + hash) the frontend has;
// when supplied, unresolved annotations are marked orphaned and drifted anchors
// are re-anchored server-side.
type AISessionsAnnotationsRequest struct {
	SessionKey string                        `json:"sessionKey"`
	Connection string                        `json:"connection,omitempty"`
	Anchors    []aisessions.AnnotationAnchor `json:"anchors,omitempty"`
}

type AISessionsAnnotationsResponse struct {
	Annotations []aisessions.AnnotationView `json:"annotations"`
}

// AISessionsAnnotationSaveRequest creates or updates one annotation. Saving a
// row that was AI-generated marks it user_edited=1 on the server.
type AISessionsAnnotationSaveRequest struct {
	ID         int64    `json:"id,omitempty"`
	SessionKey string   `json:"sessionKey"`
	AnchorKey  string   `json:"anchorKey"`
	Seq        int      `json:"seq,omitempty"`
	Kind       string   `json:"kind,omitempty"`
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	Tags       []string `json:"tags,omitempty"`
	Status     string   `json:"status,omitempty"`
	Source     string   `json:"source,omitempty"`
	AIModel    string   `json:"aiModel,omitempty"`
	Connection string   `json:"connection,omitempty"`
}

// AISessionsAnnotationSessionsRequest lists sessions that have at least one
// accepted annotation. Drafts are excluded from the cross-session list.
type AISessionsAnnotationSessionsRequest struct {
	Query           string   `json:"query,omitempty"`
	TagFilters      []string `json:"tagFilters,omitempty"`
	ProjectPrefixes []string `json:"projectPrefixes,omitempty"`
	Limit           int      `json:"limit,omitempty"`
	Offset          int      `json:"offset,omitempty"`
	Connection      string   `json:"connection,omitempty"`
}

// AISessionsAnnotationAssistRequest asks the AI for annotation drafts. It never
// writes to the database; the user decides whether to keep the drafts.
type AISessionsAnnotationAssistRequest struct {
	SessionKey string   `json:"sessionKey"`
	Connection string   `json:"connection,omitempty"`
	Scope      string   `json:"scope"` // timeline | entry-title | entry-body | entry-tags
	AnchorKey  string   `json:"anchorKey,omitempty"`
	Title      string   `json:"title,omitempty"`
	Body       string   `json:"body,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	MaxEntries int      `json:"maxEntries,omitempty"`
	AIMode     string   `json:"aiMode,omitempty"`
}

type AISessionsAnnotationAssistResponse struct {
	Drafts  []aisessions.AnnotationDraft `json:"drafts"`
	AIModel string                       `json:"aiModel,omitempty"`
}

// AISessionsAnnotationReplaceRequest replaces every AI-replaceable annotation of
// a session with the provided drafts (drafts are stored with status=draft).
type AISessionsAnnotationReplaceRequest struct {
	SessionKey  string                       `json:"sessionKey"`
	Connection  string                       `json:"connection,omitempty"`
	Annotations []aisessions.AnnotationDraft `json:"annotations"`
}

type AISessionsAnnotationSessionsResponse struct {
	Sessions []aisessions.AnnotatedSession `json:"sessions"`
	Total    int                           `json:"total"`
}

type AISessionsGenerateTitleRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
	AIMode     string `json:"aiMode,omitempty"`
}

type AISessionsGenerateTitleResponse struct {
	Summary    aisessions.SessionSummary  `json:"summary"`
	Suggestion aisessions.TitleSuggestion `json:"suggestion"`
}

// AISessionsAutoGenerateRequest asks the background worker to generate a title,
// note+tags, or both for a batch of sessions. The call returns immediately; the
// GUI follows progress through aisessions:generationstatus events.
type AISessionsAutoGenerateRequest struct {
	IDs        []string `json:"ids"`
	Connection string   `json:"connection,omitempty"`
	Kind       string   `json:"kind"` // title | metadata | both
	Force      bool     `json:"force,omitempty"`
	AIMode     string   `json:"aiMode,omitempty"`
}

// AISessionsAutoGenerateSkip describes one session that was not queued.
type AISessionsAutoGenerateSkip struct {
	ID     string `json:"id"`
	Reason string `json:"reason"` // missing | no-messages | user-title | limit
}

type AISessionsAutoGenerateResponse struct {
	Queued  []string                     `json:"queued"`
	Skipped []AISessionsAutoGenerateSkip `json:"skipped"`
	Errors  []string                     `json:"errors,omitempty"`
}

type AISessionsPromptTemplatesRequest struct{}

type AISessionsPromptTemplatesResponse struct {
	Features []aisessions.PromptFeatureMeta `json:"features"`
}

type AISessionsRestoreContextRequest struct {
	ID         string `json:"id"`
	Connection string `json:"connection,omitempty"`
}

type AISessionsRestoreContextResponse struct {
	SessionID   string `json:"sessionid"`
	Source      string `json:"source"`
	ProjectPath string `json:"projectpath,omitempty"`
	VendorID    string `json:"vendorid,omitempty"`
	VendorName  string `json:"vendorname,omitempty"`
	ConfigDir   string `json:"configdir,omitempty"`
}

type AISessionsStatRequest struct {
	ID       string `json:"id,omitempty"`
	FilePath string `json:"filePath,omitempty"`
}

type AISessionsStatResponse struct {
	ID       string `json:"id,omitempty"`
	FilePath string `json:"filePath,omitempty"`
	MTime    int64  `json:"mtime,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Missing  bool   `json:"missing,omitempty"`
}

// AISessionsSubagentFoldRequest asks for the subagent dispatches of one session
// and their (possibly ambiguous) child-session matches.
type AISessionsSubagentFoldRequest struct {
	ID         string `json:"id,omitempty"`
	Connection string `json:"connection,omitempty"`
}

type AISessionsSubagentFoldResponse struct {
	Matches []aisessions.SubagentMatch `json:"matches,omitempty"`
}

type AISessionsBackupRequest struct {
	Connection string `json:"connection,omitempty"`
	KeepRecent int    `json:"keepRecent,omitempty"`
	MaxAgeDays int    `json:"maxAgeDays,omitempty"`
}

func aiSessionsDebugEnabled() bool {
	value := strings.TrimSpace(os.Getenv("WAVETERM_AI_SESSIONS_DEBUG"))
	return value != "" && value != "0" && strings.ToLower(value) != "false"
}

func aiSessionsDebugf(format string, args ...any) {
	if !aiSessionsDebugEnabled() {
		return
	}
	log.Printf("[aisessions-debug] "+format, args...)
}

func connectionFromRemoteSessionKey(identifier string) string {
	if !strings.HasPrefix(identifier, "codex:") && !strings.HasPrefix(identifier, "claude:") {
		return ""
	}
	parts := strings.SplitN(identifier, ":", 6)
	if len(parts) != 6 || parts[2] != "remote" {
		return ""
	}
	rawConnection, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(rawConnection))
}

func (svc *AISessionsService) managerForConnection(ctx context.Context, connection string) (*aisessions.Manager, error) {
	connection = strings.TrimSpace(connection)
	if conncontroller.IsLocalConnName(connection) || conncontroller.IsWslConnName(connection) {
		return newLocalManager(), nil
	}
	remoteInfo, err := wshclient.RemoteGetInfoCommand(
		wshfs.RpcClient,
		&wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(connection)},
	)
	if err != nil {
		return nil, fmt.Errorf("cannot get remote info for %q: %w", connection, err)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	provider, err := aisessions.NewRemoteProvider(aisessions.RemoteProviderOptions{
		Connection: connection,
		HomeDir:    remoteInfo.HomeDir,
	})
	if err != nil {
		return nil, err
	}
	return aisessions.NewManagerWithOptions(aisessions.ManagerOptions{
		Providers:          []aisessions.Provider{provider},
		MetaPath:           remoteMetaPath(connection),
		SQLitePath:         remoteSQLitePath(connection),
		OnScanProgress:     makeScanProgressPublisher(connection),
		OnTitleUpdated:     makeTitleUpdatedPublisher(connection),
		OnGenerationStatus: makeGenerationStatusPublisher(connection),
	}), nil
}

// newLocalManager builds the default manager with scan-progress reporting so the
// GUI can show a skeleton + progress strip while a background scan runs.
func newLocalManager() *aisessions.Manager {
	return aisessions.NewManagerWithOptions(aisessions.ManagerOptions{
		OnScanProgress:     makeScanProgressPublisher(""),
		OnTitleUpdated:     makeTitleUpdatedPublisher(""),
		OnGenerationStatus: makeGenerationStatusPublisher(""),
	})
}

// makeTitleUpdatedPublisher forwards a finished AI title to the GUI as a wps
// event. The GUI refreshes only the affected row / tab, so there is no polling.
func makeTitleUpdatedPublisher(connection string) func(aisessions.SessionSummary) {
	return func(summary aisessions.SessionSummary) {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_AISessionsTitleUpdated,
			Data: aisessions.TitleUpdatedEvent{
				Connection: connection,
				Summary:    summary,
			},
		})
	}
}

// makeGenerationStatusPublisher forwards background worker state transitions to
// the GUI. No polling: the frontend merges these into a per-session store.
func makeGenerationStatusPublisher(connection string) func(aisessions.GenerationStatusEvent) {
	return func(event aisessions.GenerationStatusEvent) {
		if strings.TrimSpace(event.Connection) == "" {
			event.Connection = connection
		}
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_AISessionsGenerationStatus,
			Data:  event,
		})
	}
}

// scanProgressThrottle keeps wps events bounded: at most one per 200ms, unless a
// scan finishes or a large batch lands.
type scanProgressThrottle struct {
	mu          sync.Mutex
	lastSent    time.Time
	lastScanned int
	lastEvent   aisessions.ScanStatusEvent
}

var scanProgressEmitter scanProgressThrottle

func makeScanProgressPublisher(connection string) func(aisessions.ScanProgress) {
	return func(progress aisessions.ScanProgress) {
		scanProgressEmitter.publish(connection, progress)
	}
}

func (t *scanProgressThrottle) publish(connection string, progress aisessions.ScanProgress) {
	event := aisessions.ScanStatusEvent{
		Connection: connection,
		Scanned:    progress.Scanned,
		Total:      progress.Total,
		Running:    progress.Running,
		Done:       progress.Done,
		Partial:    progress.Partial,
	}
	t.mu.Lock()
	now := time.Now()
	if !event.Done {
		if now.Sub(t.lastSent) < scanProgressMinInterval &&
			event.Scanned-t.lastScanned < scanProgressMinDelta {
			t.mu.Unlock()
			return
		}
	}
	t.lastSent = now
	t.lastScanned = event.Scanned
	t.mu.Unlock()
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_AISessionsScanStatus,
		Data:  event,
	})
}

const (
	scanProgressMinInterval = 200 * time.Millisecond
	scanProgressMinDelta    = 50
)

func (svc *AISessionsService) managerForIdentifier(ctx context.Context, identifier string) (*aisessions.Manager, error) {
	if connection := connectionFromRemoteSessionKey(identifier); connection != "" {
		return svc.managerForConnection(ctx, connection)
	}
	return newLocalManager(), nil
}

func (svc *AISessionsService) managerForRequest(ctx context.Context, identifier string, connection string) (*aisessions.Manager, error) {
	if strings.TrimSpace(connection) != "" {
		return svc.managerForConnection(ctx, connection)
	}
	return svc.managerForIdentifier(ctx, identifier)
}

func remoteMetaPath(connection string) string {
	safeConnection := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(connection)
	return filepath.Join(filepath.Dir(aisessions.DefaultMetaPath()), "remote-"+safeConnection+"-meta.json")
}

func remoteSQLitePath(connection string) string {
	safeConnection := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(connection)
	return filepath.Join(filepath.Dir(aisessions.DefaultSQLiteIndexPath()), "remote-"+safeConnection+"-index-v2.sqlite")
}

func backupPathsForConnection(connection string) (string, string) {
	connection = strings.TrimSpace(connection)
	if conncontroller.IsLocalConnName(connection) || conncontroller.IsWslConnName(connection) {
		return aisessions.DefaultSQLiteIndexPath(), aisessions.DefaultMetaPath()
	}
	return remoteSQLitePath(connection), remoteMetaPath(connection)
}

func backupRetentionOptions(request *AISessionsBackupRequest) aisessions.BackupRetentionOptions {
	if request == nil {
		return aisessions.BackupRetentionOptions{}
	}
	return aisessions.BackupRetentionOptions{
		KeepRecent: request.KeepRecent,
		MaxAgeDays: request.MaxAgeDays,
	}
}

func (svc *AISessionsService) List_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list local AI sessions",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session summaries",
	}
}

func (svc *AISessionsService) List(ctx context.Context, request *AISessionsListRequest) (*AISessionsListResponse, error) {
	if request == nil {
		request = &AISessionsListRequest{}
	}
	limit := request.Limit
	if limit == 0 {
		limit = 100
	}
	manager, err := svc.managerForConnection(ctx, request.Connection)
	if err != nil {
		return nil, err
	}
	result, err := manager.ScanListResult(ctx, aisessions.ListOptions{
		Source:          request.Source,
		Project:         request.Project,
		Projects:        request.Projects,
		ExcludeProjects: request.ExcludeProjects,
		Limit:           limit,
		Marked:          request.Marked,
		Since:           request.Since,
		Before:          request.Before,
		TagFilters:      request.TagFilters,
		ExcludeTags:     request.ExcludeTags,
		TagPresence:     request.TagPresence,
		Refresh:         request.Refresh,
	}, request.Query)
	if err != nil {
		return nil, err
	}
	response := &AISessionsListResponse{
		Sessions: result.Sessions,
		Scanning: result.Scanning,
		Scanned:  result.Scanned,
		Total:    result.Total,
	}
	if request.IncludeProjectPaths {
		response.ProjectPaths = result.ProjectPaths
	}
	return response, nil
}

func (svc *AISessionsService) BackupStats_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list AI session migration backups",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session backup stats",
	}
}

func (svc *AISessionsService) BackupStats(ctx context.Context, request *AISessionsBackupRequest) (*aisessions.BackupStats, error) {
	var connection string
	if request != nil {
		connection = request.Connection
	}
	sqlitePath, metaPath := backupPathsForConnection(connection)
	stats, err := aisessions.BackupStatsForPaths(ctx, sqlitePath, metaPath, backupRetentionOptions(request))
	if err != nil {
		return nil, err
	}
	return &stats, nil
}

func (svc *AISessionsService) CleanupBackups_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "delete old AI session migration backups",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session backup cleanup result",
	}
}

func (svc *AISessionsService) CleanupBackups(ctx context.Context, request *AISessionsBackupRequest) (*aisessions.BackupCleanupResult, error) {
	var connection string
	if request != nil {
		connection = request.Connection
	}
	sqlitePath, metaPath := backupPathsForConnection(connection)
	result, err := aisessions.CleanupBackupsForPaths(ctx, sqlitePath, metaPath, backupRetentionOptions(request))
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (svc *AISessionsService) Tags_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list AI session tags",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session tags",
	}
}

func (svc *AISessionsService) Tags(ctx context.Context, request *AISessionsTagsRequest) (*AISessionsTagsResponse, error) {
	if request == nil {
		request = &AISessionsTagsRequest{}
	}
	manager, err := svc.managerForConnection(ctx, request.Connection)
	if err != nil {
		return nil, err
	}
	tags, err := manager.ListTags(ctx, aisessions.ListOptions{
		Source:          request.Source,
		Project:         request.Project,
		Projects:        request.Projects,
		ExcludeProjects: request.ExcludeProjects,
		Marked:          request.Marked,
		Since:           request.Since,
		Before:          request.Before,
		TagFilters:      request.TagFilters,
		ExcludeTags:     request.ExcludeTags,
		TagPresence:     request.TagPresence,
		Refresh:         request.Refresh,
	})
	if err != nil {
		return nil, err
	}
	return &AISessionsTagsResponse{Tags: tags}, nil
}

func (svc *AISessionsService) Detail_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load a local AI session detail",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session detail",
	}
}

func (svc *AISessionsService) Detail(ctx context.Context, request *AISessionsDetailRequest) (*aisessions.SessionDetail, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	start := time.Now()
	aiSessionsDebugf("Detail start id=%q connection=%q refresh=%v tail=%d includeTools=%v loadAll=%v", request.ID, request.Connection, request.Refresh, request.Tail, request.IncludeTools, request.LoadAll)
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		aiSessionsDebugf("Detail manager error id=%q duration=%s err=%v", request.ID, time.Since(start), err)
		return nil, err
	}
	detail, err := manager.Load(ctx, request.ID, aisessions.LoadOptions{
		Refresh:      request.Refresh,
		IncludeTools: request.IncludeTools,
		LoadAll:      request.LoadAll,
	})
	if err != nil {
		aiSessionsDebugf("Detail load error id=%q duration=%s err=%v", request.ID, time.Since(start), err)
		return nil, err
	}
	loadedCount := len(detail.Messages)
	tail := request.Tail
	if tail > 0 && len(detail.Messages) > tail {
		detail.Messages = detail.Messages[len(detail.Messages)-tail:]
	}
	aiSessionsDebugf(
		"Detail success id=%q key=%q source=%q file=%q loadedMessages=%d returnedMessages=%d summaryMessageCount=%d loadAll=%v hasMore=%v nextMessageOffset=%d duration=%s",
		request.ID,
		detail.Summary.Key,
		detail.Summary.Source,
		detail.Summary.FilePath,
		loadedCount,
		len(detail.Messages),
		detail.Summary.MessageCount,
		request.LoadAll,
		detail.HasMore,
		detail.NextMessageOffset,
		time.Since(start),
	)
	return &detail, nil
}

func (svc *AISessionsService) DetailDelta_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load newly appended AI session detail messages",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session message delta",
	}
}

func (svc *AISessionsService) DetailDelta(ctx context.Context, request *AISessionsDetailDeltaRequest) (*aisessions.MessageDelta, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	summary := aisessions.SessionSummary{
		Key:          strings.TrimSpace(request.ID),
		ID:           strings.TrimSpace(request.ID),
		Source:       strings.TrimSpace(request.Source),
		FilePath:     strings.TrimSpace(request.FilePath),
		MessageCount: request.MessageCount,
	}
	delta, err := manager.LoadDelta(ctx, request.ID, aisessions.LoadDeltaOptions{
		Summary:       summary,
		Cursor:        request.Cursor,
		BaseCount:     request.MessageCount,
		MaxBytes:      request.MaxBytes,
		LoadAll:       request.LoadAll,
		IncludeTools:  request.IncludeTools,
		MessageOffset: request.MessageOffset,
	})
	if err != nil {
		return nil, err
	}
	return &delta, nil
}

func (svc *AISessionsService) UserOutline_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load latest user messages for a local AI session outline",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session user outline",
	}
}

func (svc *AISessionsService) UserOutline(ctx context.Context, request *AISessionsUserOutlineRequest) (*AISessionsUserOutlineResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	detail, err := manager.Load(ctx, request.ID, aisessions.LoadOptions{
		Refresh: request.Refresh,
	})
	if err != nil {
		return nil, err
	}
	messages, count := latestUserOutlineMessages(detail.Messages, request.Limit)
	return &AISessionsUserOutlineResponse{
		Summary:          detail.Summary,
		Messages:         messages,
		UserMessageCount: count,
	}, nil
}

func latestUserOutlineMessages(messages []aisessions.Message, limit int) ([]aisessions.Message, int) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	var latest []aisessions.Message
	count := 0
	for _, message := range messages {
		if message.Role != aisessions.RoleUser || strings.TrimSpace(message.Text) == "" {
			continue
		}
		count++
		if len(latest) < limit {
			latest = append(latest, message)
			continue
		}
		copy(latest, latest[1:])
		latest[len(latest)-1] = message
	}
	return latest, count
}

func (svc *AISessionsService) Summary_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "load a local AI session summary without loading messages",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session summary",
	}
}

func (svc *AISessionsService) Summary(ctx context.Context, request *AISessionsSummaryRequest) (*aisessions.SessionSummary, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	summary, err := manager.Summary(ctx, request.ID, request.Refresh)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) RestoreContext_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "validate and resolve the runtime context for restoring an AI session",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "validated AI session restore context",
	}
}

func (svc *AISessionsService) RestoreContext(ctx context.Context, request *AISessionsRestoreContextRequest) (*AISessionsRestoreContextResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	summary, err := manager.Summary(ctx, request.ID, false)
	if err != nil {
		return nil, err
	}
	response := &AISessionsRestoreContextResponse{
		SessionID:   summary.ID,
		Source:      summary.Source,
		ProjectPath: summary.ProjectPath,
	}
	if summary.Source != aisessions.SourceClaude {
		return response, nil
	}
	vendorID, configDir, vendorSession := ccswitch.ResolveClaudeVendorSessionPath(summary.FilePath)
	if !vendorSession {
		if summary.VendorID != "" || summary.ConfigDir != "" {
			return nil, fmt.Errorf(VendorConfigurationUnavailableError)
		}
		return response, nil
	}
	if (summary.VendorID != "" && summary.VendorID != vendorID) ||
		(summary.ConfigDir != "" && !sameCleanPath(summary.ConfigDir, configDir)) {
		aiSessionsDebugf("RestoreContext provenance mismatch key=%q vendor=%q file=%q", summary.Key, vendorID, summary.FilePath)
		return nil, fmt.Errorf(VendorConfigurationUnavailableError)
	}
	vendors, err := ccswitch.ListClaudeVendors(ctx)
	if err != nil || vendors == nil || !vendors.Detected {
		aiSessionsDebugf("RestoreContext vendor list unavailable key=%q vendor=%q err=%v", summary.Key, vendorID, err)
		return nil, fmt.Errorf(VendorConfigurationUnavailableError)
	}
	for _, vendor := range vendors.Vendors {
		if vendor.ID != vendorID || vendor.ClaudeConfigDir == "" || !sameCleanPath(vendor.ClaudeConfigDir, configDir) {
			continue
		}
		if !regularVendorSettings(configDir) {
			break
		}
		response.VendorID = vendorID
		response.VendorName = vendor.Name
		response.ConfigDir = configDir
		aiSessionsDebugf("RestoreContext success key=%q vendor=%q configdir=%q", summary.Key, vendorID, configDir)
		return response, nil
	}
	aiSessionsDebugf("RestoreContext stale vendor key=%q vendor=%q file=%q", summary.Key, vendorID, summary.FilePath)
	return nil, fmt.Errorf(VendorConfigurationUnavailableError)
}

func sameCleanPath(left string, right string) bool {
	leftAbs, leftErr := filepath.Abs(filepath.Clean(left))
	rightAbs, rightErr := filepath.Abs(filepath.Clean(right))
	if leftErr != nil || rightErr != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(leftAbs, rightAbs)
	}
	return leftAbs == rightAbs
}

func regularVendorSettings(configDir string) bool {
	configInfo, err := os.Lstat(configDir)
	if err != nil || !configInfo.IsDir() || configInfo.Mode()&os.ModeSymlink != 0 {
		return false
	}
	settingsInfo, err := os.Lstat(filepath.Join(configDir, "settings.json"))
	return err == nil && settingsInfo.Mode().IsRegular() && settingsInfo.Mode()&os.ModeSymlink == 0
}

func isKnownAISessionFilePath(filePath string) bool {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" || !strings.EqualFold(filepath.Ext(filePath), ".jsonl") {
		return false
	}
	absPath, err := filepath.Abs(filepath.Clean(filePath))
	if err != nil {
		return false
	}
	var roots []string
	if codexRoot := aisessions.DefaultCodexSessionsDir(); codexRoot != "" {
		roots = append(roots, codexRoot)
	}
	roots = append(roots, aisessions.DefaultClaudeProjectDirs()...)
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		absRoot, err := filepath.Abs(filepath.Clean(root))
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(absRoot, absPath)
		if err != nil {
			continue
		}
		if rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (svc *AISessionsService) Stat_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "stat a local AI session file without loading messages",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session file stat",
	}
}

func (svc *AISessionsService) Stat(ctx context.Context, request *AISessionsStatRequest) (*AISessionsStatResponse, error) {
	if request == nil || (strings.TrimSpace(request.ID) == "" && strings.TrimSpace(request.FilePath) == "") {
		return nil, fmt.Errorf("session id or file path is required")
	}
	filePath := strings.TrimSpace(request.FilePath)
	if filePath == "" {
		summary, err := aisessions.NewManager("", nil).Summary(ctx, request.ID, false)
		if err != nil {
			return nil, err
		}
		filePath = summary.FilePath
	}
	if !isKnownAISessionFilePath(filePath) {
		return nil, fmt.Errorf("session file path is outside known AI session roots")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	stat, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return &AISessionsStatResponse{
				ID:       strings.TrimSpace(request.ID),
				FilePath: filePath,
				Missing:  true,
			}, nil
		}
		return nil, err
	}
	return &AISessionsStatResponse{
		ID:       strings.TrimSpace(request.ID),
		FilePath: filePath,
		MTime:    stat.ModTime().UnixMilli(),
		Size:     stat.Size(),
	}, nil
}

func (svc *AISessionsService) SubagentFold_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list subagent dispatches of a local AI session with child-session matches",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "subagent dispatch matches",
	}
}

func (svc *AISessionsService) SubagentFold(ctx context.Context, request *AISessionsSubagentFoldRequest) (*AISessionsSubagentFoldResponse, error) {
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	matches, err := manager.SubagentFold(ctx, request.ID)
	if err != nil {
		return nil, err
	}
	return &AISessionsSubagentFoldResponse{Matches: matches}, nil
}

func (svc *AISessionsService) Mark_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "mark or unmark a local AI session",
		ArgNames:   []string{"ctx", "id", "marked"},
		ReturnDesc: "updated AI session summary",
	}
}

func (svc *AISessionsService) Mark(ctx context.Context, id string, marked bool) (*aisessions.SessionSummary, error) {
	manager, err := svc.managerForIdentifier(ctx, id)
	if err != nil {
		return nil, err
	}
	summary, err := manager.Mark(ctx, id, marked)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) Note_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "set a local AI session note",
		ArgNames:   []string{"ctx", "id", "note"},
		ReturnDesc: "updated AI session summary",
	}
}

func (svc *AISessionsService) Note(ctx context.Context, id string, note string) (*aisessions.SessionSummary, error) {
	manager, err := svc.managerForIdentifier(ctx, id)
	if err != nil {
		return nil, err
	}
	summary, err := manager.Note(ctx, id, note)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) Title_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "set a local AI session title override",
		ArgNames:   []string{"ctx", "id", "title"},
		ReturnDesc: "updated AI session summary",
	}
}

func (svc *AISessionsService) Title(ctx context.Context, id string, title string) (*aisessions.SessionSummary, error) {
	manager, err := svc.managerForIdentifier(ctx, id)
	if err != nil {
		return nil, err
	}
	summary, err := manager.SetTitle(ctx, id, title)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) NoteAndTags_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "set a local AI session note and tags",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "updated AI session summary",
	}
}

func (svc *AISessionsService) NoteAndTags(ctx context.Context, request *AISessionsNoteAndTagsRequest) (*aisessions.SessionSummary, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForIdentifier(ctx, request.ID)
	if err != nil {
		return nil, err
	}
	summary, err := manager.NoteAndTags(ctx, request.ID, request.Note, request.Tags)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (svc *AISessionsService) GenerateMetadata_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "generate a proposed AI note and tags for a session without saving",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI metadata suggestion plus the current session summary",
	}
}
func (svc *AISessionsService) GenerateMetadata(ctx context.Context, request *AISessionsGenerateMetadataRequest) (*AISessionsGenerateMetadataResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	detail, err := manager.Load(ctx, request.ID, aisessions.LoadOptions{})
	if err != nil {
		return nil, err
	}
	promptConfig := promptConfigForFeature(aisessions.PromptFeatureSessionNoteTags)
	if !aisessions.PromptEnabled(promptConfig) {
		return nil, fmt.Errorf("session note & tags generation is disabled in AI Prompts settings")
	}
	genReq := aisessions.MetadataGenerateRequest{
		SessionKey:   detail.Summary.Key,
		Source:       detail.Summary.Source,
		ProjectPath:  detail.Summary.ProjectPath,
		Messages:     detail.Messages,
		ExistingNote: detail.Summary.Note,
		ExistingTags: detail.Summary.Tags,
		AIMode:       request.AIMode,
		PromptConfig: promptConfig,
	}
	suggestion, err := aisessions.GenerateSessionMetadata(ctx, genReq)
	if err != nil {
		return nil, err
	}
	return &AISessionsGenerateMetadataResponse{Summary: detail.Summary, Suggestion: suggestion}, nil
}

// promptConfigForFeature reads the user's override from aiprompts.json (via the
// full config watcher). A missing file/key yields the zero value, which the
// registry resolves to the built-in prompt and limits.
func promptConfigForFeature(feature string) wconfig.AIPromptConfigType {
	return aisessions.PromptConfigForFeature(feature)
}

func (svc *AISessionsService) GenerateTitle_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "generate a proposed AI title for a session without saving",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI title suggestion plus the current session summary",
	}
}
func (svc *AISessionsService) GenerateTitle(ctx context.Context, request *AISessionsGenerateTitleRequest) (*AISessionsGenerateTitleResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		return nil, err
	}
	detail, err := manager.Load(ctx, request.ID, aisessions.LoadOptions{})
	if err != nil {
		return nil, err
	}
	promptConfig := promptConfigForFeature(aisessions.PromptFeatureSessionTitle)
	if !aisessions.PromptEnabled(promptConfig) {
		return nil, fmt.Errorf("session title generation is disabled in AI Prompts settings")
	}
	genReq := aisessions.TitleGenerateRequest{
		SessionKey:    detail.Summary.Key,
		Source:        detail.Summary.Source,
		ProjectPath:   detail.Summary.ProjectPath,
		Messages:      detail.Messages,
		ExistingTitle: detail.Summary.Title,
		AIMode:        request.AIMode,
		PromptConfig:  promptConfig,
	}
	suggestion, err := aisessions.GenerateSessionTitle(ctx, genReq)
	if err != nil {
		return nil, err
	}
	return &AISessionsGenerateTitleResponse{Summary: detail.Summary, Suggestion: suggestion}, nil
}

// MaxAutoGenerateBatch caps how many sessions one AutoGenerate call may admit.
// The worker is serial, so an unbounded batch would block every other session's
// generation for a long time; the GUI narrows the selection instead.
const MaxAutoGenerateBatch = 50

func (svc *AISessionsService) AutoGenerate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "enqueue background AI generation (title / note+tags / both) for sessions",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "queued session keys plus per-session skip reasons",
	}
}

func (svc *AISessionsService) AutoGenerate(ctx context.Context, request *AISessionsAutoGenerateRequest) (*AISessionsAutoGenerateResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("autogenerate request is required")
	}
	kind := strings.TrimSpace(strings.ToLower(request.Kind))
	switch kind {
	case aisessions.GenKindTitle, aisessions.GenKindMetadata, aisessions.GenKindBoth:
	default:
		return nil, fmt.Errorf("invalid generation kind %q (expected title, metadata or both)", request.Kind)
	}
	if len(request.IDs) == 0 {
		return &AISessionsAutoGenerateResponse{Queued: []string{}, Skipped: []AISessionsAutoGenerateSkip{}}, nil
	}
	if len(request.IDs) > MaxAutoGenerateBatch {
		return nil, fmt.Errorf("too many sessions (%d); the limit is %d per request", len(request.IDs), MaxAutoGenerateBatch)
	}
	manager, err := svc.managerForRequest(ctx, request.IDs[0], request.Connection)
	if err != nil {
		return nil, err
	}
	response := &AISessionsAutoGenerateResponse{Queued: []string{}, Skipped: []AISessionsAutoGenerateSkip{}}
	var reqs []aisessions.ManualGenerationRequest
	seen := make(map[string]bool, len(request.IDs))
	for _, id := range request.IDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		if seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		summary, err := manager.Summary(ctx, trimmed, false)
		if err != nil {
			response.Errors = append(response.Errors, fmt.Sprintf("%s: %v", trimmed, err))
			continue
		}
		if summary.Missing {
			response.Skipped = append(response.Skipped, AISessionsAutoGenerateSkip{ID: trimmed, Reason: "missing"})
			continue
		}
		if summary.MessageCount == 0 {
			response.Skipped = append(response.Skipped, AISessionsAutoGenerateSkip{ID: trimmed, Reason: "no-messages"})
			continue
		}
		if !request.Force && kind != aisessions.GenKindMetadata && summary.TitleSource == "user" {
			response.Skipped = append(response.Skipped, AISessionsAutoGenerateSkip{ID: trimmed, Reason: "user-title"})
			continue
		}
		reqs = append(reqs, aisessions.ManualGenerationRequest{
			Key:        summary.Key,
			Kind:       kind,
			Connection: request.Connection,
			Force:      request.Force,
			AIMode:     request.AIMode,
		})
	}
	response.Queued = append(response.Queued, manager.EnqueueManualGeneration(reqs)...)
	return response, nil
}

func (svc *AISessionsService) Annotations_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list node annotations for one AI session, re-anchoring drifted nodes",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "annotation views with orphaned flags",
	}
}

func (svc *AISessionsService) Annotations(ctx context.Context, request *AISessionsAnnotationsRequest) (*AISessionsAnnotationsResponse, error) {
	if request == nil || strings.TrimSpace(request.SessionKey) == "" {
		return nil, fmt.Errorf("session key is required")
	}
	manager, err := svc.managerForRequest(ctx, request.SessionKey, request.Connection)
	if err != nil {
		return nil, err
	}
	views, err := manager.ResolveAnnotationAnchors(ctx, request.SessionKey, request.Anchors)
	if err != nil {
		return nil, err
	}
	if views == nil {
		views = []aisessions.AnnotationView{}
	}
	return &AISessionsAnnotationsResponse{Annotations: views}, nil
}

func (svc *AISessionsService) AnnotationSave_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "create or update one session annotation",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "the stored annotation",
	}
}

func (svc *AISessionsService) AnnotationSave(ctx context.Context, request *AISessionsAnnotationSaveRequest) (*aisessions.AnnotationView, error) {
	if request == nil || strings.TrimSpace(request.SessionKey) == "" || strings.TrimSpace(request.AnchorKey) == "" {
		return nil, fmt.Errorf("session key and anchor key are required")
	}
	manager, err := svc.managerForRequest(ctx, request.SessionKey, request.Connection)
	if err != nil {
		return nil, err
	}
	row, err := manager.SaveAnnotation(ctx, aisessions.AnnotationRow{
		ID:         request.ID,
		SessionKey: request.SessionKey,
		AnchorKey:  request.AnchorKey,
		Seq:        request.Seq,
		Kind:       request.Kind,
		Title:      request.Title,
		Body:       request.Body,
		Tags:       request.Tags,
		Status:     request.Status,
		Source:     request.Source,
		AIModel:    request.AIModel,
	})
	if err != nil {
		return nil, err
	}
	view := row.ToView(false)
	return &view, nil
}

func (svc *AISessionsService) AnnotationDelete_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "delete one session annotation permanently",
		ArgNames:   []string{"ctx", "id"},
		ReturnDesc: "no return value",
	}
}

func (svc *AISessionsService) AnnotationDelete(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("annotation id is required")
	}
	return newLocalManager().DeleteAnnotation(ctx, id)
}

func (svc *AISessionsService) AnnotationSessions_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list sessions that have at least one accepted annotation",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "annotated sessions plus total count",
	}
}

func (svc *AISessionsService) AnnotationSessions(ctx context.Context, request *AISessionsAnnotationSessionsRequest) (*AISessionsAnnotationSessionsResponse, error) {
	if request == nil {
		request = &AISessionsAnnotationSessionsRequest{}
	}
	manager, err := svc.managerForConnection(ctx, request.Connection)
	if err != nil {
		return nil, err
	}
	sessions, total, err := manager.ListAnnotatedSessions(ctx, aisessions.AnnotatedSessionFilter{
		Query:           request.Query,
		TagFilters:      request.TagFilters,
		ProjectPrefixes: request.ProjectPrefixes,
		Limit:           request.Limit,
		Offset:          request.Offset,
	})
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		sessions = []aisessions.AnnotatedSession{}
	}
	return &AISessionsAnnotationSessionsResponse{Sessions: sessions, Total: total}, nil
}

func (svc *AISessionsService) AnnotationAssist_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "generate AI annotation drafts for one session or one field (never saves)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "validated annotation drafts",
	}
}

func (svc *AISessionsService) AnnotationAssist(ctx context.Context, request *AISessionsAnnotationAssistRequest) (*AISessionsAnnotationAssistResponse, error) {
	if request == nil || strings.TrimSpace(request.SessionKey) == "" {
		return nil, fmt.Errorf("session key is required")
	}
	promptConfig := aisessions.PromptConfigForFeature(aisessions.PromptFeatureSessionAnnotations)
	if !aisessions.PromptEnabled(promptConfig) {
		return nil, fmt.Errorf("session annotation generation is disabled in AI Prompts settings")
	}
	manager, err := svc.managerForRequest(ctx, request.SessionKey, request.Connection)
	if err != nil {
		return nil, err
	}
	detail, err := manager.Load(ctx, request.SessionKey, aisessions.LoadOptions{IncludeTools: true})
	if err != nil {
		return nil, err
	}
	drafts, model, err := aisessions.GenerateAnnotationDrafts(ctx, aisessions.AnnotationAssistInput{
		SessionKey:   detail.Summary.Key,
		Scope:        request.Scope,
		AnchorKey:    request.AnchorKey,
		Title:        request.Title,
		Body:         request.Body,
		ExistingTags: request.Tags,
		Messages:     detail.Messages,
		ToolCalls:    detail.ToolCalls,
		MaxEntries:   request.MaxEntries,
		AIMode:       request.AIMode,
		PromptConfig: promptConfig,
	})
	if err != nil {
		return nil, err
	}
	return &AISessionsAnnotationAssistResponse{Drafts: drafts, AIModel: model}, nil
}

func (svc *AISessionsService) AnnotationReplace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "replace AI-replaceable annotations with drafted annotations (protects user data)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "the inserted draft annotations",
	}
}

func (svc *AISessionsService) AnnotationReplace(ctx context.Context, request *AISessionsAnnotationReplaceRequest) (*AISessionsAnnotationsResponse, error) {
	if request == nil || strings.TrimSpace(request.SessionKey) == "" {
		return nil, fmt.Errorf("session key is required")
	}
	manager, err := svc.managerForRequest(ctx, request.SessionKey, request.Connection)
	if err != nil {
		return nil, err
	}
	rows := make([]aisessions.AnnotationRow, 0, len(request.Annotations))
	for _, draft := range request.Annotations {
		rows = append(rows, aisessions.AnnotationRow{
			SessionKey: request.SessionKey,
			AnchorKey:  draft.AnchorKey,
			Kind:       draft.Kind,
			Title:      draft.Title,
			Body:       draft.Body,
			Tags:       draft.Tags,
			Status:     aisessions.AnnotationStatusDraft,
			Source:     aisessions.AnnotationSourceAI,
		})
	}
	inserted, err := manager.ReplaceReplaceableAnnotations(ctx, request.SessionKey, rows)
	if err != nil {
		return nil, err
	}
	views := make([]aisessions.AnnotationView, 0, len(inserted))
	for _, row := range inserted {
		views = append(views, row.ToView(false))
	}
	return &AISessionsAnnotationsResponse{Annotations: views}, nil
}

func (svc *AISessionsService) PromptTemplates_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list AI prompt features with their built-in defaults",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "prompt feature metadata for the settings page",
	}
}
func (svc *AISessionsService) PromptTemplates(ctx context.Context, request *AISessionsPromptTemplatesRequest) (*AISessionsPromptTemplatesResponse, error) {
	return &AISessionsPromptTemplatesResponse{Features: aisessions.ListPromptFeatures()}, nil
}

func (svc *AISessionsService) RenameTag_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "rename an AI session tag globally",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "AI session tag rename result",
	}
}

func (svc *AISessionsService) RenameTag(ctx context.Context, request *AISessionsRenameTagRequest) (*AISessionsRenameTagResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("rename tag request is required")
	}
	manager, err := svc.managerForConnection(ctx, request.Connection)
	if err != nil {
		return nil, err
	}
	count, err := manager.RenameTag(ctx, request.From, request.To)
	if err != nil {
		return nil, err
	}
	return &AISessionsRenameTagResponse{Count: count}, nil
}

func (svc *AISessionsService) Delete_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "delete a local AI session by moving its source file to deleted storage",
		ArgNames:   []string{"ctx", "id"},
		ReturnDesc: "deleted AI session summary",
	}
}

func (svc *AISessionsService) Delete(ctx context.Context, id string) (*aisessions.SessionSummary, error) {
	summary, err := aisessions.NewManager("", nil).Delete(ctx, id)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}
