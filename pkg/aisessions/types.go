// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	SourceCodex  = "codex"
	SourceClaude = "claude"
)

const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
	RoleSystem    = "system"
	RoleUnknown   = "unknown"
)

type SessionSummary struct {
	Key         string `json:"key"`
	ID          string `json:"id"`
	Source      string `json:"source"`
	// Origin tags which scan root surfaced this row in a merged ("All machines")
	// view. Empty for rows loaded from a single origin, so the frontend can fall
	// back to its selected origin for routing detail/stat calls.
	Origin      string `json:"origin,omitempty"`
	Title       string `json:"title,omitempty"`
	TitleSource string `json:"titleSource,omitempty"`
	// 后台 AI 标题自动生成的幂等标记（不暴露给前端）。
	// AITitleAttemptedAt > 0 表示已经尝试过（无论成功失败），不再自动重试。
	AITitleAttemptedAt         int64    `json:"-"`
	AITitleAttemptMessageCount int      `json:"-"`
	ProjectPath                string   `json:"projectPath,omitempty"`
	CreatedAt                  int64    `json:"createdAt,omitempty"`
	UpdatedAt                  int64    `json:"updatedAt,omitempty"`
	MessageCount               int      `json:"messageCount,omitempty"`
	FilePath                   string   `json:"filePath,omitempty"`
	VendorID                   string   `json:"vendorid,omitempty"`
	ConfigDir                  string   `json:"configdir,omitempty"`
	Snippet                    string   `json:"snippet,omitempty"`
	Marked                     bool     `json:"marked,omitempty"`
	Note                       string   `json:"note,omitempty"`
	Tags                       []string `json:"tags,omitempty"`
	Missing                    bool     `json:"missing,omitempty"`
	Live                       bool     `json:"live,omitempty"`
	// ParentKey is the session key of the conversation that spawned this one (pi
	// subagent runs and forks). Empty means the row is a top-level session.
	ParentKey string `json:"parentKey,omitempty"`
	// Kind is SessionKindSession / SessionKindSubagent / SessionKindFork. Empty
	// is treated as a top-level session (rows indexed by older binaries).
	Kind string `json:"kind,omitempty"`
	// Attached is empty when the row itself matched the list filter. "parent"
	// means it was pulled in because a matching child needs its parent to hang
	// under; "child" means it was pulled in because a matching parent needs its
	// subagent runs shown. Request-scoped derived field: never persisted.
	Attached string `json:"attached,omitempty"`
	MTime int64  `json:"-"`
	Size  int64  `json:"size,omitempty"`
}

type Message struct {
	Seq int `json:"seq"`
	// EntryID is the provider entry id this message came from (pi JSONL entry id).
	// Stable across re-reads of the same file, so it survives a detail refresh.
	EntryID string `json:"entryId,omitempty"`
	// ItemKey identifies one display message of one entry ("<entryId>:m0" for the
	// entry's own text, "<entryId>:t0" for its first tool anchor). One pi entry can
	// split into several messages, so positional Seq is not a safe identity:
	// deltas and UI anchors must use ItemKey.
	ItemKey   string `json:"itemKey,omitempty"`
	Role      string `json:"role"`
	Text      string `json:"text"`
	Model     string `json:"model,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	ToolName  string `json:"toolName,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	CharCount int    `json:"charCount"`
}

type ToolCall struct {
	Seq int `json:"seq"`
	// EntryID / ItemKey mirror the anchoring Message: the tool call that pairs with
	// message ItemKey "<entryId>:t0" carries ItemKey "<entryId>:t0" itself.
	EntryID  string `json:"entryId,omitempty"`
	ItemKey  string `json:"itemKey,omitempty"`
	Name     string `json:"name"`
	Summary  string `json:"summary,omitempty"`
	Output   string `json:"output,omitempty"`
	ExitCode int    `json:"exitCode,omitempty"`
}

type SessionDetail struct {
	Summary   SessionSummary       `json:"summary"`
	Messages  []Message            `json:"messages"`
	ToolCalls []ToolCall           `json:"toolCalls,omitempty"`
	Cursor    SessionMessageCursor `json:"cursor,omitempty"`
	// HasMore is set by a LoadAll detail frame when the session has messages past
	// NextMessageOffset; callers continue with DetailDelta + MessageOffset until it
	// is false. Left unset (false) by the legacy Detail path.
	HasMore bool `json:"hasMore,omitempty"`
	// NextMessageOffset is the message index to resume a LoadAll stream from.
	NextMessageOffset int `json:"nextMessageOffset,omitempty"`
}

