// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Annotation AI drafts (manual, user-triggered).
//
// The caller always reviews drafts; nothing here writes to the annotation table.
// Anchor keys are validated against the digest built from the actual session
// messages, so a hallucinated node is dropped instead of landing in the DB.

package aisessions

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	AnnotationScopeTimeline   = "timeline"
	AnnotationScopeEntryTitle = "entry-title"
	AnnotationScopeEntryBody  = "entry-body"
	AnnotationScopeEntryTags  = "entry-tags"
)

// 节点摘要预算。历史值 500 字 × 200 节点 ≈ 10 万字符输入，直接把一次 30–47s
// 的调用推到服务商限流，而模型又在 2048 token 的输出上限写不完 JSON。
const annotationDigestNodeChars = 240
const annotationDigestMaxNodes = 60
const annotationDigestMaxChars = 24000

// 生成重试次数。第 2 次用「只许 JSON」的强约束系统提示，第 3 次把条目数减半：
// 既压住截断，也给限流留出退避窗口。
const annotationGenerateAttempts = 3

// 输出 token 预算下限/上限：小请求也要保留 2048，大请求最多 8192。
const annotationMinOutputTokens = 2048
const annotationMaxOutputTokensCap = 8192

type AnnotationDraft struct {
	AnchorKey string   `json:"anchorKey"`
	Kind      string   `json:"kind"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags,omitempty"`
}

type AnnotationAssistInput struct {
	SessionKey   string
	Scope        string
	AnchorKey    string
	Title        string
	Body         string
	ExistingTags []string
	Messages     []Message
	ToolCalls    []ToolCall
	MaxEntries   int
	AIMode       string
	PromptConfig wconfig.AIPromptConfigType
}

type annotationDigestEntry struct {
	AnchorKey string
	Seq       int
	Role      string
	Text      string
}

func normalizeAnnotationScope(scope string) string {
	switch strings.TrimSpace(strings.ToLower(scope)) {
	case AnnotationScopeEntryTitle, AnnotationScopeEntryBody, AnnotationScopeEntryTags:
		return strings.TrimSpace(strings.ToLower(scope))
	default:
		return AnnotationScopeTimeline
	}
}

func buildAnnotationDigest(messages []Message, toolCalls []ToolCall) []annotationDigestEntry {
	entries := make([]annotationDigestEntry, 0, len(messages)+len(toolCalls))
	for _, message := range messages {
		if strings.TrimSpace(message.ItemKey) == "" {
			continue
		}
		text := message.Text
		if strings.TrimSpace(text) == "" {
			text = message.Thinking
		}
		entries = append(entries, annotationDigestEntry{
			AnchorKey: message.ItemKey,
			Seq:       message.Seq,
			Role:      message.Role,
			Text:      truncateAnnotationText(text, annotationDigestNodeChars),
		})
	}
	for _, toolCall := range toolCalls {
		if strings.TrimSpace(toolCall.ItemKey) == "" {
			continue
		}
		text := strings.TrimSpace(strings.Join([]string{toolCall.Name, toolCall.Summary}, " "))
		entries = append(entries, annotationDigestEntry{
			AnchorKey: toolCall.ItemKey,
			Seq:       toolCall.Seq,
			Role:      "tool",
			Text:      truncateAnnotationText(text, annotationDigestNodeChars),
		})
	}
	if len(entries) > annotationDigestMaxNodes {
		entries = entries[len(entries)-annotationDigestMaxNodes:]
	}
	// 再按字符预算从最新往回取舍：条数达标不代表体积达标（长工具输出）。
	budget := 0
	cut := len(entries)
	for i := len(entries) - 1; i >= 0; i-- {
		budget += len([]rune(entries[i].Text)) + len(entries[i].AnchorKey) + 48
		if budget > annotationDigestMaxChars {
			break
		}
		cut = i
	}
	return entries[cut:]
}

func truncateAnnotationText(text string, limit int) string {
	trimmed := strings.TrimSpace(text)
	runes := []rune(trimmed)
	if len(runes) <= limit {
		return trimmed
	}
	return string(runes[:limit]) + "…"
}

