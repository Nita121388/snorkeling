// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

const (
	titleMaxChars        = 80
	snippetMaxChars      = 160
	tailWindowBytes      = 16 * 1024
	toolSummaryMaxChars  = 800
	messageDeltaMaxBytes = 512 * 1024
)

var uuidRe = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)

func readHeadTailLines(path string, headN int, tailN int) ([]string, []string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return nil, nil, err
	}

	if stat.Size() < tailWindowBytes {
		all, err := readAllLines(file)
		if err != nil {
			return nil, nil, err
		}
		head := cloneLinesPrefix(all, headN)
		tail := cloneLinesSuffix(all, tailN)
		return head, tail, nil
	}

	head, err := readFirstLines(file, headN)
	if err != nil {
		return nil, nil, err
	}

	tailFile, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer tailFile.Close()

	seekPos := stat.Size() - tailWindowBytes
	if _, err := tailFile.Seek(seekPos, io.SeekStart); err != nil {
		return nil, nil, err
	}
	tailLines, err := readAllLines(tailFile)
	if err != nil {
		return nil, nil, err
	}
	if seekPos > 0 && len(tailLines) > 0 {
		tailLines = tailLines[1:]
	}
	return head, cloneLinesSuffix(tailLines, tailN), nil
}

func readAllLines(r io.Reader) ([]string, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines, scanner.Err()
}

type jsonlLineParser[T any] func(line []byte, seq int) (T, bool)

func parseJSONLFromReader[T any](ctx context.Context, r io.Reader, startSeq int, parser jsonlLineParser[T]) ([]T, int, int64, error) {
	reader := bufio.NewReader(r)
	seq := startSeq
	var items []T
	var bytesRead int64
	for {
		if ctx.Err() != nil {
			return items, seq, bytesRead, ctx.Err()
		}
		line, err := reader.ReadBytes('\n')
		if len(line) == 0 {
			if err == io.EOF {
				return items, seq, bytesRead, nil
			}
			if err != nil {
				return items, seq, bytesRead, err
			}
			continue
		}
		if err == io.EOF && !bytes.HasSuffix(line, []byte("\n")) {
			if item, ok := parser(bytes.TrimRight(line, "\r\n"), seq); ok {
				items = append(items, item)
				seq++
			}
			bytesRead += int64(len(line))
			return items, seq, bytesRead, nil
		}
		trimmed := bytes.TrimRight(line, "\r\n")
		if len(trimmed) == 0 {
			bytesRead += int64(len(line))
			continue
		}
		if item, ok := parser(trimmed, seq); ok {
			items = append(items, item)
			seq++
		}
		bytesRead += int64(len(line))
	}
}

func parseCompleteJSONLFromReader[T any](ctx context.Context, r io.Reader, startSeq int, parser jsonlLineParser[T]) ([]T, int, int64, error) {
	reader := bufio.NewReader(r)
	seq := startSeq
	var items []T
	var bytesRead int64
	for {
		if ctx.Err() != nil {
			return items, seq, bytesRead, ctx.Err()
		}
		line, err := reader.ReadBytes('\n')
		if len(line) == 0 {
			if err == io.EOF {
				return items, seq, bytesRead, nil
			}
			if err != nil {
				return items, seq, bytesRead, err
			}
			continue
		}
		if err == io.EOF {
			trimmed := bytes.TrimRight(line, "\r\n")
			if len(trimmed) == 0 {
				bytesRead += int64(len(line))
				return items, seq, bytesRead, nil
			}
			item, ok := parser(trimmed, seq)
			if !ok && !json.Valid(trimmed) {
				return items, seq, bytesRead, nil
			}
			if ok {
				items = append(items, item)
				seq++
			}
			bytesRead += int64(len(line))
			return items, seq, bytesRead, nil
		}
		trimmed := bytes.TrimRight(line, "\r\n")
		if len(trimmed) == 0 {
			bytesRead += int64(len(line))
			continue
		}
		if item, ok := parser(trimmed, seq); ok {
			items = append(items, item)
			seq++
		}
		bytesRead += int64(len(line))
	}
}

func normalizeMessageDeltaMaxBytes(maxBytes int64) int64 {
	if maxBytes <= 0 {
		return messageDeltaMaxBytes
	}
	if maxBytes > 4*1024*1024 {
		return 4 * 1024 * 1024
	}
	return maxBytes
}

