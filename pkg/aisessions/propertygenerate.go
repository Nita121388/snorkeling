// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

// AI 属性提取（P2）。
//
// 安全契约（重要）：
//   - 只产出「自定义属性」。内置键（note / tags / starred / title_source /
//     created_at / updated_at）一律拒绝，AI 永远碰不到历史 note / tags。
//   - 已存在且 source=user 的属性默认不覆盖；只有 Force（显式用户确认）才允许。
//   - 生成（Generate）只返回提案，不写库；写入走 ApplyAIProperties。
//   - 值必须通过类型白名单与形状校验，非法项直接丢弃，不做猜测性写入。

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// PropertySuggestion is one AI-proposed custom property. It is always a
// proposal: nothing is persisted until the caller applies it.
type PropertySuggestion struct {
	Key        string  `json:"key"`
	Name       string  `json:"name,omitempty"`
	Type       string  `json:"type"`
	Value      any     `json:"value"`
	Confidence float64 `json:"confidence,omitempty"`
}

// PropertyGenerateRequest carries the session content a property extractor
// should read. Existing props are supplied so the model can avoid duplicates.
type PropertyGenerateRequest struct {
	SessionKey    string
	Source        string
	ProjectPath   string
	Messages      []Message
	ExistingProps map[string]PropertyCell
	AIMode        string
	PromptConfig  wconfig.AIPromptConfigType
}

// reservedPropertyKeys are owned by the legacy columns / virtual mapping and
// must never be written through the AI property path.
var reservedPropertyKeys = map[string]struct{}{
	"note":         {},
	"tags":         {},
	"starred":      {},
	"title_source": {},
	"created_at":   {},
	"updated_at":   {},
}

// PropertyTypes lists the custom property types the AI may produce. Formula /
// relation / created_time / updated_time are derived and not AI-writable.
var propertyTypeWhitelist = map[string]struct{}{
	"text":         {},
	"number":       {},
	"select":       {},
	"multi_select": {},
	"status":       {},
	"date":         {},
	"checkbox":     {},
	"url":          {},
}

// NormalizePropertyKey turns a model/user supplied key into a stable snake_case
// id. Returns "" when nothing usable remains.
func NormalizePropertyKey(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	var b strings.Builder
	lastUnderscore := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case r == '_' || r == '-' || r == ' ' || r == '.' || r == '/':
			if b.Len() > 0 && !lastUnderscore {
				b.WriteByte('_')
				lastUnderscore = true
			}
		default:
			// 非 ASCII / 标点一律丢弃，保证 key 可安全落库与比较。
		}
	}
	return strings.Trim(b.String(), "_")
}

// ValidPropertyType reports whether a type is AI-writable.
func ValidPropertyType(t string) bool {
	_, ok := propertyTypeWhitelist[t]
	return ok
}

func valueToFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// ValidatePropertyValue coerces/validates a value for a given type. Returning
// ok=false means the proposal must be dropped (never guessed into storage).
func ValidatePropertyValue(propType string, value any) (any, bool) {
	switch propType {
	case "text", "url", "select", "status":
		s, ok := value.(string)
		if !ok {
			return nil, false
		}
		s = strings.TrimSpace(s)
		if s == "" {
			return nil, false
		}
		return s, true
	case "number", "date":
		f, ok := valueToFloat(value)
		if !ok {
			return nil, false
		}
		return f, true
	case "checkbox":
		b, ok := value.(bool)
		if !ok {
			return nil, false
		}
		return b, true
	case "multi_select":
		arr, ok := value.([]any)
		if !ok {
			// 也接受 []string（来自已类型化的调用方）
			if ss, ok2 := value.([]string); ok2 {
				arr = make([]any, 0, len(ss))
				for _, s := range ss {
					arr = append(arr, s)
				}
			} else {
				return nil, false
			}
		}
		out := make([]string, 0, len(arr))
		seen := map[string]struct{}{}
		for _, item := range arr {
			s, ok := item.(string)
			if !ok {
				continue
			}
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if _, dup := seen[s]; dup {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
		if len(out) == 0 {
			return nil, false
		}
		return out, true
	default:
		return nil, false
	}
}

func inferPropertyTypeFromValue(value any) string {
	switch v := value.(type) {
	case bool:
		return "checkbox"
	case float64, float32, int, int64, json.Number:
		return "number"
	case []any, []string:
		return "multi_select"
	case string:
		if strings.HasPrefix(strings.TrimSpace(v), "http://") || strings.HasPrefix(strings.TrimSpace(v), "https://") {
			return "url"
		}
		return "text"
	default:
		return ""
	}
}

// GenerateSessionProperties runs the AI property extraction and returns
// proposals only. It never writes storage.
func GenerateSessionProperties(ctx context.Context, req PropertyGenerateRequest) ([]PropertySuggestion, error) {
	mode := ResolveAIMode(promptConfigWithFallbackMode(req.PromptConfig, req.AIMode))
	opts, err := aiusechat.GetAIOptsForMode(mode, 1024)
	if err != nil {
		return nil, fmt.Errorf("resolving AI property model: %w", err)
	}
	prompt := ResolvePrompt(PromptFeatureSessionProperties, req.PromptConfig)
	reply, err := aiusechat.RunCompletion(ctx, *opts, prompt, buildPropertyUserPrompt(req))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(reply) == "" {
		return nil, fmt.Errorf("AI property generation returned an empty response")
	}
	return parsePropertySuggestions(reply, req.ExistingProps, ClampPropertyCount(req.PromptConfig.MaxProperties))
}

func buildPropertyUserPrompt(req PropertyGenerateRequest) string {
	var b strings.Builder
	b.WriteString("Existing properties (do not duplicate these keys):\n")
	if len(req.ExistingProps) == 0 {
		b.WriteString("(none)")
	} else {
		first := true
		for key, cell := range req.ExistingProps {
			if _, reserved := reservedPropertyKeys[key]; reserved {
				continue
			}
			if !first {
				b.WriteString(", ")
			}
			first = false
			b.WriteString(key)
			if cell.Type != "" {
				b.WriteString(":")
				b.WriteString(cell.Type)
			}
		}
		if first {
			b.WriteString("(none)")
		}
	}
	b.WriteString("\n\nProject path:\n")
	writeOptionalLine(&b, req.ProjectPath)
	b.WriteString("\n\nSession source:\n")
	writeOptionalLine(&b, req.Source)
	b.WriteString("\n\nSession transcript:\n")
	writeSessionTranscript(&b, req.Messages)
	return b.String()
}

// parsePropertySuggestions validates the model reply against the whitelist and
// the existing property set. Invalid / reserved / user-owned entries are
// dropped rather than guessed.
func parsePropertySuggestions(text string, existing map[string]PropertyCell, max int) ([]PropertySuggestion, error) {
	s := strings.TrimSpace(text)
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		s = strings.TrimSpace(strings.TrimSuffix(s, "```"))
	}
	var payload struct {
		Properties []PropertySuggestion `json:"properties"`
	}
	if err := json.Unmarshal([]byte(s), &payload); err != nil || payload.Properties == nil {
		// tolerate a bare array reply
		var arr []PropertySuggestion
		if err2 := json.Unmarshal([]byte(s), &arr); err2 != nil {
			if err != nil {
				return nil, fmt.Errorf("AI property response was not valid JSON: %w", err)
			}
			return nil, fmt.Errorf("AI property response carried no properties array")
		}
		payload.Properties = arr
	}
	if max <= 0 || max > 20 {
		max = DefaultMaxProperties
	}
	out := make([]PropertySuggestion, 0, len(payload.Properties))
	seen := map[string]struct{}{}
	for _, item := range payload.Properties {
		key := NormalizePropertyKey(item.Key)
		if key == "" {
			continue
		}
		if _, reserved := reservedPropertyKeys[key]; reserved {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		propType := strings.TrimSpace(item.Type)
		if !ValidPropertyType(propType) {
			propType = inferPropertyTypeFromValue(item.Value)
		}
		if !ValidPropertyType(propType) {
			continue
		}
		if old, ok := existing[key]; ok && old.Source == PropertySourceUser {
			// 用户手工值：提案阶段就过滤掉，避免 UI 误引导覆盖。
			continue
		}
		value, ok := ValidatePropertyValue(propType, item.Value)
		if !ok {
			continue
		}
		confidence := item.Confidence
		if confidence < 0 || confidence > 1 {
			confidence = 0
		}
		seen[key] = struct{}{}
		out = append(out, PropertySuggestion{
			Key:        key,
			Name:       strings.TrimSpace(item.Name),
			Type:       propType,
			Value:      value,
			Confidence: confidence,
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}