func buildAnnotationAssistPrompt(in AnnotationAssistInput, digest []annotationDigestEntry) string {
	var b strings.Builder
	switch normalizeAnnotationScope(in.Scope) {
	case AnnotationScopeEntryTitle, AnnotationScopeEntryBody, AnnotationScopeEntryTags:
		b.WriteString("Current annotation\n")
		b.WriteString("title: " + in.Title + "\n")
		b.WriteString("body: " + in.Body + "\n")
		if len(in.ExistingTags) > 0 {
			b.WriteString("tags: " + strings.Join(in.ExistingTags, ", ") + "\n")
		}
		b.WriteString("\nAnchored node\n")
		for _, entry := range digest {
			if entry.AnchorKey == in.AnchorKey {
				b.WriteString("anchorKey: " + entry.AnchorKey + "\n")
				b.WriteString("role: " + entry.Role + "\n")
				b.WriteString("text:\n" + entry.Text + "\n")
				break
			}
		}
		return b.String()
	default:
		b.WriteString("Session anchors, newest last. Each line is one JSON object; anchorKey is the quoted value only:\n")
		for _, entry := range digest {
			// 每行一个 JSON 对象：比 "- anchorKey=%s seq=%d role=%s text=%s" 边界清楚，
			// 模型不会再连 " seq=618" 一起抄进 anchorKey（那会让所有草稿校验失败）。
			line, err := json.Marshal(struct {
				AnchorKey string `json:"anchorKey"`
				Seq       int    `json:"seq"`
				Role      string `json:"role"`
				Text      string `json:"text"`
			}{entry.AnchorKey, entry.Seq, entry.Role, entry.Text})
			if err != nil {
				continue
			}
			b.Write(line)
			b.WriteByte('\n')
		}
		b.WriteString("\nCopy anchorKey exactly as the quoted string. Never append seq/role/text, never invent a key.\n")
		b.WriteString("Reply with the JSON object only: no analysis, no reasoning, no markdown fences.\n")
		return b.String()
	}
}

// annotationReplyIssue 标注「为什么这条回复没解析出草稿」，用于给用户可执行的错误文案。
type annotationReplyIssue string

const (
	annotationIssueNone      annotationReplyIssue = ""
	annotationIssueNoJSON    annotationReplyIssue = "no-json"
	annotationIssueTruncated annotationReplyIssue = "truncated"
	annotationIssueInvalid   annotationReplyIssue = "invalid"
)

func parseAnnotationDraftResponse(reply string) ([]AnnotationDraft, error) {
	drafts, _, err := parseAnnotationReply(reply)
	return drafts, err
}

// parseAnnotationReply 依次尝试：整段 JSON → 剥掉推理/围栏后的 JSON → 第一个平衡值 →
// 截断修复。第三个返回值说明失败类型，供调用方生成可执行提示（截断 vs 纯散文）。
func parseAnnotationReply(reply string) ([]AnnotationDraft, annotationReplyIssue, error) {
	cleaned := stripAnnotationReasoning(reply)
	candidates := []string{stripJSONFence(reply), stripJSONFence(cleaned)}

	for _, raw := range candidates {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		if drafts, ok := decodeAnnotationDrafts(raw); ok {
			return drafts, annotationIssueNone, nil
		}
		if extracted := extractFirstJSONValue(raw); extracted != "" {
			if drafts, ok := decodeAnnotationDrafts(extracted); ok {
				return drafts, annotationIssueNone, nil
			}
		}
	}

	// 输出被 token 上限切断时，括号永远补不齐。切掉最后一个不完整的条目再补括号，
	// 把已经写完整的草稿救回来，而不是整批丢弃。
	for _, raw := range candidates {
		repaired := repairTruncatedJSONValue(raw)
		if repaired == "" {
			continue
		}
		if drafts := decodeAnnotationDraftsPartial(repaired); drafts != nil {
			return drafts, annotationIssueNone, nil
		}
	}

	if strings.ContainsAny(cleaned, "{[") {
		return nil, annotationIssueTruncated, fmt.Errorf("annotation AI response was not valid JSON")
	}
	return nil, annotationIssueNoJSON, fmt.Errorf("annotation AI response contained no JSON object")
}

