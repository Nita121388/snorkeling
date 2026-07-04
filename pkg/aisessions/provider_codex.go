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
)

type CodexProvider struct {
	root string
}

func NewCodexProvider(root string) *CodexProvider {
	return &CodexProvider{root: root}
}

func (p *CodexProvider) Source() string {
	return SourceCodex
}

func (p *CodexProvider) List(ctx context.Context) ([]SessionSummary, error) {
	files, err := p.ListFiles(ctx)
	if err != nil {
		return nil, err
	}
	titleIndex := loadCodexSessionIndex(filepath.Dir(p.root))
	var summaries []SessionSummary
	for _, file := range files {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		summary, ok := p.parseSummaryFile(file)
		if ok {
			p.applyIndexedTitle(&summary, titleIndex)
			summaries = append(summaries, summary)
		}
	}
	return summaries, nil
}

func (p *CodexProvider) ListFiles(ctx context.Context) ([]SessionFile, error) {
	files, err := collectJSONLFiles(p.root)
	if err != nil {
		return nil, err
	}
	return sessionFilesFromPaths(ctx, p.Source(), files)
}

func (p *CodexProvider) ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool) {
	if ctx.Err() != nil {
		return SessionSummary{}, false
	}
	summary, ok := p.parseSummaryFile(file)
	if ok {
		p.applyIndexedTitle(&summary, loadCodexSessionIndex(filepath.Dir(p.root)))
	}
	return summary, ok
}

func (p *CodexProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	return parseCodexMessages(ctx, file)
}

func parseCodexMessages(ctx context.Context, r io.Reader) ([]Message, error) {
	messages, _, _, err := parseJSONLFromReader(ctx, r, 1, parseCodexMessageLine)
	return messages, err
}

func parseCodexMessageLine(line []byte, seq int) (Message, bool) {
	var value map[string]any
	if err := json.Unmarshal(line, &value); err != nil {
		return Message{}, false
	}
	if strValue(value, "type") != "response_item" {
		return Message{}, false
	}
	payload, _ := value["payload"].(map[string]any)
	if payload == nil {
		return Message{}, false
	}
	payloadType := strValue(payload, "type")
	role := ""
	text := ""
	toolName := ""
	switch payloadType {
	case "message":
		role = normalizeRole(strValue(payload, "role"))
		text = extractText(payload["content"])
	case "function_call":
		role = RoleAssistant
		toolName = strValue(payload, "name")
		if toolName == "" {
			toolName = "unknown"
		}
		text = "[Tool: " + toolName + "]"
	case "function_call_output":
		role = RoleTool
		text = strValue(payload, "output")
	default:
		return Message{}, false
	}
	if strings.TrimSpace(text) == "" {
		return Message{}, false
	}
	return Message{
		Seq:       seq,
		Role:      role,
		Text:      text,
		Timestamp: parseTimestampToMS(value["timestamp"]),
		ToolName:  toolName,
		CharCount: runeCount(text),
	}, true
}

func (p *CodexProvider) LoadMessageDelta(ctx context.Context, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error) {
	return loadLocalMessageDelta(ctx, p.Source(), filePath, cursor, maxBytes, parseCodexMessageLine)
}

func (p *CodexProvider) LoadToolCalls(ctx context.Context, filePath string) ([]ToolCall, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	var toolCalls []ToolCall
	pendingByCallID := make(map[string]int)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return toolCalls, ctx.Err()
		}
		var value map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			continue
		}
		if strValue(value, "type") != "response_item" {
			continue
		}
		payload, _ := value["payload"].(map[string]any)
		if payload == nil {
			continue
		}
		switch strValue(payload, "type") {
		case "function_call":
			name := strValue(payload, "name")
			if name == "" {
				name = "unknown"
			}
			callID := strValue(payload, "call_id")
			toolCall := ToolCall{
				Seq:     len(toolCalls) + 1,
				Name:    name,
				Summary: summarizeToolInput(payload["arguments"]),
			}
			toolCalls = append(toolCalls, toolCall)
			if callID != "" {
				pendingByCallID[callID] = len(toolCalls) - 1
			}
		case "function_call_output":
			callID := strValue(payload, "call_id")
			idx, ok := pendingByCallID[callID]
			if !ok || idx < 0 || idx >= len(toolCalls) {
				continue
			}
			toolCalls[idx].Output = strValue(payload, "output")
		}
	}
	if err := scanner.Err(); err != nil {
		return toolCalls, err
	}
	return toolCalls, nil
}