type SessionTagSummary struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// ScanListResult is one page of sessions plus the state of the background
// summary scan that fills the index. Scanning=true means the list may still
// gain rows; Scanned/Total drive the progress indicator.
type ScanListResult struct {
	Sessions     []SessionSummary
	ProjectPaths []ProjectPathSummary
	Scanning     bool
	Scanned      int
	Total        int
	// AttachTruncated reports that hierarchy context rows were capped, so the
	// UI can say "some sub-sessions were not shown".
	AttachTruncated bool
}

// ScanStatusEvent is published as a wps event so the GUI can move its progress
// indicator and refetch the list when a background scan finishes.
type ScanStatusEvent struct {
	Connection string `json:"connection,omitempty"`
	Scanned    int    `json:"scanned"`
	Total      int    `json:"total"`
	Running    bool   `json:"running"`
	Done       bool   `json:"done"`
	Partial    bool   `json:"partial,omitempty"`
}

// TitleUpdatedEvent is published as a wps event when the background auto-title
// worker finishes writing an AI title for a session. The GUI uses it to refresh
// the affected row / tab title without polling. Metadata generations reuse the
// same event: the summary carries note/tags, which the GUI merges when defined.
type TitleUpdatedEvent struct {
	Connection string         `json:"connection,omitempty"`
	Summary    SessionSummary `json:"summary"`
}