func decodeAnnotationDrafts(raw string) ([]AnnotationDraft, bool) {
	var wrapper struct {
		Annotations []AnnotationDraft `json:"annotations"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil && wrapper.Annotations != nil {
		return wrapper.Annotations, true
	}
	var list []AnnotationDraft
	if err := json.Unmarshal([]byte(raw), &list); err == nil {
		return list, true
	}
	var single AnnotationDraft
	if err := json.Unmarshal([]byte(raw), &single); err == nil && (single.AnchorKey != "" || single.Title != "" || single.Body != "") {
		return []AnnotationDraft{single}, true
	}
	return nil, false
}

// decodeAnnotationDraftsPartial 允许「救回来的条目」里没有 annotations 包装。
func decodeAnnotationDraftsPartial(raw string) []AnnotationDraft {
	if drafts, ok := decodeAnnotationDrafts(raw); ok {
		return drafts
	}
	return nil
}

// stripAnnotationReasoning 去掉思考模型常见的推理外包装，只留可能承载 JSON 的正文。
func stripAnnotationReasoning(reply string) string {
	text := reply
	for _, tag := range []string{"thinking", "analysis", "reasoning", "scratch"} {
		for {
			open := strings.Index(text, "<"+tag+">")
			if open < 0 {
				break
			}
			closeIdx := strings.Index(text[open:], "</"+tag+">")
			if closeIdx < 0 {
				text = text[:open]
				break
			}
			text = text[:open] + text[open+closeIdx+len("</"+tag+">"):]
		}
	}
	if idx := strings.LastIndex(text, "</think>"); idx >= 0 {
		text = text[idx+len("</think>"):]
	}
	return text
}

// repairTruncatedJSONValue 截断在半个对象处时，回退到最后一个完整子项并补齐括号。
// 返回空串表示没有任何可用内容。
func repairTruncatedJSONValue(text string) string {
	start := strings.IndexAny(text, "{[")
	if start < 0 {
		return ""
	}
	body := text[start:]
	depth := 0
	inString := false
	escaped := false
	lastComplete := -1
	for i := 0; i < len(body); i++ {
		ch := body[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
		case '{', '[':
			depth++
		case '}', ']':
			if depth > 0 {
				depth--
			}
			if depth == 0 {
				return "" // 已经平衡，不是截断场景
			}
			// 任何一个「在一个容器内部闭合的完整子项」都可以当作回退点；
			// 最后一次命中就是截断前最后一个写得完整的对象。
			lastComplete = i + 1
		}
	}
	if lastComplete <= 0 {
		return ""
	}
	head := strings.TrimRight(body[:lastComplete], " \t\r\n,")
	var closers []byte
	inString = false
	escaped = false
	for i := 0; i < len(head); i++ {
		ch := head[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
		case '{':
			closers = append(closers, '}')
		case '[':
			closers = append(closers, ']')
		case '}', ']':
			if len(closers) > 0 {
				closers = closers[:len(closers)-1]
			}
		}
	}
	var b strings.Builder
	b.WriteString(head)
	for i := len(closers) - 1; i >= 0; i-- {
		b.WriteByte(closers[i])
	}
	return b.String()
}

// normalizeAnnotationAnchorKey 只保留 key 本体：模型常把随行的 " seq=618 role=tool"
// 一起抄回来（prompt 旧格式的锅），这里统一截断到第一个空白前并去掉引号。
func normalizeAnnotationAnchorKey(raw string) string {
	key := strings.TrimSpace(raw)
	key = strings.Trim(key, "`\"'")
	if fields := strings.Fields(key); len(fields) > 0 {
		key = fields[0]
	}
	return strings.Trim(key, "`\"'")
}

// annotationOutputBudget 按「条目数 × 单条体量」估算输出上限：2048 写 12 条 600 字
// 的批注根本不够，正是历史截断/解析失败的主因。
func annotationOutputBudget(entries int, bodyChars int) int {
	if entries <= 0 {
		entries = DefaultMaxAnnotations
	}
	if bodyChars <= 0 {
		bodyChars = DefaultMaxAnnotationBodyChars
	}
	perEntry := 90 + bodyChars/3
	total := 1024 + entries*perEntry
	if total < annotationMinOutputTokens {
		return annotationMinOutputTokens
	}
	if total > annotationMaxOutputTokensCap {
		return annotationMaxOutputTokensCap
	}
	return total
}