func (p *CodexProvider) parseSummary(path string) (SessionSummary, bool) {
	mtime, size := fileStatFields(path)
	return p.parseSummaryFile(SessionFile{Source: p.Source(), Path: path, MTime: mtime, Size: size})
}

func (p *CodexProvider) parseSummaryFile(file SessionFile) (SessionSummary, bool) {
	head, tail, err := readHeadTailLines(file.Path, 10, 30)
	if err != nil {
		return SessionSummary{}, false
	}
	return p.parseSummaryFromLines(file.Path, head, tail, file.MTime, file.Size)
}

func (p *CodexProvider) parseSummaryFromLines(
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
		if createdAt == 0 {
			createdAt = parseTimestampToMS(value["timestamp"])
		}
		if strValue(value, "type") == "session_meta" {
			payload, _ := value["payload"].(map[string]any)
			if payload != nil {
				if id == "" {
					id = strValue(payload, "id")
				}
				if projectPath == "" {
					projectPath = strValue(payload, "cwd")
				}
				if createdAt == 0 {
					createdAt = parseTimestampToMS(payload["timestamp"])
				}
			}
		}
		if firstUserMessage == "" && strValue(value, "type") == "response_item" {
			payload, _ := value["payload"].(map[string]any)
			if payload != nil && strValue(payload, "type") == "message" && strValue(payload, "role") == "user" {
				text := extractText(payload["content"])
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
	for i := len(tail) - 1; i >= 0; i-- {
		var value map[string]any
		if err := json.Unmarshal([]byte(tail[i]), &value); err != nil {
			continue
		}
		if updatedAt == 0 {
			updatedAt = parseTimestampToMS(value["timestamp"])
		}
		if snippet == "" && strValue(value, "type") == "response_item" {
			payload, _ := value["payload"].(map[string]any)
			if payload != nil && strValue(payload, "type") == "message" {
				text := extractText(payload["content"])
				if strings.TrimSpace(text) != "" {
					snippet = truncateSummary(text, snippetMaxChars)
				}
			}
		}
		if updatedAt != 0 && snippet != "" {
			break
		}
	}

	if id == "" {
		id = inferCodexID(path)
	}
	if id == "" {
		return SessionSummary{}, false
	}
	title := normalizeTitle(firstUserMessage)
	titleSource := "first_user_message"
	if title == "" {
		title = pathBase(projectPath)
		titleSource = "project"
	}
	summary := SessionSummary{
		ID:          id,
		Source:      SourceCodex,
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
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary, summary.Validate() == nil
}

func inferCodexID(path string) string {
	fileName := filepath.Base(path)
	match := uuidRe.FindString(fileName)
	if match != "" {
		return match
	}
	stem := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	return strings.TrimSpace(stem)
}

type codexIndexedTitle struct {
	Title     string
	UpdatedAt int64
}

func (p *CodexProvider) applyIndexedTitle(summary *SessionSummary, titleIndex map[string]codexIndexedTitle) {
	if summary == nil || len(titleIndex) == 0 {
		return
	}
	indexed, ok := titleIndex[summary.ID]
	if !ok {
		return
	}
	if indexed.Title != "" && summary.TitleSource != "first_user_message" {
		summary.Title = indexed.Title
		summary.TitleSource = "source_title"
	}
	if indexed.UpdatedAt != 0 && indexed.UpdatedAt > summary.UpdatedAt {
		summary.UpdatedAt = indexed.UpdatedAt
	}
}

func loadCodexSessionIndex(codexDir string) map[string]codexIndexedTitle {
	indexPath := filepath.Join(codexDir, "session_index.jsonl")
	file, err := os.Open(indexPath)
	if err != nil {
		return nil
	}
	defer file.Close()

	result := make(map[string]codexIndexedTitle)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		var value map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			continue
		}
		id := strValue(value, "id")
		if id == "" {
			continue
		}
		title := normalizeTitle(strValue(value, "thread_name"))
		result[id] = codexIndexedTitle{
			Title:     title,
			UpdatedAt: parseTimestampToMS(value["updated_at"]),
		}
	}
	return result
}
