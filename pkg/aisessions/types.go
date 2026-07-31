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
	MTime        int64    `json:"-"`
	Size         int64    `json:"size,omitempty"`
}

type Message struct {
	Seq       int    `json:"seq"`
	Role      string `json:"role"`
	Text      string `json:"text"`
	Model     string `json:"model,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	ToolName  string `json:"toolName,omitempty"`
	CharCount int    `json:"charCount"`
}

type ToolCall struct {
	Seq      int    `json:"seq"`
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
}

type SessionTagSummary struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

type SessionFile struct {
	Source string
	Path   string
	MTime  int64
	Size   int64
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
}

type LoadDeltaOptions struct {
	Summary   SessionSummary
	Cursor    SessionMessageCursor
	BaseCount int
	MaxBytes  int64
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
	Cursor        SessionMessageCursor `json:"cursor"`
	HasMore       bool                 `json:"hasMore,omitempty"`
	ResetRequired bool                 `json:"resetRequired,omitempty"`
}

type UserLinesOptions struct {
	BeforeSeq int
	Limit     int
	Query     string
	Refresh   bool
}

type UserLinesResult struct {
	Summary          SessionSummary `json:"summary"`
	Messages         []Message      `json:"messages"`
	UserMessageCount int            `json:"userMessageCount"`
	HasMore          bool           `json:"hasMore"`
	NextBeforeSeq    int            `json:"nextBeforeSeq,omitempty"`
}

type ListOptions struct {
	Source       string
	Project      string
	Since        int64
	Before       int64
	Limit        int
	Marked       string
	TagFilters   []string
	TagPresence  string
	Refresh      bool
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