// extractFirstJSONValue returns the first balanced {...} or [...] substring.
// It is string-aware so braces inside quoted values do not confuse the scan.
func extractFirstJSONValue(text string) string {
	start := -1
	var open, close byte
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '{':
			start, open, close = i, '{', '}'
		case '[':
			start, open, close = i, '[', ']'
		}
		if start >= 0 {
			break
		}
	}
	if start < 0 {
		return ""
	}
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(text); i++ {
		ch := text[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		if ch == '"' {
			inString = true
			continue
		}
		switch ch {
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return text[start : i+1]
			}
		}
	}
	return ""
}

func stripJSONFence(text string) string {
	s := strings.TrimSpace(text)
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "```"))
	}
	return s
}

// GenerateAnnotationDrafts runs one AI call and returns validated drafts.
// Invalid anchor keys and kinds are dropped; body/tag lengths are clamped.
// annotationDraftGenerator is a seam so tests can inject a stub model call.
var annotationDraftGenerator = generateAnnotationDraftsReal

func GenerateAnnotationDrafts(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, error) {
	drafts, model, _, err := GenerateAnnotationDraftsWithContext(ctx, in)
	return drafts, model, err
}

// GenerateAnnotationDraftsRaw also returns the model's raw reply so the audit
// log can show exactly what came back when parsing fails.
func GenerateAnnotationDraftsWithContext(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, string, error) {
	return annotationDraftGenerator(ctx, in)
}

func generateAnnotationDraftsReal(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, string, error) {
	scope := normalizeAnnotationScope(in.Scope)
	cfg := promptConfigWithFallbackMode(in.PromptConfig, in.AIMode)
	mode := ResolveAIMode(cfg)
	maxEntries := ClampAnnotationCount(in.MaxEntries)
	bodyLimit := ClampAnnotationBodyChars(cfg.MaxBodyChars)
	// 输出上限按请求量估算：2048 token 写 12 条 600 字批注必然被截断，
	// 正是历史「not valid JSON」的主因（模型写到一半就没预算了）。
	opts, err := aiusechat.GetAIOptsForMode(mode, annotationOutputBudget(maxEntries, bodyLimit))
	if err != nil {
		return nil, "", "", fmt.Errorf("resolving AI annotation model: %w", err)
	}
	digest := buildAnnotationDigest(in.Messages, in.ToolCalls)
	if len(digest) == 0 {
		return nil, mode, "", fmt.Errorf("session has no anchorable messages")
	}
	valid := make(map[string]bool, len(digest))
	for _, entry := range digest {
		valid[entry.AnchorKey] = true
	}
	systemPrompt := ResolvePrompt(PromptFeatureSessionAnnotations, cfg)
	strictSystemPrompt := systemPrompt + "\n\nReturn ONLY the JSON object. Do not think out loud, do not explain, do not use markdown fences."

	var drafts []AnnotationDraft
	var lastParseErr error
	var lastParseIssue annotationReplyIssue
	var lastTransportErr error
	var lastReply string
	for attempt := 0; attempt < annotationGenerateAttempts; attempt++ {
		if attempt > 0 {
			// 逐次退避：429 时立刻重发只会把窗口打得更死。
			if !annotationSleep(ctx, annotationRetryDelay(attempt)) {
				lastTransportErr = ctx.Err()
				break
			}
		}
		attemptInput := in
		if attempt == annotationGenerateAttempts-1 && scope == AnnotationScopeTimeline {
			// 最后一次降载：条目减半，既缩短输出也降低触发限流的概率。
			attemptInput.MaxEntries = maxEntries / 2
			if attemptInput.MaxEntries < 1 {
				attemptInput.MaxEntries = 1
			}
		}
		attemptSystem := systemPrompt
		attemptPrompt := buildAnnotationAssistPrompt(attemptInput, digest)
		if attempt > 0 {
			attemptSystem = strictSystemPrompt
			attemptPrompt += "\n\nIMPORTANT: your previous reply could not be parsed as JSON. Reply with ONLY the JSON object, no prose, no reasoning, no markdown fences, no trailing text."
		}
		reply, runErr := aiusechat.RunCompletion(ctx, *opts, attemptSystem, attemptPrompt)
		if runErr != nil {
			lastTransportErr = runErr
			continue
		}
		lastReply = reply
		parsed, issue, parseErr := parseAnnotationReply(reply)
		if parseErr != nil {
			lastParseErr = parseErr
			lastParseIssue = issue
			continue
		}
		drafts = parsed
		lastParseErr = nil
		lastParseIssue = annotationIssueNone
		lastTransportErr = nil
		break
	}
	if lastParseErr != nil || lastTransportErr != nil {
		// 不要把后一次 429 盖掉前一次「JSON 截断」这种真正可行动的失败：
		// 两者都保留，先说解析问题，再说传输问题。
		errText := annotationErrorText(lastParseErr, lastParseIssue, lastTransportErr)
		snippet := truncateAnnotationText(lastReply, 600)
		if snippet != "" {
			return nil, mode, lastReply, fmt.Errorf("%s (model replied: %s)", errText, snippet)
		}
		return nil, mode, lastReply, fmt.Errorf("%s", errText)
	}

	if scope == AnnotationScopeTimeline {
		if maxEntries > 0 && len(drafts) > maxEntries {
			drafts = drafts[:maxEntries]
		}
	} else if len(drafts) > 1 {
		drafts = drafts[:1]
	}
	tagLimit := ClampTagCount(cfg.MaxTags)
	result := make([]AnnotationDraft, 0, len(drafts))
	for _, draft := range drafts {
		// 模型会把 digest 里的 " seq=618 role=tool" 一起抄进 anchorKey，
		// 不归一化的话每条都会被 valid[] 判掉，表现就是「AI 生成了但一条都没有」。
		draft.AnchorKey = normalizeAnnotationAnchorKey(draft.AnchorKey)
		if draft.AnchorKey == "" {
			if scope != AnnotationScopeTimeline {
				draft.AnchorKey = in.AnchorKey
			}
			if draft.AnchorKey == "" {
				continue
			}
		}
		if !valid[draft.AnchorKey] {
			continue
		}
		draft.Kind = normalizeAnnotationKind(draft.Kind)
		draft.Title = strings.TrimSpace(draft.Title)
		draft.Body = strings.TrimSpace(draft.Body)
		if r := []rune(draft.Body); len(r) > bodyLimit {
			draft.Body = strings.TrimSpace(string(r[:bodyLimit]))
		}
		draft.Tags = NormalizeSessionTags(draft.Tags)
		if len(draft.Tags) > tagLimit {
			draft.Tags = draft.Tags[:tagLimit]
		}
		if draft.Title == "" && draft.Body == "" && len(draft.Tags) == 0 {
			continue
		}
		result = append(result, draft)
	}
	return result, mode, lastReply, nil
}

