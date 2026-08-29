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
	"time"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const VendorConfigurationUnavailableError = "Vendor configuration is no longer available"

type AISessionsService struct{}

type AISessionsListRequest struct {
	Source             string   `json:"source,omitempty"`
	Project            string   `json:"project,omitempty"`
	Query              string   `json:"query,omitempty"`
	Connection         string   `json:"connection,omitempty"`
	Limit              int      `json:"limit,omitempty"`
	Refresh            bool     `json:"refresh,omitempty"`
	Marked             string   `json:"marked,omitempty"`
	Since              int64    `json:"since,omitempty"`
	Before              int64    `json:"before,omitempty"`
	TagFilters          []string `json:"tagFilters,omitempty"`
	TagPresence         string   `json:"tagPresence,omitempty"`
	IncludeProjectPaths bool     `json:"includeProjectPaths,omitempty"`
}

type AISessionsListResponse struct {
	Sessions     []aisessions.SessionSummary     `json:"sessions"`
	ProjectPaths []aisessions.ProjectPathSummary `json:"projectPaths,omitempty"`
}

type AISessionsTagsRequest struct {
	Source      string `json:"source,omitempty"`
	Project     string `json:"project,omitempty"`
	Connection  string `json:"connection,omitempty"`
	Marked      string `json:"marked,omitempty"`
	Since       int64  `json:"since,omitempty"`
	Before      int64  `json:"before,omitempty"`
	TagFilters  []string `json:"tagFilters,omitempty"`
	TagPresence string `json:"tagPresence,omitempty"`
	Refresh     bool   `json:"refresh,omitempty"`
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
}

type AISessionsDetailDeltaRequest struct {
	ID           string                          `json:"id"`
	Connection   string                          `json:"connection,omitempty"`
	Source       string                          `json:"source,omitempty"`
	FilePath     string                          `json:"filePath,omitempty"`
	Cursor       aisessions.SessionMessageCursor `json:"cursor"`
	MaxBytes     int64                           `json:"maxBytes,omitempty"`
	MessageCount int                             `json:"messageCount,omitempty"`
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
		return aisessions.NewManager("", nil), nil
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
		Providers:  []aisessions.Provider{provider},
		MetaPath:   remoteMetaPath(connection),
		SQLitePath: remoteSQLitePath(connection),
	}), nil
}

func (svc *AISessionsService) managerForIdentifier(ctx context.Context, identifier string) (*aisessions.Manager, error) {
	if connection := connectionFromRemoteSessionKey(identifier); connection != "" {
		return svc.managerForConnection(ctx, connection)
	}
	return aisessions.NewManager("", nil), nil
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
	sessions, projectPaths, err := manager.ScanListWithDistribution(ctx, aisessions.ListOptions{
		Source:      request.Source,
		Project:     request.Project,
		Limit:       limit,
		Marked:      request.Marked,
		Since:       request.Since,
		Before:      request.Before,
		TagFilters:  request.TagFilters,
		TagPresence: request.TagPresence,
		Refresh:     request.Refresh,
	}, request.Query)
	if err != nil {
		return nil, err
	}
	response := &AISessionsListResponse{Sessions: sessions}
	if request.IncludeProjectPaths {
		response.ProjectPaths = projectPaths
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
		Source:      request.Source,
		Project:     request.Project,
		Marked:      request.Marked,
		Since:       request.Since,
		Before:      request.Before,
		TagFilters:  request.TagFilters,
		TagPresence: request.TagPresence,
		Refresh:     request.Refresh,
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
	aiSessionsDebugf("Detail start id=%q connection=%q refresh=%v tail=%d includeTools=%v", request.ID, request.Connection, request.Refresh, request.Tail, request.IncludeTools)
	manager, err := svc.managerForRequest(ctx, request.ID, request.Connection)
	if err != nil {
		aiSessionsDebugf("Detail manager error id=%q duration=%s err=%v", request.ID, time.Since(start), err)
		return nil, err
	}
	detail, err := manager.Load(ctx, request.ID, aisessions.LoadOptions{
		Refresh:      request.Refresh,
		IncludeTools: request.IncludeTools,
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
		"Detail success id=%q key=%q source=%q file=%q loadedMessages=%d returnedMessages=%d summaryMessageCount=%d duration=%s",
		request.ID,
		detail.Summary.Key,
		detail.Summary.Source,
		detail.Summary.FilePath,
		loadedCount,
		len(detail.Messages),
		detail.Summary.MessageCount,
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
		Summary:   summary,
		Cursor:    request.Cursor,
		BaseCount: request.MessageCount,
		MaxBytes:  request.MaxBytes,
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
