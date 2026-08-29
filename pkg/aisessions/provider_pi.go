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
		msgs := piEntryMessages(value)
		// 一条 entry 可能拆成多条（正文 + 工具锚点）；取最后一个锚点之外的消息。
		for i := len(msgs) - 1; i >= 0; i-- {
			msg := msgs[i]
			text := strings.TrimSpace(msg.Text)
			if text == "" {
				continue
			}
			// A tool-call-only message renders as "[Tool: bash]"; skip it and keep
			// scanning for the last message that carries real content.
			if msg.ToolName != "" && strings.HasPrefix(text, "[Tool: ") {
				continue
			}
			return truncateSummary(text, snippetMaxChars)
		}
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

// piRawEntry is one parsed JSONL line that carries an id. Every typed entry
// (message, model_change, thinking_level_change, compaction, ...) stays in
// the tree because later messages may parent at non-message nodes. `msgs`
// holds the display messages this entry converts into (0 for non-message
// nodes, possibly >1 for an assistant entry with tool calls).
type piRawEntry struct {
	id       string
	parentID string
	msgs     []Message
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
	var entries []piRawEntry
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
		id := strValue(value, "id")
		if id == "" {
			continue
		}
		raw := piRawEntry{id: id, parentID: strValue(value, "parentId")}
		if strValue(value, "type") == "message" {
			raw.msgs = piEntryMessages(value)
		}
		entries = append(entries, raw)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}

	// Ordering mirrors pi's own buildSessionPath (pi core/session-manager.js):
	// the visible conversation is the path from the session header down to the
	// file's last entry (the current leaf), recovered by walking parentId links
	// backwards from that leaf and reversing. This keeps the real Q/A chronology
	// even when non-message nodes (model_change / thinking_level_change /
	// compaction) sit between messages, and shows only the active branch of a
	// forked session, exactly like the pi TUI.
	byID := make(map[string]int, len(entries))
	for i, e := range entries {
		byID[e.id] = i
	}
	visited := make(map[string]bool, len(entries))
	var path []piRawEntry
	for id := entries[len(entries)-1].id; id != ""; {
		idx, ok := byID[id]
		if !ok || visited[id] {
			break
		}
		visited[id] = true
		path = append(path, entries[idx])
		id = entries[idx].parentID
	}

	var messages []Message
	for i := len(path) - 1; i >= 0; i-- {
		for _, msg := range path[i].msgs {
			msg.Seq = len(messages) + 1
			messages = append(messages, msg)
		}
	}
	return messages, nil
}

// piExtractThinking joins the thinking blocks of a pi assistant message
// (content items of type "thinking" carry their reasoning in "thinking").
// Mirrors the schema of pi's agent_event stream; empty for non-assistant or
// thinking-free messages.
func piExtractThinking(content any) string {
	arr, ok := content.([]any)
	if !ok {
		return ""
	}
	var parts []string
	for _, item := range arr {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if !strings.EqualFold(strValue(itemMap, "type"), "thinking") {
			continue
		}
		if text := strings.TrimSpace(strValue(itemMap, "thinking")); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}

// piScanAssistantTools returns the tool names of an assistant content array,
// one entry per toolCall/bashExecution item, in order. Real pi files use the
// camelCase item type "toolCall"; older fixtures used "toolcall".
func piScanAssistantTools(arr []any) []string {
	var names []string
	for _, item := range arr {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		kind := strValue(itemMap, "kind")
		itemType := strValue(itemMap, "type")
		if kind == "bashExecution" || itemType == "bashExecution" {
			names = append(names, "bash")
			continue
		}
		if strings.EqualFold(itemType, "toolCall") {
			name := strValue(itemMap, "name")
			if name == "" {
				name = "unknown"
			}
			names = append(names, name)
		}
	}
	return names
}

// piEntryMessages converts one pi message entry into its display messages
// (0..n). An assistant entry with N tool calls becomes an optional text
// message plus ONE anchor message ("[Tool: name]") per tool call, so the
// timeline pairs every anchor with a ToolCall row positionally; thinking
// blocks attach to the first emitted message. Previously a mixed
// text+toolCall entry emitted no anchor at all and the tool calls never
// appeared in the detail view.
func piEntryMessages(value map[string]any) []Message {
	msgMap := piMsgMap(value)
	role := normalizeRole(strValue(msgMap, "role"))
	content := msgMap["content"]
	if content == nil {
		return nil
	}
	timestamp := parseTimestampToMS(value["timestamp"])

	// Special whole-entry bashExecution blob (pi `! bash` runs).
	if contentMap, ok := content.(map[string]any); ok {
		if kind, _ := contentMap["kind"].(string); kind == "bashExecution" {
			text := strings.TrimSpace(strValue(contentMap, "bashOutput"))
			if text == "" {
				return nil
			}
			return []Message{{Role: role, Text: text, ToolName: "bash", Timestamp: timestamp, CharCount: runeCount(text)}}
		}
	}

	text := strings.TrimSpace(extractText(content))
	thinking := ""
	var toolNames []string
	if role == RoleAssistant {
		thinking = piExtractThinking(content)
		if arr, ok := content.([]any); ok {
			toolNames = piScanAssistantTools(arr)
		}
	}

	toolName := ""
	if role == RoleTool {
		toolName = strValue(msgMap, "toolName")
	}
	if toolName != "" && text == "" {
		text = "[Tool: " + toolName + "]"
	}

	var msgs []Message
	if text != "" {
		msgs = append(msgs, Message{
			Role: role, Text: text, ToolName: toolName, Thinking: thinking,
			Timestamp: timestamp, CharCount: runeCount(text),
		})
		thinking = ""
	}
	for _, name := range toolNames {
		anchorText := "[Tool: " + name + "]"
		msgs = append(msgs, Message{
			Role: role, Text: anchorText, ToolName: name, Thinking: thinking,
			Timestamp: timestamp, CharCount: len(anchorText),
		})
		thinking = ""
	}
	return msgs
}

func parsePiMessageDeltaLine(line []byte, seq int) ([]Message, bool) {
	var value map[string]any
	if err := json.Unmarshal(line, &value); err != nil {
		return nil, false
	}
	if strValue(value, "type") != "message" {
		return nil, false
	}
	msgs := piEntryMessages(value)
	if len(msgs) == 0 {
		return nil, false
	}
	for i := range msgs {
		msgs[i].Seq = seq + i
	}
	return msgs, true
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
			// bashExecution items (pi `! bash` runs) render as anchor messages too,
			// so they must appear here to pair up with the timeline anchors.
			itemType := strValue(itemMap, "type")
			if strValue(itemMap, "kind") == "bashExecution" || itemType == "bashExecution" {
				pending = append(pending, piToolCallItem{
					tc: ToolCall{
						Seq:    len(pending) + 1,
						Name:   "bash",
						Output: strValue(itemMap, "bashOutput"),
					},
				})
				continue
			}
			if !strings.EqualFold(itemType, "toolCall") {
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
