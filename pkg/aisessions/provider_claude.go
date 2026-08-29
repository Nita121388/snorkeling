// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/ccswitch"
)

type ClaudeProvider struct {
	roots []string
}

func NewClaudeProvider(roots []string) *ClaudeProvider {
	return &ClaudeProvider{roots: roots}
}

func (p *ClaudeProvider) Source() string {
	return SourceClaude
}

func (p *ClaudeProvider) List(ctx context.Context) ([]SessionSummary, error) {
	files, err := p.ListFiles(ctx)
	if err != nil {
		return nil, err
	}
	var summaries []SessionSummary
	for _, file := range files {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		summary, ok := p.parseSummaryFile(file)
		if ok {
			summaries = append(summaries, summary)
		}
	}
	return summaries, nil
}

func (p *ClaudeProvider) ListFiles(ctx context.Context) ([]SessionFile, error) {
	var paths []string
	for _, root := range p.roots {
		files, err := collectJSONLFiles(root)
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			if isClaudeAgentSession(file) {
				continue
			}
			paths = append(paths, file)
		}
	}
	return sessionFilesFromPaths(ctx, p.Source(), paths)
}

func (p *ClaudeProvider) ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool) {
	if ctx.Err() != nil {
		return SessionSummary{}, false
	}
	return p.parseSummaryFile(file)
}

func (p *ClaudeProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	return parseClaudeMessages(ctx, file)
}

func parseClaudeMessages(ctx context.Context, r io.Reader) ([]Message, error) {
	messages, _, _, err := parseJSONLFromReader(ctx, r, 1, parseClaudeMessageLine)
	return messages, err
}

func parseClaudeMessageLine(line []byte, seq int) ([]Message, bool) {
	msg, ok := parseClaudeMessageLineSingle(line, seq)
	if !ok {
		return nil, false
	}
	return []Message{msg}, true
}

func parseClaudeMessageLineSingle(line []byte, seq int) (Message, bool) {
	var value map[string]any
	if err := json.Unmarshal(line, &value); err != nil {
		return Message{}, false
	}
	if boolValue(value, "isMeta") {
		return Message{}, false
	}
	message, _ := value["message"].(map[string]any)
	if message == nil {
		return Message{}, false
	}
	role := normalizeRole(strValue(message, "role"))
	if role == RoleUser && claudeContentAllToolResults(message["content"]) {
		role = RoleTool
	}
	text := extractText(message["content"])
	if strings.TrimSpace(text) == "" {
		return Message{}, false
	}
	return Message{
		Seq:       seq,
		Role:      role,
		Text:      text,
		Model:     strValue(message, "model"),
		Timestamp: parseTimestampToMS(value["timestamp"]),
		CharCount: runeCount(text),
	}, true
}

func (p *ClaudeProvider) LoadMessageDelta(ctx context.Context, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error) {
	return loadLocalMessageDelta(ctx, p.Source(), filePath, cursor, maxBytes, parseClaudeMessageLine)
}

