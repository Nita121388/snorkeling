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

// parseSummaryFile reads the pi JSONL v3 header line, plus the first-window
// messages to derive a human-readable title. Real pi files carry an ISO-8601
// string timestamp (older fixtures guessed numeric epoch), so the line is
// decoded as a generic map and normalized with parseTimestampToMS, which
// accepts both shapes.
func (p *PiProvider) parseSummaryFile(file SessionFile) (SessionSummary, bool) {
	head, tail, err := readHeadTailLines(file.Path, 1, 30)
	if err != nil {
		return SessionSummary{}, false
	}
	if len(head) == 0 {
		return SessionSummary{}, false
	}
	var header map[string]any
	if err := json.Unmarshal([]byte(head[0]), &header); err != nil {
		return SessionSummary{}, false
	}
	if strValue(header, "type") != "session" {
		return SessionSummary{}, false
	}
	id := strValue(header, "id")
	if id == "" {
		return SessionSummary{}, false
	}
	createdAt := parseTimestampToMS(header["timestamp"])
	updatedAt := createdAt
	if len(tail) > 0 {
		var lastLine map[string]any
		if err := json.Unmarshal([]byte(tail[len(tail)-1]), &lastLine); err == nil {
			if ts := parseTimestampToMS(lastLine["timestamp"]); ts != 0 {
				updatedAt = ts
			}
		}
	}
	if updatedAt == 0 {
		updatedAt = file.MTime
	}
	title, titleSource := p.scanTitle(file.Path)
	summary := SessionSummary{
		ID:          id,
		Source:      SourcePi,
		Title:       title,
		TitleSource: titleSource,
		ProjectPath: strValue(header, "cwd"),
		Snippet:     p.scanSnippet(tail),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
		FilePath:    file.Path,
		MTime:       file.MTime,
		Size:        file.Size,
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary, summary.Validate() == nil
}

// scanSnippet derives a short content preview from the tail of a pi session
// file, mirroring the codex/claude providers: scan backwards and take the first
// message with readable text (skipping empty and tool-call-only entries),
// truncated to snippetMaxChars. A real session usually ends with the assistant's
// final answer, so the last non-empty text is a good preview.
func (p *PiProvider) scanSnippet(tail []string) string {
	for i := len(tail) - 1; i >= 0; i-- {
		line := strings.TrimSpace(tail[i])
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
		entry, ok := piEntryFromLine(value, 0)
		if !ok {
			continue
		}
		text := strings.TrimSpace(entry.msg.Text)
		if text == "" {
			continue
		}
		// A tool-call-only message renders as "[Tool: bash]"; skip it and keep
		// scanning for the last message that carries real content.
		if entry.msg.ToolName != "" && strings.HasPrefix(text, "[Tool: ") {
			continue
		}
		return truncateSummary(text, snippetMaxChars)
	}
	return ""
}

// scanTitle derives a display title from the entries of a pi session file.
// Priority matches pi's own getSessionName() semantics:
//
//	1. latest session_info entry's name (explicit /name or --name) -> source_title
//	2. first effective user message text                          -> first_user_message
//
// Returns ("", "") when neither is found, so the caller falls back to the
// project basename (or session id) via DisplayTitle. The forward pass breaks
// as soon as both sources are found, so the common case (first user message)
// reads only the header plus a couple of lines.
//
// pony: when a session has neither a name nor an effective first user message,
// the whole file is scanned; that is rare and still bounded by the 16MB scanner
// cap. Upgrade path: read only the first tailWindowBytes window like the codex
// provider does, via a dedicated bytes-scoped line reader.
func (p *PiProvider) scanTitle(path string) (string, string) {
	file, err := os.Open(path)
	if err != nil {
		return "", ""
	}
	defer file.Close()

	var name string
	var firstUserMessage string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			continue
		}
		switch strValue(value, "type") {
		case "session_info":
			// Keep the latest (pi's getSessionName uses the latest entry).
			if n := strings.TrimSpace(strValue(value, "name")); n != "" {
				name = n
			}
		case "message":
			msgMap := piMsgMap(value)
			if normalizeRole(strValue(msgMap, "role")) != RoleUser {
				continue
			}
			text := extractText(msgMap["content"])
			if effective, ok := effectiveUserText(text); ok && firstUserMessage == "" {
				firstUserMessage = effective
			}
		}
		if name != "" && firstUserMessage != "" {
			break
		}
	}

	if name != "" {
		return normalizeTitle(name), "source_title"
	}
	if firstUserMessage != "" {
		return normalizeTitle(firstUserMessage), "first_user_message"
	}
	return "", ""
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

