// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
)

const SourcePi = "pi"

type PiProvider struct {
	sessionsDir string
}

func NewPiProvider(sessionsDir string) *PiProvider {
	return &PiProvider{sessionsDir: sessionsDir}
}

func (p *PiProvider) Source() string {
	return SourcePi
}

func (p *PiProvider) List(ctx context.Context) ([]SessionSummary, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	files, err := p.ListFiles(ctx)
	if err != nil {
		return nil, err
	}
	var summaries []SessionSummary
	for _, file := range files {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		summary, ok := p.ParseSummary(ctx, file)
		if ok {
			summaries = append(summaries, summary)
		}
	}
	return summaries, nil
}

func (p *PiProvider) ListFiles(ctx context.Context) ([]SessionFile, error) {
	files, err := collectJSONLFiles(p.sessionsDir)
	if err != nil {
		return nil, err
	}
	return sessionFilesFromPaths(ctx, p.Source(), files)
}

func (p *PiProvider) ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool) {
	if ctx.Err() != nil {
		return SessionSummary{}, false
	}
	mtime, size := fileStatFields(file.Path)
	return p.parseSummaryFile(SessionFile{Source: p.Source(), Path: file.Path, MTime: mtime, Size: size})
}

func (p *PiProvider) parseSummaryFile(file SessionFile) (SessionSummary, bool) {
	head, _, err := readHeadTailLines(file.Path, 1, 1)
	if err != nil {
		return SessionSummary{}, false
	}
	if len(head) == 0 {
		return SessionSummary{}, false
	}
	var header piSessionHeader
	if err := json.Unmarshal([]byte(head[0]), &header); err != nil {
		return SessionSummary{}, false
	}
	if header.ID == "" {
		return SessionSummary{}, false
	}
	summary := SessionSummary{
		ID:          header.ID,
		Source:      SourcePi,
		ProjectPath: header.Cwd,
		CreatedAt:   header.Timestamp,
		FilePath:    file.Path,
		MTime:       file.MTime,
		Size:        file.Size,
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary, summary.Validate() == nil
}

type piSessionHeader struct {
	Type      string `json:"type"`
	Version   int    `json:"version"`
	ID        string `json:"id"`
	Timestamp int64  `json:"timestamp"`
	Cwd       string `json:"cwd"`
}

func (p *PiProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return parsePiMessages(ctx, file)
}

type piMessageEntry struct {
	msg      Message
	id       string
	parentID string
}

func parsePiMessages(ctx context.Context, r io.Reader) ([]Message, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	var entries []piMessageEntry
	for scanner.Scan() {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			continue
		}
		if strValue(value, "type") != "message" {
			continue
		}
		id := strValue(value, "id")
		if id == "" {
			continue
		}
		entry, ok := piEntryFromLine(value, len(entries)+1)
		if !ok {
			continue
		}
		entries = append(entries, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	childrenByParent := make(map[string][]int)
	for i, e := range entries {
		childrenByParent[e.parentID] = append(childrenByParent[e.parentID], i)
	}

	var messages []Message
	queue := append([]int(nil), childrenByParent[""]...)
	visited := make(map[int]bool, len(entries))
	for len(queue) > 0 {
		idx := queue[0]
		queue = queue[1:]
		if idx < 0 || idx >= len(entries) || visited[idx] {
			continue
		}
		visited[idx] = true
		messages = append(messages, entries[idx].msg)
		for _, childIdx := range childrenByParent[entries[idx].id] {
			if !visited[childIdx] {
				queue = append(queue, childIdx)
			}
		}
	}

	for i := range messages {
		messages[i].Seq = i + 1
	}
	return messages, nil
}

func piEntryFromLine(value map[string]any, seq int) (piMessageEntry, bool) {
	role := normalizeRole(strValue(value, "role"))
	content := value["content"]
	if content == nil {
		return piMessageEntry{}, false
	}

	text, toolName, ok := piExtractContent(content, role)
	if !ok {
		return piMessageEntry{}, false
	}
	if toolName != "" {
		text = "[Tool: " + toolName + "]"
	}

	return piMessageEntry{
		msg: Message{
			Seq:       seq,
			Role:      role,
			Text:      text,
			ToolName:  toolName,
			CharCount: runeCount(text),
		},
		id:        strValue(value, "id"),
		parentID:  strValue(value, "parentId"),
	}, true
}

// piExtractContent returns (text, toolName, ok). toolName is set for special
// content kinds (bashExecution) or for assistant toolcall items. ok=false
// means no readable content.
func piExtractContent(content any, role string) (string, string, bool) {
	if contentMap, ok := content.(map[string]any); ok {
		if kind, _ := contentMap["kind"].(string); kind == "bashExecution" {
			text := strValue(contentMap, "bashOutput")
			if strings.TrimSpace(text) == "" {
				return "", "", false
			}
			return text, "bash", true
		}
		text := extractText(contentMap)
		if strings.TrimSpace(text) == "" {
			return "", "", false
		}
		return text, "", true
	}

	if role == RoleAssistant {
		if arr, ok := content.([]any); ok {
			var toolName string
			var text string
			for _, item := range arr {
				itemMap, ok := item.(map[string]any)
				if !ok {
					continue
				}
				if kind, _ := itemMap["kind"].(string); kind == "bashExecution" {
					toolName = "bash"
					if t := strValue(itemMap, "bashOutput"); t != "" {
						text = t
					}
					break
				}
				if strValue(itemMap, "type") == "bashExecution" {
					toolName = "bash"
					if t := strValue(itemMap, "bashOutput"); t != "" {
						text = t
					}
					break
				}
				if strValue(itemMap, "type") == "toolcall" {
					toolName = strValue(itemMap, "name")
					if toolName == "" {
						toolName = "unknown"
					}
					break
				}
			}
			if text == "" {
				text = extractText(arr)
			}
			if strings.TrimSpace(text) == "" && toolName == "" {
				return "", "", false
			}
			if toolName != "" && strings.TrimSpace(text) == "" {
				return "", toolName, true
			}
			return text, toolName, true
		}
	}

	text := extractText(content)
	if strings.TrimSpace(text) == "" {
		return "", "", false
	}
	return text, "", true
}

func parsePiMessageDeltaLine(line []byte, seq int) (Message, bool) {
	var value map[string]any
	if err := json.Unmarshal(line, &value); err != nil {
		return Message{}, false
	}
	if strValue(value, "type") != "message" {
		return Message{}, false
	}
	role := normalizeRole(strValue(value, "role"))
	content := value["content"]
	if content == nil {
		return Message{}, false
	}

	text, toolName, ok := piExtractContent(content, role)
	if !ok {
		return Message{}, false
	}
	if toolName != "" {
		text = "[Tool: " + toolName + "]"
	}

	return Message{
		Seq:       seq,
		Role:      role,
		Text:      text,
		ToolName:  toolName,
		CharCount: runeCount(text),
	}, true
}

func (p *PiProvider) LoadToolCalls(ctx context.Context, filePath string) ([]ToolCall, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	var toolCalls []ToolCall
	for scanner.Scan() {
		if ctx.Err() != nil {
			return toolCalls, ctx.Err()
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			continue
		}
		if strValue(value, "type") != "message" {
			continue
		}
		if strValue(value, "role") != RoleAssistant {
			continue
		}
		arr, ok := value["content"].([]any)
		if !ok {
			continue
		}
		for _, item := range arr {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if strValue(itemMap, "type") != "toolcall" {
				continue
			}
			name := strValue(itemMap, "name")
			if name == "" {
				name = "unknown"
			}
			toolCalls = append(toolCalls, ToolCall{
				Seq:     len(toolCalls) + 1,
				Name:    name,
				Summary: summarizeToolInput(itemMap["input"]),
				Output:  strValue(itemMap, "output"),
			})
		}
	}
	if err := scanner.Err(); err != nil {
		return toolCalls, err
	}
	return toolCalls, nil
}

func (p *PiProvider) LoadMessageDelta(ctx context.Context, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error) {
	return loadLocalMessageDelta(ctx, p.Source(), filePath, cursor, maxBytes, parsePiMessageDeltaLine)
}
