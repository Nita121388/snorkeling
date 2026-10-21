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
	Key          string   `json:"key"`
	ID           string   `json:"id"`
	Source       string   `json:"source"`
	Title        string   `json:"title,omitempty"`
	TitleSource  string   `json:"titleSource,omitempty"`
	ProjectPath  string   `json:"projectPath,omitempty"`
	CreatedAt    int64    `json:"createdAt,omitempty"`
	UpdatedAt    int64    `json:"updatedAt,omitempty"`
	MessageCount int      `json:"messageCount,omitempty"`
	FilePath     string   `json:"filePath,omitempty"`
	VendorID     string   `json:"vendorid,omitempty"`
	ConfigDir    string   `json:"configdir,omitempty"`
	Snippet      string   `json:"snippet,omitempty"`
	Marked       bool     `json:"marked,omitempty"`
	Note         string   `json:"note,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	Missing      bool     `json:"missing,omitempty"`
	Live         bool     `json:"live,omitempty"`
	// ParentKey is the session key of the conversation that spawned this one (pi
	// subagent runs and forks). Empty means the row is a top-level session.
	ParentKey string `json:"parentKey,omitempty"`
	// Kind is SessionKindSession / SessionKindSubagent / SessionKindFork. Empty
	// is treated as a top-level session (rows indexed by older binaries).
	Kind  string `json:"kind,omitempty"`
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
	Source      string
	Project     string
	Since       int64
	Before      int64
	Limit       int
	Marked      string
	TagFilters  []string
	TagPresence string
	Refresh     bool
}

type SearchOptions struct {
	Query       string
	Source      string
	Project     string
	Limit       int
	TagFilters  []string
	TagPresence string
	Refresh     bool
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