// piMsgMap returns the effective message payload for a `type:"message"` line.
// Real pi v3 files nest role/content under `"message"`; the flat shape (role
// and content at top level) is kept as a fallback for older fixtures/tools.
func piMsgMap(value map[string]any) map[string]any {
	if msgMap, ok := value["message"].(map[string]any); ok {
		return msgMap
	}
	return value
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

	// pi writes a linear conversation chain whose first message's parentId
	// points at the last non-message node (model_change / thinking_level_change
	// / compaction). A message is a tree root when its parentId is empty or
	// names a node that is not itself a message; BFS from those roots restores
	// the conversation order.
	ids := make(map[string]bool, len(entries))
	for _, e := range entries {
		ids[e.id] = true
	}
	childrenByParent := make(map[string][]int)
	queue := make([]int, 0, 1)
	for i, e := range entries {
		if e.parentID == "" || !ids[e.parentID] {
			queue = append(queue, i)
			continue
		}
		childrenByParent[e.parentID] = append(childrenByParent[e.parentID], i)
	}

	visited := make(map[int]bool, len(entries))
	var messages []Message
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
	msgMap := piMsgMap(value)
	role := normalizeRole(strValue(msgMap, "role"))
	content := msgMap["content"]
	if content == nil {
		return piMessageEntry{}, false
	}

	text, toolName, ok := piExtractContent(content, role)
	if !ok {
		return piMessageEntry{}, false
	}
	// toolResult messages carry their tool name at the message level.
	if toolName == "" && role == RoleTool {
		toolName = strValue(msgMap, "toolName")
	}
	if toolName != "" && strings.TrimSpace(text) == "" {
		text = "[Tool: " + toolName + "]"
	}

	return piMessageEntry{
		msg: Message{
			Seq:       seq,
			Role:      role,
			Text:      text,
			ToolName:  toolName,
			Timestamp: parseTimestampToMS(value["timestamp"]),
			CharCount: runeCount(text),
		},
		id:       strValue(value, "id"),
		parentID: strValue(value, "parentId"),
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
			text := extractText(arr)
			toolName, bashOutput := piScanAssistantTool(arr)
			if strings.TrimSpace(text) == "" && toolName == "" {
				return "", "", false
			}
			if strings.TrimSpace(text) == "" && bashOutput != "" {
				text = bashOutput
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

// piScanAssistantTool scans an assistant content array for the first
// bashExecution or toolcall item and returns the tool name and bashOutput (if
// bashExecution). Returns ("", "") when no tool item is found. Real pi files
// use the camelCase item type "toolCall"; older fixtures used "toolcall".
func piScanAssistantTool(arr []any) (toolName, bashOutput string) {
	for _, item := range arr {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		kind := strValue(itemMap, "kind")
		itemType := strValue(itemMap, "type")
		if kind == "bashExecution" || itemType == "bashExecution" {
			toolName = "bash"
			bashOutput = strValue(itemMap, "bashOutput")
			return toolName, bashOutput
		}
		if strings.EqualFold(itemType, "toolCall") {
			toolName = strValue(itemMap, "name")
			if toolName == "" {
				toolName = "unknown"
			}
			return toolName, ""
		}
	}
	return "", ""
}

func parsePiMessageDeltaLine(line []byte, seq int) (Message, bool) {
	var value map[string]any
	if err := json.Unmarshal(line, &value); err != nil {
		return Message{}, false
	}
	if strValue(value, "type") != "message" {
		return Message{}, false
	}
	msgMap := piMsgMap(value)
	role := normalizeRole(strValue(msgMap, "role"))
	content := msgMap["content"]
	if content == nil {
		return Message{}, false
	}

	text, toolName, ok := piExtractContent(content, role)
	if !ok {
		return Message{}, false
	}
	if toolName == "" && role == RoleTool {
		toolName = strValue(msgMap, "toolName")
	}
	if toolName != "" && strings.TrimSpace(text) == "" {
		text = "[Tool: " + toolName + "]"
	}

	return Message{
		Seq:       seq,
		Role:      role,
		Text:      text,
		ToolName:  toolName,
		Timestamp: parseTimestampToMS(value["timestamp"]),
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
	// toolResult messages carry the tool output, but they are written AFTER the
	// assistant toolCall item that references them, so outputs are collected in
	// one pass and resolved against pending tool calls after the scan.
	type piToolCallItem struct {
		tc     ToolCall
		callID string
	}
	var pending []piToolCallItem
	outputByCallID := make(map[string]string)
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
		msgMap := piMsgMap(value)
		role := normalizeRole(strValue(msgMap, "role"))
		if role == RoleTool {
			if callID := strValue(msgMap, "toolCallId"); callID != "" {
				if text := extractText(msgMap["content"]); strings.TrimSpace(text) != "" {
					outputByCallID[callID] = text
				}
			}
			continue
		}
		if role != RoleAssistant {
			continue
		}
		arr, ok := msgMap["content"].([]any)
		if !ok {
			continue
		}
		for _, item := range arr {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if !strings.EqualFold(strValue(itemMap, "type"), "toolCall") {
				continue
			}
			name := strValue(itemMap, "name")
			if name == "" {
				name = "unknown"
			}
			input := itemMap["arguments"]
			if input == nil {
				input = itemMap["input"]
			}
			pending = append(pending, piToolCallItem{
				tc: ToolCall{
					Seq:     len(pending) + 1,
					Name:    name,
					Summary: summarizeToolInput(input),
					Output:  strValue(itemMap, "output"),
				},
				callID: strValue(itemMap, "id"),
			})
		}
	}
	if err := scanner.Err(); err != nil {
		return toolCalls, err
	}
	for _, item := range pending {
		if item.tc.Output == "" {
			item.tc.Output = outputByCallID[item.callID]
		}
		toolCalls = append(toolCalls, item.tc)
	}
	return toolCalls, nil
}

func (p *PiProvider) LoadMessageDelta(ctx context.Context, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error) {
	return loadLocalMessageDelta(ctx, p.Source(), filePath, cursor, maxBytes, parsePiMessageDeltaLine)
}