func loadLocalMessageDelta(
	ctx context.Context,
	source string,
	filePath string,
	cursor SessionMessageCursor,
	maxBytes int64,
	parser jsonlLineParser[Message],
) (MessageDelta, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return MessageDelta{}, err
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return MessageDelta{}, err
	}
	fileSize := stat.Size()
	cursorOffset := cursor.ByteOffset
	if cursorOffset < 0 {
		cursorOffset = 0
	}
	nextCursor := SessionMessageCursor{
		ByteOffset: cursorOffset,
		FileSize:   fileSize,
		MTime:      stat.ModTime().UnixMilli(),
		LastSeq:    cursor.LastSeq,
	}
	if fileSize < cursorOffset {
		nextCursor.ByteOffset = 0
		nextCursor.LastSeq = 0
		return MessageDelta{Messages: []Message{}, Cursor: nextCursor, ResetRequired: true}, nil
	}
	if fileSize == cursorOffset {
		return MessageDelta{Messages: []Message{}, Cursor: nextCursor}, nil
	}
	readSize := fileSize - cursorOffset
	maxBytes = normalizeMessageDeltaMaxBytes(maxBytes)
	hasMore := false
	if readSize > maxBytes {
		readSize = maxBytes
		hasMore = true
	}
	if _, err := file.Seek(cursorOffset, io.SeekStart); err != nil {
		return MessageDelta{}, err
	}
	messages, lastSeq, bytesRead, err := parseCompleteJSONLFromReader(
		ctx,
		io.LimitReader(file, readSize),
		cursor.LastSeq+1,
		parser,
	)
	if err != nil {
		return MessageDelta{}, err
	}
	nextCursor.ByteOffset = cursorOffset + bytesRead
	nextCursor.LastSeq = cursor.LastSeq
	if lastSeq > 0 {
		nextCursor.LastSeq = lastSeq - 1
	}
	nextCursor.FileSize = fileSize
	nextCursor.MTime = stat.ModTime().UnixMilli()
	if nextCursor.ByteOffset < fileSize {
		hasMore = true
	}
	if messages == nil {
		messages = []Message{}
	}
	summary := SessionSummary{
		Source:       source,
		FilePath:     filePath,
		MTime:        nextCursor.MTime,
		Size:         fileSize,
		MessageCount: nextCursor.LastSeq,
	}
	return MessageDelta{
		Summary:  summary,
		Messages: messages,
		Cursor:   nextCursor,
		HasMore:  hasMore,
	}, nil
}

func readFirstLines(r io.Reader, n int) ([]string, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) >= n {
			break
		}
	}
	return lines, scanner.Err()
}

func cloneLinesPrefix(lines []string, n int) []string {
	if n > len(lines) {
		n = len(lines)
	}
	return append([]string(nil), lines[:n]...)
}

func cloneLinesSuffix(lines []string, n int) []string {
	if n > len(lines) {
		n = len(lines)
	}
	return append([]string(nil), lines[len(lines)-n:]...)
}

func collectJSONLFiles(root string) ([]string, error) {
	if root == "" {
		return nil, nil
	}
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var files []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ".jsonl") {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}

func parseTimestampToMS(value any) int64 {
	switch v := value.(type) {
	case nil:
		return 0
	case float64:
		n := int64(v)
		if n > 1_000_000_000_000 {
			return n
		}
		return n * 1000
	case int64:
		if v > 1_000_000_000_000 {
			return v
		}
		return v * 1000
	case json.Number:
		if n, err := v.Int64(); err == nil {
			if n > 1_000_000_000_000 {
				return n
			}
			return n * 1000
		}
	case string:
		if v == "" {
			return 0
		}
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			return t.UnixMilli()
		}
		if t, err := time.Parse("2006-01-02 15:04:05", v); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

func extractText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []any:
		var parts []string
		for _, item := range v {
			text := extractTextFromItem(item)
			if strings.TrimSpace(text) != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if text, _ := v["text"].(string); text != "" {
			return text
		}
		if text, _ := v["input_text"].(string); text != "" {
			return text
		}
		if text, _ := v["output_text"].(string); text != "" {
			return text
		}
		if content, ok := v["content"]; ok {
			return extractText(content)
		}
	}
	return ""
}

func extractTextFromItem(value any) string {
	item, ok := value.(map[string]any)
	if !ok {
		return extractText(value)
	}
	itemType, _ := item["type"].(string)
	switch itemType {
	case "tool_use":
		name, _ := item["name"].(string)
		if name == "" {
			name = "unknown"
		}
		return fmt.Sprintf("[Tool: %s]", name)
	case "tool_result":
		return extractText(item["content"])
	}
	return extractText(item)
}

func summarizeToolInput(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return ""
		}
		return truncateRunes(trimmed, toolSummaryMaxChars)
	default:
		data, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return ""
		}
		return truncateRunes(strings.TrimSpace(string(data)), toolSummaryMaxChars)
	}
}

func truncateSummary(text string, maxChars int) string {
	cleaned := strings.TrimSpace(text)
	if cleaned == "" {
		return ""
	}
	return truncateRunes(cleaned, maxChars)
}