func (p *ClaudeProvider) LoadToolCalls(ctx context.Context, filePath string) ([]ToolCall, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	var toolCalls []ToolCall
	pendingByID := make(map[string]int)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return toolCalls, ctx.Err()
		}
		var value map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			continue
		}
		if boolValue(value, "isMeta") {
			continue
		}
		message, _ := value["message"].(map[string]any)
		if message == nil {
			continue
		}
		contentItems, ok := message["content"].([]any)
		if !ok {
			continue
		}
		for _, item := range contentItems {
			itemMap, _ := item.(map[string]any)
			if itemMap == nil {
				continue
			}
			switch strValue(itemMap, "type") {
			case "tool_use":
				name := strValue(itemMap, "name")
				if name == "" {
					name = "unknown"
				}
				toolCall := ToolCall{
					Seq:     len(toolCalls) + 1,
					Name:    name,
					Summary: summarizeToolInput(itemMap["input"]),
				}
				toolCalls = append(toolCalls, toolCall)
				if id := strValue(itemMap, "id"); id != "" {
					pendingByID[id] = len(toolCalls) - 1
				}
			case "tool_result":
				toolUseID := strValue(itemMap, "tool_use_id")
				idx, ok := pendingByID[toolUseID]
				if !ok || idx < 0 || idx >= len(toolCalls) {
					continue
				}
				toolCalls[idx].Output = extractText(itemMap["content"])
				if boolValue(itemMap, "is_error") {
					toolCalls[idx].ExitCode = 1
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return toolCalls, err
	}
	return toolCalls, nil
}

func (p *ClaudeProvider) parseSummary(path string) (SessionSummary, bool) {
	mtime, size := fileStatFields(path)
	return p.parseSummaryFile(SessionFile{Source: p.Source(), Path: path, MTime: mtime, Size: size})
}

func (p *ClaudeProvider) parseSummaryFile(file SessionFile) (SessionSummary, bool) {
	head, tail, err := readHeadTailLines(file.Path, 10, 30)
	if err != nil {
		return SessionSummary{}, false
	}
	return p.parseSummaryFromLines(file.Path, head, tail, file.MTime, file.Size)
}

func (p *ClaudeProvider) parseSummaryFromLines(
	path string,
	head []string,
	tail []string,
	mtime int64,
	size int64,
) (SessionSummary, bool) {
	var id string
	var projectPath string
	var createdAt int64
	var firstUserMessage string

	for _, line := range head {
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			continue
		}
		if id == "" {
			id = strValue(value, "sessionId")
		}
		if projectPath == "" {
			projectPath = strValue(value, "cwd")
		}
		if createdAt == 0 {
			createdAt = parseTimestampToMS(value["timestamp"])
		}
		if firstUserMessage == "" && isClaudeUserRecord(value) {
			message, _ := value["message"].(map[string]any)
			if message != nil {
				text := extractText(message["content"])
				if effective, ok := effectiveUserText(text); ok {
					firstUserMessage = effective
				}
			}
		}
		if id != "" && projectPath != "" && createdAt != 0 && firstUserMessage != "" {
			break
		}
	}

	var updatedAt int64
	var snippet string
	var customTitle string
	for i := len(tail) - 1; i >= 0; i-- {
		var value map[string]any
		if err := json.Unmarshal([]byte(tail[i]), &value); err != nil {
			continue
		}
		if updatedAt == 0 {
			updatedAt = parseTimestampToMS(value["timestamp"])
		}
		if customTitle == "" && strValue(value, "type") == "custom-title" {
			customTitle = strings.TrimSpace(strValue(value, "customTitle"))
		}
		if snippet == "" && !boolValue(value, "isMeta") {
			message, _ := value["message"].(map[string]any)
			if message != nil {
				text := extractText(message["content"])
				if strings.TrimSpace(text) != "" {
					snippet = truncateSummary(text, snippetMaxChars)
				}
			}
		}
		if updatedAt != 0 && snippet != "" && customTitle != "" {
			break
		}
	}

	if id == "" {
		id = inferClaudeID(path)
	}
	if id == "" {
		return SessionSummary{}, false
	}

	title := normalizeTitle(firstUserMessage)
	titleSource := "first_user_message"
	if title == "" {
		title = normalizeTitle(customTitle)
		titleSource = "source_title"
	}
	if title == "" {
		title = pathBase(projectPath)
		titleSource = "project"
	}

	summary := SessionSummary{
		ID:          id,
		Source:      SourceClaude,
		Title:       title,
		TitleSource: titleSource,
		ProjectPath: projectPath,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
		FilePath:    path,
		Snippet:     snippet,
		MTime:       mtime,
		Size:        size,
	}
	if vendorID, configDir, ok := ccswitch.ResolveClaudeVendorSessionPath(path); ok {
		summary.VendorID = vendorID
		summary.ConfigDir = configDir
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary, summary.Validate() == nil
}

func boolValue(value map[string]any, key string) bool {
	b, _ := value[key].(bool)
	return b
}

func isClaudeUserRecord(value map[string]any) bool {
	if strValue(value, "type") == "user" {
		return true
	}
	message, _ := value["message"].(map[string]any)
	return message != nil && strValue(message, "role") == "user"
}

func claudeContentAllToolResults(content any) bool {
	items, ok := content.([]any)
	if !ok || len(items) == 0 {
		return false
	}
	for _, item := range items {
		itemMap, _ := item.(map[string]any)
		if itemMap == nil || strValue(itemMap, "type") != "tool_result" {
			return false
		}
	}
	return true
}

func isClaudeAgentSession(path string) bool {
	return strings.HasPrefix(filepath.Base(path), "agent-")
}

func inferClaudeID(path string) string {
	fileName := filepath.Base(path)
	return strings.TrimSuffix(fileName, filepath.Ext(fileName))
}
