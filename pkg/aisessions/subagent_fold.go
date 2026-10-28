// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// 子代理折叠（数据层）。
//
// 父会话 JSONL 里派发子代理就是一次普通 tool call（toolName == "subagent"），
// arguments 里带 agent 与 task。子代理是独立进程、独立 JSONL 文件，磁盘上
// **没有**父子映射文件。
//
// 匹配分两档，可靠性从高到低：
//
//  1. run id（首选）。pi-subagents 给每次派发一个 run id，`subagent` 工具的
//     toolResult 里写着 `Async: <agent> [<runid>]`；子会话的 session_info.name
//     形如 `subagent-<agent>-<runid>-<n>`。两边同源，是唯一键。
//  2. 名称 + 时间窗（兜底）。同 cwd + session_info.name 以 agent 名开头 +
//     创建时间落在调用时间窗口内。没有 run id 的历史数据才走这条。
//
// 时间窗不能当身份用：实测一个父会话挂 84 个子会话、相邻只差 5~30 分钟，而窗口
// 宽达 6 小时，纯时间窗匹配会产生大量 ambiguous。
//
// 本文件只做只读提取与匹配，不改动 pi-subagents 扩展，也不改父会话解析结果。

// SubagentCall 是父会话里一次 subagent 派发。
type SubagentCall struct {
	EntryID   string `json:"entryId,omitempty"`
	ItemKey   string `json:"itemKey,omitempty"`
	Agent     string `json:"agent"`
	Task      string `json:"task,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	// RunID is the pi-subagents run id, recovered from the tool result text
	// (`Async: <agent> [<runid>]`). Empty when the dispatch did not report one
	// (synchronous runs, older versions), which falls back to name/time matching.
	RunID string `json:"runId,omitempty"`
	// ToolCallID is the tool call id that pairs this dispatch with its result
	// entry. Internal only: it is how the run id is filled in after the scan.
	ToolCallID string `json:"-"`
}

// SubagentCandidate 是磁盘上一个可能属于该次派发的子会话。
type SubagentCandidate struct {
	SessionKey string `json:"sessionKey"`
	SessionID  string `json:"sessionId,omitempty"`
	Name       string `json:"name,omitempty"`
	CreatedAt  int64  `json:"createdAt,omitempty"`
	// UpdatedAt is the child session's last-updated time (UnixMilli).
	UpdatedAt  int64  `json:"updatedAt,omitempty"`
	// ParentKey 非空表示这个候选是通过磁盘目录结构判定为「父会话的子会话」，
	// 比 agent 名匹配可靠：子会话文件没有 session_info.name。
	ParentKey string `json:"parentKey,omitempty"`
	// Kind 是 session / subagent / fork。只有 subagent 是派发产生的，
	// fork 是用户主动分叉，不应当作某次派发的目标。
	Kind string `json:"kind,omitempty"`
	// RunID is the run id parsed out of the child's session_info.name
	// (`subagent-<agent>-<runid>-<n>`). Empty for real user forks and for any
	// session whose name does not carry one.
	RunID string `json:"runId,omitempty"`
}

// SubagentMatchStatus 表示一次派发的匹配结果。
type SubagentMatchStatus string

const (
	// SubagentMatchMatched 唯一匹配到一个子会话。
	SubagentMatchMatched SubagentMatchStatus = "matched"
	// SubagentMatchAmbiguous 命中多个候选，PRD 要求不得猜测，交给 UI 呈现。
	SubagentMatchAmbiguous SubagentMatchStatus = "ambiguous"
	// SubagentMatchMissing 没有候选，优雅降级为普通工具卡片。
	SubagentMatchMissing SubagentMatchStatus = "missing"
)

// SubagentMatch 是「一次派发 → 匹配结果」。
type SubagentMatch struct {
	Call       SubagentCall        `json:"call"`
	Status     SubagentMatchStatus `json:"status"`
	SessionKey string              `json:"sessionKey,omitempty"`
	// UpdatedAt is the matched child session's last-updated time (UnixMilli).
	// Used by the UI to show a folded subagent's total duration without
	// loading the child session: UpdatedAt - Call.Timestamp.
	UpdatedAt  int64               `json:"updatedAt,omitempty"`
	Candidates []SubagentCandidate `json:"candidates,omitempty"`
}

// 默认时间窗口：子会话应在调用之后不久创建。允许一点前向偏差（时钟漂移 / 先建后派）。
const (
	subagentMatchLeadSkewMS  int64 = 5 * 60 * 1000      // 允许早于调用 5 分钟
	subagentMatchTrailSkewMS int64 = 6 * 60 * 60 * 1000 // 允许晚于调用 6 小时
)

// normalizeProjectPath 统一大小写与分隔符，用于比较两个会话是否在同一个 cwd。
func normalizeProjectPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ReplaceAll(trimmed, "\\", "/")
	trimmed = strings.TrimRight(trimmed, "/")
	return strings.ToLower(trimmed)
}

// subagentSameProjectPath 判断两个会话是否属于同一个项目目录。
func subagentSameProjectPath(left, right string) bool {
	l := normalizeProjectPath(left)
	r := normalizeProjectPath(right)
	if l == "" || r == "" {
		return false
	}
	return l == r
}

// subagentNameMatches 判断子会话名是否以 agent 名开头。
// 子会话名格式为 "agent: 任务摘要"（由 setSessionName 写入 session_info.name），
// 因此以 agent 名开头即视为名称候选。
func subagentNameMatches(name, agent string) bool {
	trimmedName := strings.TrimSpace(name)
	trimmedAgent := strings.TrimSpace(agent)
	if trimmedAgent == "" || trimmedName == "" {
		return false
	}
	return strings.HasPrefix(strings.ToLower(trimmedName), strings.ToLower(trimmedAgent))
}

// subagentTimeWithinWindow 判断子会话创建时间是否落在调用时间窗口内。
// 调用时间未知（0）时不做时间约束，退化为纯名称匹配 —— 宁可标记 ambiguous
// 由 UI 决定，也不静默丢弃可能的候选。
func subagentTimeWithinWindow(createdAt, callAt int64) bool {
	if callAt <= 0 || createdAt <= 0 {
		return true
	}
	if createdAt < callAt-subagentMatchLeadSkewMS {
		return false
	}
	return createdAt <= callAt+subagentMatchTrailSkewMS
}

// subagentCandidateEligible 判断某个候选是否够格参与这次派发的匹配。
//
// 三条路径，按可靠性从高到低：
//  1. run id 两边都有：唯一键。相等即命中，不等即排除（不再看名字/时间）。
//  2. 结构候选（ParentKey 非空且 Kind=subagent）：磁盘目录结构已经确定它属于这个
//     父会话，所以只看时间窗，不要求名字匹配。
//  3. 名称候选：老的 agent 名 + 时间窗匹配，作为兜底。
//
// fork 即使挂在父目录下也永远不是派发目标（它是用户主动分叉），直接排除。
func subagentCandidateEligible(cand SubagentCandidate, call SubagentCall) bool {
	// run id 是唯一键，先于目录结构判断：pi-subagents 的 fork-context 子代理
	// 确实落在 forks/ 目录下，靠 kind=fork 一律排除会把它们全部丢掉。
	// 用户真·分叉的 session_info.name 不带 `<agent>-<runid>-<n>` 形态，RunID
	// 为空，所以在下面仍然会被 kind=fork 排除。
	if call.RunID != "" && cand.RunID != "" {
		return call.RunID == cand.RunID
	}
	if cand.Kind == SessionKindFork {
		return false
	}
	if strings.TrimSpace(cand.ParentKey) != "" && cand.Kind == SessionKindSubagent {
		return subagentTimeWithinWindow(cand.CreatedAt, call.Timestamp)
	}
	if !subagentNameMatches(cand.Name, call.Agent) {
		return false
	}
	return subagentTimeWithinWindow(cand.CreatedAt, call.Timestamp)
}

// matchSubagentCalls 把每次派发匹配到至多一个子会话候选。纯函数，便于单测。
//
// 约束：
//   - run id 两边都有时只认 run id（唯一键）；相等命中，不等不候选；
//   - 没有 run id 时：结构候选（目录结构已知的 subagent）优先，只校验时间窗；
//     其余走名称 + 时间窗兜底；
//   - fork 永不参与匹配；
//   - 唯一命中 → matched；多个命中 → ambiguous（不猜测，列出候选）；
//   - 无命中 → missing；
//   - 已经被更早一次派发占用过的候选不会再次匹配，避免两个调用抢同一个子会话；
//   - 时间未知的调用与候选仍可匹配（宽容），但一旦产生多个候选就报 ambiguous。
func matchSubagentCalls(calls []SubagentCall, candidates []SubagentCandidate) []SubagentMatch {
	used := make(map[string]bool, len(candidates))
	matches := make([]SubagentMatch, 0, len(calls))
	for _, call := range calls {
		var hits []SubagentCandidate
		for _, cand := range candidates {
			if used[cand.SessionKey] {
				continue
			}
			if !subagentCandidateEligible(cand, call) {
				continue
			}
			hits = append(hits, cand)
		}
		switch len(hits) {
		case 0:
			matches = append(matches, SubagentMatch{Call: call, Status: SubagentMatchMissing})
		case 1:
			used[hits[0].SessionKey] = true
			matches = append(matches, SubagentMatch{
				Call:       call,
				Status:     SubagentMatchMatched,
				SessionKey: hits[0].SessionKey,
				UpdatedAt:  hits[0].UpdatedAt,
			})
		default:
			sort.SliceStable(hits, func(i, j int) bool { return hits[i].CreatedAt < hits[j].CreatedAt })
			matches = append(matches, SubagentMatch{
				Call:       call,
				Status:     SubagentMatchAmbiguous,
				Candidates: hits,
			})
		}
	}
	return matches
}

// subagentToolNameAliases 是各 provider 派发子代理时可能使用的工具名（小写比较）。
// 前端 `subagent-detect.ts` 必须保持同一套别名，否则提取到了却链接不上。
var subagentToolNameAliases = map[string]struct{}{
	"subagent":       {},
	"task":           {},
	"spawn_agent":    {},
	"spawn_subagent": {},
	"subagentstart":  {},
}

// isSubagentToolName 判断一个工具名是否代表子代理派发。
func isSubagentToolName(name string) bool {
	_, ok := subagentToolNameAliases[strings.ToLower(strings.TrimSpace(name))]
	return ok
}

// subagentArgsMap 把 tool call 的 arguments 规范成 map：既可能是对象，
// 也可能是 provider 序列化后的 JSON 字符串（codex 的 arguments 就是字符串）。
func subagentArgsMap(value any) map[string]any {
	if args, ok := value.(map[string]any); ok {
		return args
	}
	if raw, ok := value.(string); ok && strings.TrimSpace(raw) != "" {
		var parsed map[string]any
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			return parsed
		}
	}
	return nil
}

// subagentAgentFromArgs 从不同 provider 的参数命名里取 agent 名。
func subagentAgentFromArgs(args map[string]any) string {
	if args == nil {
		return ""
	}
	for _, key := range []string{"agent", "subagent_type", "agent_type"} {
		if value := strValue(args, key); value != "" {
			return value
		}
	}
	return ""
}

// subagentTaskFromArgs 从不同 provider 的参数命名里取任务描述。
func subagentTaskFromArgs(args map[string]any) string {
	if args == nil {
		return ""
	}
	for _, key := range []string{"task", "prompt", "description", "instructions"} {
		if value := strValue(args, key); value != "" {
			return value
		}
	}
	return ""
}

// MatchSubagentSessions 是 matchSubagentCalls 的导出包装。
func MatchSubagentSessions(calls []SubagentCall, candidates []SubagentCandidate) []SubagentMatch {
	return matchSubagentCalls(calls, candidates)
}

// ExtractSubagentCalls 从 pi 会话 JSONL 中提取所有 subagent 派发（只读）。
// 解析失败的行会跳过，不影响其余匹配；文件不存在时返回空切片与错误。
//
// 一次扫描同时收集两样东西：派发本身（assistant 的 toolCall）、它的 run id
// （紧随其后的 toolResult 文本里的 `Async: <agent> [<runid>]`）。两边靠
// toolCallId 关联，所以在扫描结束后再回填 RunID。
func ExtractSubagentCalls(ctx context.Context, filePath string) ([]SubagentCall, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var calls []SubagentCall
	// toolCallId -> RunID，用于回填。map 只存已出现的派发，规模与派发次数同阶。
	runIDByCallID := make(map[string]string)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return calls, ctx.Err()
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
		entryID := strValue(value, "id")
		msgMap := piMsgMap(value)
		switch normalizeRole(strValue(msgMap, "role")) {
		case RoleTool:
			if !strings.EqualFold(strValue(msgMap, "toolName"), "subagent") {
				continue
			}
			callID := strValue(msgMap, "toolCallId")
			if callID == "" {
				continue
			}
			if runID := parseSubagentRunID(subagentResultText(msgMap["content"])); runID != "" {
				runIDByCallID[callID] = runID
			}
		case RoleAssistant:
			at := parseTimestampToMS(value["timestamp"])
			if at == 0 {
				at = parseTimestampToMS(msgMap["timestamp"])
			}
			for _, call := range subagentCallsInContent(msgMap["content"], entryID, at) {
				calls = append(calls, call)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return calls, err
	}
	for i := range calls {
		if runID, ok := runIDByCallID[calls[i].ToolCallID]; ok {
			calls[i].RunID = runID
		}
	}
	return calls, nil
}

// subagentResultText 把一个 toolResult 的 content 拼成纯文本。
func subagentResultText(content any) string {
	items, ok := content.([]any)
	if !ok {
		if text, ok := content.(string); ok {
			return text
		}
		return ""
	}
	var builder strings.Builder
	for _, item := range items {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if !strings.EqualFold(strValue(itemMap, "type"), "text") {
			continue
		}
		if text := strValue(itemMap, "text"); text != "" {
			if builder.Len() > 0 {
				builder.WriteByte('\n')
			}
			builder.WriteString(text)
		}
	}
	return builder.String()
}

// subagentRunIDPattern 匹配 pi-subagents 的回执行：`Async: worker [95145195-...]`。
var subagentRunIDPattern = regexp.MustCompile(`Async:\s*[\w.\-]+\s*\[([0-9a-fA-F-]{36})\]`)

// parseSubagentRunID 从派发回执文本里取 run id；取不到时返回空串。
func parseSubagentRunID(text string) string {
	if text == "" {
		return ""
	}
	match := subagentRunIDPattern.FindStringSubmatch(text)
	if len(match) != 2 {
		return ""
	}
	return strings.ToLower(match[1])
}

// subagentCallsInContent 扫描 assistant 消息内容，挑出 subagent tool call。
// 支持真实的 camelCase "toolCall" 与旧 fixture 的 "toolcall"。
func subagentCallsInContent(content any, entryID string, at int64) []SubagentCall {
	arr, ok := content.([]any)
	if !ok {
		return nil
	}
	var calls []SubagentCall
	toolIndex := 0
	for _, item := range arr {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if !strings.EqualFold(strValue(itemMap, "type"), "toolCall") {
			continue
		}
		// 与 piEntryMessages 一致：第 N 个 tool call 的 ItemKey 是 "<entryID>:tN"。
		itemKey := ""
		if entryID != "" {
			itemKey = entryID + ":t" + strconv.Itoa(toolIndex)
		}
		toolIndex++
		if !isSubagentToolName(strValue(itemMap, "name")) {
			continue
		}
		args := subagentArgsMap(itemMap["arguments"])
		if args == nil {
			args = subagentArgsMap(itemMap["input"])
		}
		agent := subagentAgentFromArgs(args)
		if agent == "" {
			continue
		}
		calls = append(calls, SubagentCall{
			EntryID:    entryID,
			ItemKey:    itemKey,
			Agent:      agent,
			Task:       subagentTaskFromArgs(args),
			Timestamp:  at,
			ToolCallID: strValue(itemMap, "id"),
		})
	}
	return calls
}

// subagentNameRunIDPattern 匹配 pi-subagents 给子会话起的名字：
// `subagent-<agent>-<runid>-<n>`。agent 名可能含点/下划线，run id 是标准 UUID。
var subagentNameRunIDPattern = regexp.MustCompile(`^subagent-[\w.\-]+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-\d+$`)

// parseSubagentNameRunID 从子会话名里取 run id；不是子代理命名时返回空串。
func parseSubagentNameRunID(name string) string {
	match := subagentNameRunIDPattern.FindStringSubmatch(strings.TrimSpace(name))
	if len(match) != 2 {
		return ""
	}
	return strings.ToLower(match[1])
}

const (
	// sessionTailWindowBytes 是读文件尾部找 session_info 的窗口。
	// session_info 由 pi 写在文件末尾，而 scanTitle 只读前 1MB（titleScanMaxBytes），
	// 十几 MB 的大会话因此永远读不到名字。这里从尾部 seek，成本是常数级。
	sessionTailWindowBytes int64 = 64 * 1024
	// sessionTailWindowMax 是逐次放大的上限：一次派发可能写很多行 session_info，
	// 极端情况下 64KB 里找不到，就放大重试，但不超过这个上限。
	sessionTailWindowMax int64 = 1024 * 1024
)

// readSessionNameFromTail 从会话文件尾部读出最新的 session_info.name。
//
// 为什么要单独读：标题扫描（scanTitle）有 1MB 上限，而 session_info 在文件末尾，
// 大文件的标题因此恒为空。这里绕开标题扫描，只在折叠需要时才付这份 IO。
// 返回空串表示没有名字（不是错误）。
func readSessionNameFromTail(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return ""
	}
	size := info.Size()
	window := sessionTailWindowBytes
	for {
		if window > size {
			window = size
		}
		offset := size - window
		buf := make([]byte, window)
		if _, err := file.ReadAt(buf, offset); err != nil && !errors.Is(err, io.EOF) {
			return ""
		}
		// 窗口不是从行首开始时会截断第一行，丢弃它（除非窗口就是整个文件）。
		if offset > 0 {
			if index := strings.IndexByte(string(buf), '\n'); index >= 0 {
				buf = buf[index+1:]
			} else {
				buf = nil
			}
		}
		if name := latestSessionInfoName(buf); name != "" {
			return name
		}
		if window >= size || window >= sessionTailWindowMax {
			return ""
		}
		window *= 4
	}
}

// latestSessionInfoName 从一段 JSONL 文本里取最后一条 session_info 的 name。
// 只接受能完整解析的行：窗口头部被截断的半行会被 json 解析失败跳过。
func latestSessionInfoName(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	lines := strings.Split(string(data), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			continue
		}
		if strValue(value, "type") != "session_info" {
			continue
		}
		if name := strings.TrimSpace(strValue(value, "name")); name != "" {
			return name
		}
	}
	return ""
}

// extractSubagentCallsForSource 按 provider 选择子代理调用提取器。
//
// 父会话 JSONL 的格式随 provider 不同：pi 是 {type:"message", message:{...}}，
// claude 是 {type:"assistant", message:{content:[tool_use]}}，codex 是
// {type:"response_item", payload:{type:"function_call"}}。opencode 存在 SQLite，
// 没有可扫描的 JSONL，返回空 —— 前端会以 missing 合成卡兜底显示派发本身。
func extractSubagentCallsForSource(ctx context.Context, source, filePath string) ([]SubagentCall, error) {
	switch source {
	case SourceClaude:
		return extractClaudeSubagentCalls(ctx, filePath)
	case SourceCodex:
		return extractCodexSubagentCalls(ctx, filePath)
	case SourceOpenCode:
		return nil, nil
	default:
		return ExtractSubagentCalls(ctx, filePath)
	}
}

// extractClaudeSubagentCalls 从 Claude Code JSONL 提取派发。
// 子代理工具通常是 `Task`，参数在 message.content[].input。
func extractClaudeSubagentCalls(ctx context.Context, filePath string) ([]SubagentCall, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var calls []SubagentCall
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return calls, ctx.Err()
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
		at := parseTimestampToMS(value["timestamp"])
		if at == 0 {
			at = parseTimestampToMS(message["timestamp"])
		}
		entryID := strValue(value, "uuid")
		if entryID == "" {
			entryID = strValue(message, "id")
		}
		for _, item := range contentItems {
			itemMap, _ := item.(map[string]any)
			if itemMap == nil || strValue(itemMap, "type") != "tool_use" {
				continue
			}
			if !isSubagentToolName(strValue(itemMap, "name")) {
				continue
			}
			args := subagentArgsMap(itemMap["input"])
			agent := subagentAgentFromArgs(args)
			if agent == "" {
				continue
			}
			id := strValue(itemMap, "id")
			calls = append(calls, SubagentCall{
				EntryID:    entryID,
				ItemKey:    id,
				Agent:      agent,
				Task:       subagentTaskFromArgs(args),
				Timestamp:  at,
				ToolCallID: id,
			})
		}
	}
	if err := scanner.Err(); err != nil {
		return calls, err
	}
	return calls, nil
}

// extractCodexSubagentCalls 从 Codex JSONL 提取派发。
func extractCodexSubagentCalls(ctx context.Context, filePath string) ([]SubagentCall, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var calls []SubagentCall
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return calls, ctx.Err()
		}
		var value map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			continue
		}
		if strValue(value, "type") != "response_item" {
			continue
		}
		payload, _ := value["payload"].(map[string]any)
		if payload == nil || strValue(payload, "type") != "function_call" {
			continue
		}
		if !isSubagentToolName(strValue(payload, "name")) {
			continue
		}
		args := subagentArgsMap(payload["arguments"])
		agent := subagentAgentFromArgs(args)
		if agent == "" {
			continue
		}
		callID := strValue(payload, "call_id")
		at := parseTimestampToMS(value["timestamp"])
		if at == 0 {
			at = parseTimestampToMS(payload["timestamp"])
		}
		calls = append(calls, SubagentCall{
			ItemKey:    callID,
			Agent:      agent,
			Task:       subagentTaskFromArgs(args),
			Timestamp:  at,
			ToolCallID: callID,
		})
	}
	if err := scanner.Err(); err != nil {
		return calls, err
	}
	return calls, nil
}