func truncateRunes(text string, maxChars int) string {
	if runeCount(text) <= maxChars {
		return text
	}
	var b strings.Builder
	count := 0
	for _, r := range text {
		if count >= maxChars {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String() + "..."
}

func normalizeTitle(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	var lines []string
	inFence := false
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
			continue
		}
		if inFence || trimmed == "" {
			continue
		}
		trimmed = strings.TrimLeft(trimmed, "#")
		trimmed = strings.TrimSpace(trimmed)
		if strings.HasPrefix(trimmed, "/") {
			trimmed = trimLeadingTitlePath(trimmed)
		}
		if trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return truncateSummary(strings.Join(strings.Fields(strings.Join(lines, " ")), " "), titleMaxChars)
}

func effectiveUserText(text string) (string, bool) {
	trimmed := cleanUserText(text)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "# AGENTS.md") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "<environment_context>") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "<ide_opened_file>") {
		return "", false
	}
	if strings.Contains(trimmed, "<local-command-caveat>") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "<command-name>") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "A new session was started via /new or /reset.") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "Read HEARTBEAT.md if it exists") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "Read AGENTS.md if it exists") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "<turn_aborted>") {
		return "", false
	}
	if looksLikePureJSON(trimmed) {
		return "", false
	}
	asciiCount := 0
	nonASCII := 0
	for _, r := range trimmed {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		if r < 128 {
			asciiCount++
		} else {
			nonASCII++
		}
	}
	if nonASCII >= 4 || asciiCount >= 8 {
		return trimmed, true
	}
	return "", false
}

func isEffectiveUserText(text string) bool {
	_, ok := effectiveUserText(text)
	return ok
}

func cleanUserText(text string) string {
	trimmed := strings.TrimSpace(text)
	if strings.HasPrefix(trimmed, "[Discord ") {
		if idx := strings.Index(trimmed, "\n"); idx >= 0 {
			trimmed = strings.TrimSpace(trimmed[idx+1:])
		} else if idx := strings.Index(trimmed, "]"); idx >= 0 && idx+1 < len(trimmed) {
			trimmed = strings.TrimSpace(trimmed[idx+1:])
		}
	}
	var lines []string
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if line == "" && len(lines) == 0 {
			continue
		}
		if len(lines) == 0 && strings.HasPrefix(line, "[message_id:") && strings.HasSuffix(line, "]") {
			continue
		}
		lines = append(lines, line)
	}
	trimmed = strings.TrimSpace(strings.Join(lines, "\n"))
	if strings.HasPrefix(trimmed, "/") {
		trimmed = trimLeadingTitlePath(trimmed)
	}
	return trimmed
}

func looksLikePureJSON(text string) bool {
	if len(text) < 2 {
		return false
	}
	first := text[0]
	last := text[len(text)-1]
	if !((first == '{' && last == '}') || (first == '[' && last == ']')) {
		return false
	}
	var v any
	return json.Unmarshal([]byte(text), &v) == nil
}

func trimLeadingTitlePath(text string) string {
	for _, ext := range []string{".md", ".txt", ".go", ".ts", ".tsx", ".js", ".json", ".jsonl", ".yaml", ".yml"} {
		marker := ext + " "
		if idx := strings.Index(text, marker); idx >= 0 {
			path := strings.TrimSpace(text[:idx+len(ext)])
			if !strings.HasPrefix(path, "/") {
				continue
			}
			trimmed := strings.TrimSpace(text[idx+len(ext):])
			if trimmed == "" {
				return pathBase(path)
			}
			return trimmed
		}
	}
	fields := strings.Fields(text)
	if len(fields) < 2 {
		return text
	}
	first := fields[0]
	if !strings.HasPrefix(first, "/") || filepath.Ext(first) == "" {
		return text
	}
	trimmed := strings.TrimSpace(strings.TrimPrefix(text, first))
	if trimmed == "" {
		return pathBase(first)
	}
	return trimmed
}

func pathBase(value string) string {
	value = strings.TrimRight(strings.TrimSpace(value), `/\`)
	if value == "" {
		return ""
	}
	return filepath.Base(value)
}

func runeCount(text string) int {
	return len([]rune(text))
}

func isReadableMessage(message Message) bool {
	text := strings.TrimSpace(message.Text)
	if text == "" {
		return false
	}
	if message.Role == RoleTool {
		return false
	}
	if strings.HasPrefix(text, "[Tool:") &&
		strings.HasSuffix(text, "]") &&
		strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(text, "[Tool:"), "]")) != "" {
		return false
	}
	return true
}

func readableMessageCount(messages []Message) int {
	count := 0
	for _, message := range messages {
		if isReadableMessage(message) {
			count++
		}
	}
	return count
}

func lastMessageSeq(messages []Message) int {
	if len(messages) == 0 {
		return 0
	}
	return messages[len(messages)-1].Seq
}

func fileStatFields(path string) (mtime int64, size int64) {
	stat, err := os.Stat(path)
	if err != nil {
		return 0, 0
	}
	return stat.ModTime().UnixMilli(), stat.Size()
}

func strValue(value map[string]any, key string) string {
	str, _ := value[key].(string)
	return str
}

func normalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case RoleUser:
		return RoleUser
	case RoleAssistant, "ai":
		return RoleAssistant
	case RoleTool:
		return RoleTool
	case RoleSystem:
		return RoleSystem
	default:
		if strings.TrimSpace(role) == "" {
			return RoleUnknown
		}
		return role
	}
}