// annotationRetryDelay 第 N 次重试前的等待时间（1.5s / 4s，带抖动）。
// 服务商回 429 时立刻重发只会继续撞墙。
func annotationRetryDelay(attempt int) time.Duration {
	base := 1500 * time.Millisecond
	if attempt >= 2 {
		base = 4 * time.Second
	}
	jitter := time.Duration(time.Now().UnixNano()%400) * time.Millisecond
	return base + jitter
}

// annotationSleep 在 ctx 取消时提前返回 false。
func annotationSleep(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// annotationErrorText 把「解析失败」和「传输失败」都保留下来，并按失败类型
// 给出可执行的提示：截断要降条目/降 body 或换输出上限更大的模型，纯散文要换非思考模型。
func annotationErrorText(parseErr error, issue annotationReplyIssue, transportErr error) string {
	var b strings.Builder
	switch issue {
	case annotationIssueTruncated:
		b.WriteString("annotation AI reply was cut off (unterminated JSON — likely hit the model's output token cap); lower Max annotations / Max body chars or pick a model with a larger output limit")
	case annotationIssueNoJSON:
		b.WriteString("annotation AI reply contained no JSON (the model answered with prose/reasoning); use a non-reasoning model or retry")
	case annotationIssueInvalid:
		b.WriteString("annotation AI reply was not valid JSON")
	}
	if parseErr != nil {
		if b.Len() > 0 {
			b.WriteString(" [")
			b.WriteString(parseErr.Error())
			b.WriteString("]")
		} else {
			b.WriteString(parseErr.Error())
		}
	}
	if transportErr != nil {
		if b.Len() > 0 {
			b.WriteString("; then: ")
		}
		b.WriteString(transportErr.Error())
	}
	return b.String()
}
