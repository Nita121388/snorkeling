// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 服务端活锚点推导。
//
// 为什么需要：AI 生成批注（AnnotationReplace）和早期手工批注只带 anchor_key，
// 不带 seq/hash，落库后 seq 恒为 0。前端跳转用的是「消息 seq → 行号」映射，
// 于是时间线圆点存在、点下去却什么都不发生。这里把「会话当前的消息/工具行」
// 反推成锚点列表（anchorKey → seq / role / hash），让服务端在写库时就能补上
// 真实 seq，而不是靠前端传回来。

package aisessions

import (
	"context"
	"fmt"
	"strings"
)

// AnnotationAnchorPreviewChars 是锚点原文预览的最大长度（卡片悬浮时展示）。
const AnnotationAnchorPreviewChars = 200

// BuildAnnotationAnchors 从会话当前消息 + 工具调用推导活锚点。
//
// 同一 anchorKey 消息优先于工具调用：
//  - pi / subagent fold 等 provider 会为工具行额外产出「锚点消息」，
//    它的 seq 才是时间线真实行号；
//  - ToolCall.Seq 只是单次 LoadTools 内的顺序计数（1..N），
//    绝不能当批注 seq 写库，否则跳转会指到完全无关的消息上。
//
// 找不到对应消息行的工具锚点直接丢弃：宁可让旧批注保持 orphaned，
// 也不写一个错的 seq。
func BuildAnnotationAnchors(messages []Message, toolCalls []ToolCall) []AnnotationAnchor {
	anchors := make([]AnnotationAnchor, 0, len(messages))
	seen := make(map[string]bool, len(messages))
	toolByKey := make(map[string]ToolCall, len(toolCalls))
	for _, toolCall := range toolCalls {
		key := strings.TrimSpace(toolCall.ItemKey)
		if key == "" {
			continue
		}
		toolByKey[key] = toolCall
	}

	for _, message := range messages {
		key := strings.TrimSpace(message.ItemKey)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		anchor := AnnotationAnchor{
			AnchorKey: key,
			Seq:       message.Seq,
			Role:      message.Role,
			Hash:      AnchorHash(annotationAnchorHashText(message)),
		}
		// 工具行的锚点消息：seq 取消息（真实行号），role/hash 取工具语义，
		// 与前端 authoreHash(name + summary) 保持一致。
		if toolCall, ok := toolByKey[key]; ok {
			anchor.Role = "tool"
			anchor.Hash = AnchorHash(annotationToolAnchorText(toolCall))
		}
		anchors = append(anchors, anchor)
	}

	return anchors
}

// AnnotationAnchorTextByKey 返回 anchorKey → 锚点原文（截断），用于写 anchor_preview。
// 只覆盖消息锚点；工具锚点的原文由 annotationToolAnchorText 生成。
func AnnotationAnchorTextByKey(messages []Message, toolCalls []ToolCall) map[string]string {
	texts := make(map[string]string, len(messages))
	toolByKey := make(map[string]ToolCall, len(toolCalls))
	for _, toolCall := range toolCalls {
		if key := strings.TrimSpace(toolCall.ItemKey); key != "" {
			toolByKey[key] = toolCall
		}
	}
	for _, message := range messages {
		key := strings.TrimSpace(message.ItemKey)
		if key == "" {
			continue
		}
		if _, ok := texts[key]; ok {
			continue
		}
		if toolCall, ok := toolByKey[key]; ok {
			texts[key] = truncateAnnotationText(annotationToolAnchorText(toolCall), AnnotationAnchorPreviewChars)
			continue
		}
		texts[key] = truncateAnnotationText(annotationAnchorHashText(message), AnnotationAnchorPreviewChars)
	}
	return texts
}

// ResolveAnnotationAnchorTarget turns a write request anchor ("tail" or an
// exact itemKey) into a live anchor plus its preview text.
//
// "tail" means the last anchorable message of the session. An unknown itemKey
// is refused with ErrAnnotationAnchorNotFound: a hallucinated key must never
// reach storage.
func ResolveAnnotationAnchorTarget(messages []Message, toolCalls []ToolCall, anchor string) (AnnotationAnchor, string, error) {
	anchor = strings.TrimSpace(anchor)
	anchors := BuildAnnotationAnchors(messages, toolCalls)
	previews := AnnotationAnchorTextByKey(messages, toolCalls)
	if strings.EqualFold(anchor, "tail") {
		if len(anchors) == 0 {
			return AnnotationAnchor{}, "", fmt.Errorf("%w: session has no anchorable messages", ErrAnnotationAnchorNotFound)
		}
		chosen := anchors[len(anchors)-1]
		return chosen, previews[chosen.AnchorKey], nil
	}
	if anchor == "" {
		return AnnotationAnchor{}, "", fmt.Errorf("%w: empty anchor", ErrAnnotationAnchorNotFound)
	}
	for _, candidate := range anchors {
		if candidate.AnchorKey == anchor {
			return candidate, previews[candidate.AnchorKey], nil
		}
	}
	return AnnotationAnchor{}, "", fmt.Errorf("%w: %q", ErrAnnotationAnchorNotFound, anchor)
}

// LoadAnnotationDetail loads a session detail and guarantees annotation anchors
// are available.
//
// 坑：会话消息是从 SQLite 缓存的（ai_session_messages 没有 item_key 列），缓存命中时
// Message.ItemKey 恒为空 —— 于是 BuildAnnotationAnchors 返回 0 条，写库时 seq 只能是 0。
// 这里在「锚点为空」时用 Refresh 重解析一次会话文件（单会话解析，代价可接受）。
func LoadAnnotationDetail(ctx context.Context, manager *Manager, sessionKey string) (SessionDetail, error) {
	detail, err := manager.Load(ctx, sessionKey, LoadOptions{IncludeTools: true})
	if err != nil {
		return detail, err
	}
	if len(BuildAnnotationAnchors(detail.Messages, detail.ToolCalls)) > 0 {
		return detail, nil
	}
	refreshed, refreshErr := manager.Load(ctx, sessionKey, LoadOptions{IncludeTools: true, Refresh: true})
	if refreshErr != nil {
		return detail, nil
	}
	return refreshed, nil
}

// ResolveAnnotationRowAnchors 按 anchorKey 给待写库的批注行补齐 seq / hash / preview。
// 返回的行是入参的副本语义（直接改写传入的 slice 元素）。
func ResolveAnnotationRowAnchors(rows []AnnotationRow, anchors []AnnotationAnchor, previews map[string]string) {
	if len(rows) == 0 {
		return
	}
	byKey := make(map[string]AnnotationAnchor, len(anchors))
	for _, anchor := range anchors {
		key := strings.TrimSpace(anchor.AnchorKey)
		if key == "" {
			continue
		}
		if _, ok := byKey[key]; ok {
			continue
		}
		byKey[key] = anchor
	}
	for i := range rows {
		key := strings.TrimSpace(rows[i].AnchorKey)
		anchor, ok := byKey[key]
		if !ok {
			continue
		}
		rows[i].Seq = anchor.Seq
		if rows[i].AnchorHash == "" {
			rows[i].AnchorHash = anchor.Hash
		}
		if rows[i].AnchorPreview == "" {
			rows[i].AnchorPreview = previews[key]
		}
	}
}

func annotationAnchorHashText(message Message) string {
	if text := strings.TrimSpace(message.Text); text != "" {
		return text
	}
	return message.Thinking
}

func annotationToolAnchorText(toolCall ToolCall) string {
	return strings.TrimSpace(strings.Join([]string{toolCall.Name, toolCall.Summary}, "\n"))
}