// GenerationStatusEvent is published as a wps event on every background
// generation state transition (queued / running / done / failed). Manual jobs
// report attempt/maxAttempts so the GUI can show retry progress; automatic jobs
// always report maxAttempts=1.
type GenerationStatusEvent struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"` // title | metadata | both
	Connection  string `json:"connection,omitempty"`
	State       string `json:"state"` // queued | running | done | failed
	Attempt     int    `json:"attempt"`
	MaxAttempts int    `json:"maxAttempts"`
	Error       string `json:"error,omitempty"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type SessionFile struct {
	Source      string
	Path        string
	MTime       int64
	Size        int64
	ContentHash string
	// ParentPath is the session file this one belongs to (pi subagent/fork
	// layout). Empty means a top-level session file.
	ParentPath string
	// Kind mirrors SessionKind*; empty is treated as SessionKindSession.
	Kind string
}

type Provider interface {
	Source() string
	List(ctx context.Context) ([]SessionSummary, error)
	LoadMessages(ctx context.Context, filePath string) ([]Message, error)
}

type SummaryFileProvider interface {
	ListFiles(ctx context.Context) ([]SessionFile, error)
	ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool)
}

type ToolCallProvider interface {
	LoadToolCalls(ctx context.Context, filePath string) ([]ToolCall, error)
}

type MessageDeltaProvider interface {
	LoadMessageDelta(ctx context.Context, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error)
}

type LoadOptions struct {
	Refresh      bool
	IncludeTools bool
	// LoadAll streams the whole session in frames: the first frame carries the
	// EARLIEST messages plus HasMore/NextMessageOffset, and the caller keeps
	// appending via LoadDeltaOptions.MessageOffset until HasMore is false.
	LoadAll bool
}

type LoadDeltaOptions struct {
	Summary   SessionSummary
	Cursor    SessionMessageCursor
	BaseCount int
	MaxBytes  int64
	// LoadAll switches DetailDelta from byte-cursor mode to LoadAll continuation
	// mode: the canonical message list is sliced from MessageOffset (inclusive)
	// instead of reading the file at Cursor.ByteOffset. Legacy callers leave it
	// false and keep the byte-cursor behavior untouched.
	LoadAll       bool
	MessageOffset int
	IncludeTools  bool
}

type SessionMessageCursor struct {
	ByteOffset int64 `json:"byteOffset,omitempty"`
	FileSize   int64 `json:"fileSize,omitempty"`
	MTime      int64 `json:"mtime,omitempty"`
	LastSeq    int   `json:"lastSeq,omitempty"`
}

type MessageDelta struct {
	Summary       SessionSummary       `json:"summary"`
	Messages      []Message            `json:"messages"`
	ToolCalls     []ToolCall           `json:"toolCalls,omitempty"`
	Cursor        SessionMessageCursor `json:"cursor"`
	HasMore       bool                 `json:"hasMore,omitempty"`
	ResetRequired bool                 `json:"resetRequired,omitempty"`
	// NextMessageOffset is the resume index for a LoadAll stream (see SessionDetail).
	NextMessageOffset int `json:"nextMessageOffset,omitempty"`
}

type ListOptions struct {
	Source string
	// Project is the legacy single-prefix include filter. Projects supersedes it
	// when non-empty (see effectiveProjects).
	Project string
	// Projects is the include-side multi-select path filter: a union of
	// component-boundary prefixes. Empty means "no include constraint". The
	// Other bucket is expressed with the ProjectFilterOther sentinel.
	Projects        []string
	ExcludeProjects []string
	Since           int64
	Before          int64
	Limit           int
	Marked          string
	TagFilters      []string
	ExcludeTags     []string
	TagPresence     string
	Refresh         bool
	// AttachMode controls hierarchy context rows added after Limit is applied:
	// "" / "off" (default), "parent", "children", or "both".
	AttachMode string
	// AttachMaxRows caps how many context rows are added (0 = default 500).
	AttachMaxRows int
	// SortField selects the primary key used BEFORE Limit is applied. "" / "time"
	// (default) = updatedAt desc; "created" = createdAt with SortDesc deciding the
	// direction. Message/subagent counts are frontend-only sort keys: the backend
	// has no cheap source for them, so those fall back to the default ordering.
	SortField string
	// SortDesc is the direction for SortField (false = ascending).
	SortDesc bool
}

type SearchOptions struct {
	Query           string
	Source          string
	Project         string
	Projects        []string
	ExcludeProjects []string
	Limit           int
	TagFilters      []string
	ExcludeTags     []string
	TagPresence     string
	Refresh         bool
	AttachMode      string
	AttachMaxRows   int
	SortField       string
	SortDesc        bool
}

func StableKey(source string, id string, filePath string) string {
	return source + ":" + id + ":" + filePath
}

func (s SessionSummary) DisplayTitle() string {
	if strings.TrimSpace(s.Title) != "" {
		return s.Title
	}
	if strings.TrimSpace(s.ProjectPath) != "" {
		return filepath.Base(strings.TrimRight(s.ProjectPath, `/\`))
	}
	if len(s.ID) > 8 {
		return s.ID[:8]
	}
	return s.ID
}

func (s SessionSummary) Validate() error {
	if s.Source == "" {
		return fmt.Errorf("session source is required")
	}
	if s.ID == "" {
		return fmt.Errorf("session id is required")
	}
	if s.FilePath == "" {
		return fmt.Errorf("session file path is required")
	}
	return nil
}

// ── Session annotations (schema v4) ──
//
// Annotations are node-level notes anchored to a Message.ItemKey. They live only
// in Snorkeling's SQLite index; provider session files are never modified.

// Annotation kind values.
const (
	AnnotationKindNote      = "note"
	AnnotationKindMilestone = "milestone"
	AnnotationKindDecision  = "decision"
	AnnotationKindQuestion  = "question"
)

// Annotation status values.
const (
	AnnotationStatusDraft    = "draft"
	AnnotationStatusAccepted = "accepted"
)

// Annotation source values.
const (
	AnnotationSourceUser = "user"
	AnnotationSourceAI   = "ai"
)

// AnnotationView is the front-end shape of one annotation.
type AnnotationView struct {
	ID            int64    `json:"id"`
	SessionKey    string   `json:"sessionKey"`
	AnchorKey     string   `json:"anchorKey"`
	Seq           int      `json:"seq"`
	Kind          string   `json:"kind"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	Tags          []string `json:"tags"`
	Status        string   `json:"status"`
	Source        string   `json:"source"`
	UserEdited    bool     `json:"userEdited"`
	AIModel       string   `json:"aiModel,omitempty"`
	AnchorPreview string   `json:"anchorPreview,omitempty"`
	// NodeText 是用户手改的「节点原文」副本；空串表示没覆盖，前端回落到活节点文本。
	NodeText  string `json:"nodeText,omitempty"`
	Orphaned  bool   `json:"orphaned,omitempty"`
	CreatedAt     int64    `json:"createdAt"`
	UpdatedAt     int64    `json:"updatedAt"`
}

// AnnotatedSession is one row of the cross-session annotation list.
type AnnotatedSession struct {
	Key              string `json:"key"`
	Title            string `json:"title"`
	Source           string `json:"source"`
	ProjectPath      string `json:"projectPath"`
	UpdatedAt        int64  `json:"updatedAt"`
	AnnotationCount  int    `json:"annotationCount"`
	LastAnnotationAt int64  `json:"lastAnnotationAt"`
}

// AnnotationAnchor identifies one message/tool node a session exposes to the
// annotation layer. Hash is the FNV-1a of the node text and is used to detect
// drift when ItemKey no longer matches.
type AnnotationAnchor struct {
	AnchorKey string `json:"anchorKey"`
	Seq       int    `json:"seq"`
	Role      string `json:"role"`
	Hash      string `json:"hash"`
}
