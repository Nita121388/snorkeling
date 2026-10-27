// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"sort"
	"strings"
)

// 筛选结果的父子上下文补带（请求期派生，不落库）。
//
// 列表/搜索只返回「自身命中」的行，于是前端建树时：
//   - 命中子代理 → 父不在结果集 → 子行被提升成顶层孤儿，看不出是谁派发的；
//   - 命中父代理 → 它的子代理一个都看不到，`+N` 徽标与真实子数脱节。
//
// attachContext 在 limit 截断之后补两类上下文行：
//   - Attached="parent"：命中子会话的直接父（每个命中子最多 1 条）；
//   - Attached="child" ：命中父会话的直接子代理 / fork（每父最多 50 条）。
//
// 三条硬边界：
//  1. 只补 1 层。pi 磁盘结构上父链只有一层，子代理内部再派发是另一条独立父链。
//  2. 排除侧永远优先。excludeProjects / excludeTags 命中的行即使能补也不补，
//     否则用户明确排除的东西会偷偷回到列表里。
//  3. limit 只裁命中集。上下文行不占分页额度，否则一个父带 107 个子代理就会
//     把真正的搜索结果挤掉（本机实测单父最多 107 个子会话）。
const (
	AttachModeOff      = "off"
	AttachModeParent   = "parent"
	AttachModeChildren = "children"
	AttachModeBoth     = "both"

	// AttachedReasonParent / AttachedReasonChild 是 SessionSummary.Attached 的取值。
	AttachedReasonParent = "parent"
	AttachedReasonChild  = "child"

	defaultAttachMaxRows    = 500
	attachMaxChildrenPerHit = 50
)

// normalizeAttachMode 把外部字符串收敛成四种规范取值；未知值一律 off（保持旧行为）。
func normalizeAttachMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case AttachModeBoth:
		return AttachModeBoth
	case AttachModeParent:
		return AttachModeParent
	case AttachModeChildren:
		return AttachModeChildren
	default:
		return AttachModeOff
	}
}

func attachModeHasParent(mode string) bool {
	return mode == AttachModeBoth || mode == AttachModeParent
}

func attachModeHasChildren(mode string) bool {
	return mode == AttachModeBoth || mode == AttachModeChildren
}

// attachContextExcluding 是 attachContext 的完整版：把额外命中的上下文行数量
// 通过返回值报告给调用方（用于响应里的「已截断」提示）。
//
// applyMeta 可为 nil；非 nil 时只对被补带的行调用一次，用来补齐 note/tags
// （全量扫描路径的 summaries 还没有应用 meta，而 excludeTags 判定需要 tags）。
func attachContextExcluding(
	ctx context.Context,
	rows []SessionSummary,
	allRows []SessionSummary,
	opts ListOptions,
	applyMeta func(*SessionSummary) error,
) ([]SessionSummary, bool) {
	mode := normalizeAttachMode(opts.AttachMode)
	if mode == AttachModeOff || len(rows) == 0 {
		return rows, false
	}

	excludes := normalizeProjectFilters(opts.ExcludeProjects)
	excludeTags := opts.ExcludeTags
	maxRows := opts.AttachMaxRows
	if maxRows <= 0 {
		maxRows = defaultAttachMaxRows
	}

	present := make(map[string]bool, len(rows)+16)
	for i := range rows {
		present[rows[i].Key] = true
		// 命中行永远不被标记为上下文。
		rows[i].Attached = ""
	}

	allByKey := make(map[string]int, len(allRows))
	if allRows == nil {
		allRows = rows
	}
	for i := range allRows {
		allByKey[allRows[i].Key] = i
	}

	// eligible 判断一个候选是否允许被补带进来。
	eligible := func(cand SessionSummary) bool {
		if cand.Missing || present[cand.Key] {
			return false
		}
		if projectPathExcluded(cand.ProjectPath, excludes) {
			return false
		}
		if sessionTagsExcludeAny(cand.Tags, excludeTags) {
			return false
		}
		return true
	}

	var attached []SessionSummary

	// --- 上行：命中子会话 → 补它缺失的直接父 ---
	if attachModeHasParent(mode) {
		for i := range rows {
			if ctx.Err() != nil {
				break
			}
			parentKey := strings.TrimSpace(rows[i].ParentKey)
			if parentKey == "" || parentKey == rows[i].Key || present[parentKey] {
				continue
			}
			idx, ok := allByKey[parentKey]
			if !ok {
				continue
			}
			cand := allRows[idx]
			if !eligible(cand) {
				continue
			}
			cand.Attached = AttachedReasonParent
			if applyMeta != nil {
				_ = applyMeta(&cand)
			}
			present[cand.Key] = true
			attached = append(attached, cand)
		}
	}

	// --- 下行：命中父会话 → 带出它的直接子代理 / fork ---
	if attachModeHasChildren(mode) {
		childrenByParent := make(map[string][]int, 16)
		for i := range allRows {
			cand := allRows[i]
			parentKey := strings.TrimSpace(cand.ParentKey)
			if parentKey == "" || parentKey == cand.Key {
				continue
			}
			if cand.Kind != SessionKindSubagent && cand.Kind != SessionKindFork {
				continue
			}
			childrenByParent[parentKey] = append(childrenByParent[parentKey], i)
		}
		for i := range rows {
			if ctx.Err() != nil {
				break
			}
			// 只给「自身命中」的父带子：被补带回来的父若再带子，会把一批
			// 与搜索词无关的兄弟代理一起拉进列表，噪音远大于收益。
			if rows[i].Attached != "" {
				continue
			}
			indexes := childrenByParent[rows[i].Key]
			if len(indexes) == 0 {
				continue
			}
			sort.SliceStable(indexes, func(a, b int) bool {
				return summarySortTime(allRows[indexes[a]]) > summarySortTime(allRows[indexes[b]])
			})
			taken := 0
			for _, childIdx := range indexes {
				if taken >= attachMaxChildrenPerHit {
					break
				}
				cand := allRows[childIdx]
				if !eligible(cand) {
					continue
				}
				cand.Attached = AttachedReasonChild
				if applyMeta != nil {
					_ = applyMeta(&cand)
				}
				present[cand.Key] = true
				attached = append(attached, cand)
				taken++
			}
		}
	}

	if len(attached) == 0 {
		return rows, false
	}
	sortSummaries(attached)
	truncated := false
	if len(attached) > maxRows {
		attached = attached[:maxRows]
		truncated = true
	}
	out := make([]SessionSummary, 0, len(rows)+len(attached))
	out = append(out, rows...)
	out = append(out, attached...)
	return out, truncated
}

// attachContext 是不关心截断标记的简化入口。
func attachContext(ctx context.Context, rows []SessionSummary, allRows []SessionSummary, opts ListOptions) []SessionSummary {
	out, _ := attachContextExcluding(ctx, rows, allRows, opts, nil)
	return out
}
