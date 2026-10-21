// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"path/filepath"
	"strings"
)

// pi 会话根下的第一层是 project 目录（形如 `--D--Code-LiCASmart--`）。
// 顶层文件是父会话，落在"与父会话同名"目录里的文件是它的子会话：
//
//	<project>/<父>.jsonl                          → session（顶层）
//	<project>/<父>/forks/<x>.jsonl                → fork
//	<project>/<父>/<uuid>/run-0/session.jsonl     → subagent
//
// 子会话文件没有 session_info.name，所以父子关系只能由磁盘结构判定。
const (
	SessionKindSession  = "session"
	SessionKindSubagent = "subagent"
	SessionKindFork     = "fork"
)

// ClassifyPiSessionFile 返回该文件相对 sessionsDir 的父文件路径与类型。
// 顶层文件返回 ("", SessionKindSession)。
//
// 父文件不存在（目录残留）时也照样返回路径：调用方可以据此把孤儿行提升为顶层，
// 而不是让它从列表里消失。
func ClassifyPiSessionFile(sessionsDir string, filePath string) (string, string) {
	rel, err := filepath.Rel(sessionsDir, filePath)
	if err != nil {
		return "", SessionKindSession
	}
	rel = filepath.ToSlash(rel)
	// A path outside the sessions root cannot be classified. Treat it as a
	// top-level session instead of letting the leading "../" segments be read as
	// project/parent directories.
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", SessionKindSession
	}
	parts := strings.Split(rel, "/")
	// <project>/<file>.jsonl → 顶层
	if len(parts) <= 2 {
		return "", SessionKindSession
	}
	// <project>/<父>/... → 父文件是 <project>/<父>.jsonl
	parentDir := parts[1]
	parentPath := filepath.Join(sessionsDir, parts[0], parentDir+".jsonl")
	kind := SessionKindSubagent
	for _, part := range parts[2:] {
		if part == "forks" {
			kind = SessionKindFork
			break
		}
	}
	return parentPath, kind
}

// PiParentKey 计算父会话的 session key。
//
// pi 的 header id 与文件名末尾的 UUID 一致（实测确认），所以不需要打开父文件
// 就能算出 key，避免为了父子关系去读几 MB 的头部。
func PiParentKey(source string, sessionsDir string, filePath string) string {
	parentPath, _ := ClassifyPiSessionFile(sessionsDir, filePath)
	if parentPath == "" {
		return ""
	}
	// parentPath is <sessionsDir>/<project>/<parent>.jsonl, so the session's own
	// directory name lives in the file name, not in its parent directory.
	parentName := strings.TrimSuffix(filepath.Base(parentPath), filepath.Ext(parentPath))
	if parentName == "" || parentName == "." {
		return ""
	}
	return StableKey(source, piUUIDFromDirName(parentName), parentPath)
}

// piUUIDFromDirName 从 `<timestamp>_<uuid>` 形态的目录名里取出 uuid。
// 文件名不符合该形态时返回空串（调用方仍会带上路径，key 依旧唯一）。
func piUUIDFromDirName(dirName string) string {
	index := strings.LastIndex(dirName, "_")
	if index < 0 || index == len(dirName)-1 {
		return ""
	}
	return dirName[index+1:]
}
