// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"sort"
	"strconv"
	"strings"
)

// 子代理折叠（数据层）。
//
// 父会话 JSONL 里派发子代理就是一次普通 tool call（toolName == "subagent"），
// arguments 里带 agent 与 task。子代理是独立进程、独立 JSONL 文件，磁盘上
// **没有**父子映射，所以只能靠「同 cwd + session_info.name 以 agent 名开头 +
// 创建时间落在调用时间窗口内」去匹配。
//
// 本文件只做只读提取与匹配，不改动 pi-subagents 扩展，也不改父会话解析结果。

// SubagentCall 是父会话里一次 subagent 派发。
type SubagentCall struct {
	EntryID   string `json:"entryId,omitempty"`
	ItemKey   string `json:"itemKey,omitempty"`
	Agent     string `json:"agent"`
	Task      string `json:"task,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
}

// SubagentCandidate 是磁盘上一个可能属于该次派发的子会话。
type SubagentCandidate struct {
	SessionKey string `json:"sessionKey"`
	SessionID  string `json:"sessionId,omitempty"`
	Name       string `json:"name,omitempty"`
	CreatedAt  int64  `json:"createdAt,omitempty"`
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
	Call       SubagentCall       `json:"call"`
	Status     SubagentMatchStatus `json:"status"`
	SessionKey string             `json:"sessionKey,omitempty"`
	Candidates []SubagentCandidate `json:"candidates,omitempty"`
}

// 默认时间窗口：子会话应在调用之后不久创建。允许一点前向偏差（时钟漂移 / 先建后派）。
const (
	subagentMatchLeadSkewMS  int64 = 5 * 60 * 1000       // 允许早于调用 5 分钟
	subagentMatchTrailSkewMS int64 = 6 * 60 * 60 * 1000  // 允许晚于调用 6 小时
)

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

// matchSubagentCalls 把每次派发匹配到至多一个子会话候选。纯函数，便于单测。
//
// 约束：
//   - 只有名称 + 时间都命中的候选才参与匹配；
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
			if !subagentNameMatches(cand.Name, call.Agent) {
				continue
			}
			if !subagentTimeWithinWindow(cand.CreatedAt, call.Timestamp) {
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

// MatchSubagentSessions 是 matchSubagentCalls 的导出包装。
func MatchSubagentSessions(calls []SubagentCall, candidates []SubagentCandidate) []SubagentMatch {
	return matchSubagentCalls(calls, candidates)
}

// ExtractSubagentCalls 从 pi 会话 JSONL 中提取所有 subagent 派发（只读）。
// 解析失败的行会跳过，不影响其余匹配；文件不存在时返回空切片与错误。
func ExtractSubagentCalls(ctx context.Context, filePath string) ([]SubagentCall, error) {
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
		if normalizeRole(strValue(msgMap, "role")) != RoleAssistant {
			continue
		}
		at := parseTimestampToMS(value["timestamp"])
		if at == 0 {
			at = parseTimestampToMS(msgMap["timestamp"])
		}
		for _, call := range subagentCallsInContent(msgMap["content"], entryID, at) {
			calls = append(calls, call)
		}
	}
	if err := scanner.Err(); err != nil {
		return calls, err
	}
	return calls, nil
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
		if !strings.EqualFold(strValue(itemMap, "name"), "subagent") {
			continue
		}
		args, _ := itemMap["arguments"].(map[string]any)
		if args == nil {
			// 有些 provider 把 arguments 序列化成字符串。
			if raw := strValue(itemMap, "arguments"); raw != "" {
				var parsed map[string]any
				if json.Unmarshal([]byte(raw), &parsed) == nil {
					args = parsed
				}
			}
		}
		agent := strValue(args, "agent")
		if agent == "" {
			continue
		}
		calls = append(calls, SubagentCall{
			EntryID:   entryID,
			ItemKey:   itemKey,
			Agent:     agent,
			Task:      strValue(args, "task"),
			Timestamp: at,
		})
	}
	return calls
}
