// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	DefaultVcsScanDepth   = 3
	DefaultVcsStatusLimit = 200
	DefaultVcsCommitLimit = 50
	MaxVcsCommitScanLimit = 2000
	MaxVcsRepos           = 64
)

var vcsScanSkipDirNames = map[string]struct{}{
	".cache":       {},
	".next":        {},
	".turbo":       {},
	".venv":        {},
	"build":        {},
	"dist":         {},
	"node_modules": {},
	"out":          {},
	"target":       {},
	"vendor":       {},
}

var errVcsNonTextContent = errors.New("content is binary or not utf-8")

type svnInfoXML struct {
	Entries []struct {
		WcInfo struct {
			WcRootAbsPath string `xml:"wcroot-abspath"`
		} `xml:"wc-info"`
	} `xml:"entry"`
}

type svnLogXML struct {
	Entries []svnLogEntry `xml:"logentry"`
}

type svnLogEntry struct {
	Revision string `xml:"revision,attr"`
	Author   string `xml:"author"`
	Date     string `xml:"date"`
	Message  string `xml:"msg"`
}

type svnStatusXML struct {
	Targets []struct {
		Entries []svnStatusEntry `xml:"entry"`
	} `xml:"target"`
}

type svnStatusEntry struct {
	Path     string `xml:"path,attr"`
	WCStatus struct {
		Item string `xml:"item,attr"`
	} `xml:"wc-status"`
	ReposStatus struct {
		Item string `xml:"item,attr"`
	} `xml:"repos-status"`
}

type detectedRepoRoot struct {
	RepoType string
	RootPath string
}

func runVcsCommand(ctx context.Context, dir string, command string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	outStr := strings.TrimSpace(stdout.String())
	if err != nil {
		errStr := strings.TrimSpace(stderr.String())
		if errStr == "" {
			errStr = outStr
		}
		if errStr == "" {
			errStr = err.Error()
		}
		return outStr, fmt.Errorf("%s %s: %s", command, strings.Join(args, " "), errStr)
	}
	return outStr, nil
}

func runSvnStatusXMLCommand(ctx context.Context, dir string) (string, error) {
	cmd := exec.CommandContext(ctx, "svn", "status", "--xml")
	if dir != "" {
		cmd.Dir = dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	outStr := strings.TrimSpace(stdout.String())
	if err == nil {
		return outStr, nil
	}
	if outStr != "" {
		var parsed svnStatusXML
		if parseErr := xml.Unmarshal([]byte(outStr), &parsed); parseErr == nil {
			return outStr, nil
		}
	}
	errStr := strings.TrimSpace(stderr.String())
	if errStr == "" {
		errStr = outStr
	}
	if errStr == "" {
		errStr = err.Error()
	}
	return outStr, fmt.Errorf("svn status --xml: %s", errStr)
}

func runSvnRemoteStatusXMLCommand(ctx context.Context, dir string) (string, error) {
	cmd := exec.CommandContext(ctx, "svn", "status", "-u", "--xml", "--non-interactive")
	if dir != "" {
		cmd.Dir = dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	outStr := strings.TrimSpace(stdout.String())
	if err == nil {
		return outStr, nil
	}
	if outStr != "" {
		var parsed svnStatusXML
		if parseErr := xml.Unmarshal([]byte(outStr), &parsed); parseErr == nil {
			return outStr, nil
		}
	}
	errStr := strings.TrimSpace(stderr.String())
	if errStr == "" {
		errStr = outStr
	}
	if errStr == "" {
		errStr = err.Error()
	}
	return outStr, fmt.Errorf("svn status -u --xml: %s", errStr)
}

func runVcsCommandRaw(ctx context.Context, dir string, command string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	outStr := stdout.String()
	if err != nil {
		errStr := strings.TrimSpace(stderr.String())
		if errStr == "" {
			errStr = strings.TrimSpace(outStr)
		}
		if errStr == "" {
			errStr = err.Error()
		}
		return outStr, fmt.Errorf("%s %s: %s", command, strings.Join(args, " "), errStr)
	}
	return outStr, nil
}

func normalizeVcsInputPath(path string) string {
	trimmedPath := strings.TrimSpace(path)
	if !strings.HasPrefix(trimmedPath, "wsh://") {
		return trimmedPath
	}
	parsedUrl, err := url.Parse(trimmedPath)
	if err != nil || parsedUrl.Path == "" {
		return trimmedPath
	}
	parsedPath := parsedUrl.Path
	if strings.HasPrefix(parsedPath, "//") {
		return parsedPath[1:]
	}
	if strings.HasPrefix(parsedPath, "/~/") || parsedPath == "/~" {
		return parsedPath[1:]
	}
	if runtime.GOOS == "windows" && len(parsedPath) >= 3 && parsedPath[0] == '/' && parsedPath[2] == ':' {
		return parsedPath[1:]
	}
	return parsedPath
}

func normalizeVcsBasePath(path string) (string, error) {
	path = normalizeVcsInputPath(path)
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("path is required")
	}
	expandedPath, err := wavebase.ExpandHomeDir(path)
	if err != nil {
		return "", fmt.Errorf("cannot expand path %q: %w", path, err)
	}
	cleanPath := filepath.Clean(expandedPath)
	stat, statErr := os.Stat(cleanPath)
	if statErr == nil {
		if stat.IsDir() {
			return cleanPath, nil
		}
		return filepath.Dir(cleanPath), nil
	}
	parent := filepath.Dir(cleanPath)
	parentStat, parentErr := os.Stat(parent)
	if parentErr == nil && parentStat.IsDir() {
		return parent, nil
	}
	return "", fmt.Errorf("cannot access %q: %w", cleanPath, statErr)
}

func repoRootId(repoType string, rootPath string) string {
	return fmt.Sprintf("%s:%s", repoType, rootPath)
}

func normalizeRepoRootPath(path string) string {
	cleanPath := filepath.Clean(strings.TrimSpace(path))
	if cleanPath == "" || cleanPath == "." {
		return ""
	}
	if absPath, err := filepath.Abs(cleanPath); err == nil && absPath != "" {
		cleanPath = filepath.Clean(absPath)
	}
	if evalPath, err := filepath.EvalSymlinks(cleanPath); err == nil && evalPath != "" {
		cleanPath = filepath.Clean(evalPath)
	}
	return cleanPath
}

func repoRootPathKey(path string) string {
	normalizedPath := normalizeRepoRootPath(path)
	if runtime.GOOS == "windows" {
		return strings.ToLower(normalizedPath)
	}
	return normalizedPath
}

func repoRootDedupKey(repoType string, path string) string {
	typeKey := strings.ToLower(strings.TrimSpace(repoType))
	pathKey := repoRootPathKey(path)
	if typeKey == "" || pathKey == "" {
		return ""
	}
	return fmt.Sprintf("%s:%s", typeKey, pathKey)
}

func makeDetectedRepoRoot(repoType string, path string) (detectedRepoRoot, bool) {
	typeKey := strings.ToLower(strings.TrimSpace(repoType))
	normalizedPath := normalizeRepoRootPath(path)
	if typeKey == "" || normalizedPath == "" {
		return detectedRepoRoot{}, false
	}
	return detectedRepoRoot{
		RepoType: typeKey,
		RootPath: normalizedPath,
	}, true
}

func sortDetectedRepoRootsByPath(entries []detectedRepoRoot) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].RootPath != entries[j].RootPath {
			return entries[i].RootPath < entries[j].RootPath
		}
		return entries[i].RepoType < entries[j].RepoType
	})
}

func sortDetectedRepoRootsBySpecificity(entries []detectedRepoRoot) {
	sort.Slice(entries, func(i, j int) bool {
		if len(entries[i].RootPath) != len(entries[j].RootPath) {
			return len(entries[i].RootPath) > len(entries[j].RootPath)
		}
		if entries[i].RootPath != entries[j].RootPath {
			return entries[i].RootPath < entries[j].RootPath
		}
		return entries[i].RepoType < entries[j].RepoType
	})
}

func buildResolvedRepoRoots(gitRoot string, svnRoot string) []detectedRepoRoot {
	entries := make([]detectedRepoRoot, 0, 2)
	if entry, ok := makeDetectedRepoRoot("git", gitRoot); ok {
		entries = append(entries, entry)
	}
	if entry, ok := makeDetectedRepoRoot("svn", svnRoot); ok {
		entries = append(entries, entry)
	}
	sortDetectedRepoRootsBySpecificity(entries)
	return entries
}

func detectGitRoot(ctx context.Context, path string) string {
	out, err := runVcsCommand(ctx, path, "git", "rev-parse", "--show-toplevel")
	if err != nil || out == "" {
		return ""
	}
	return normalizeRepoRootPath(out)
}

func detectSvnRoot(ctx context.Context, path string) string {
	out, err := runVcsCommand(ctx, path, "svn", "info", "--show-item", "wc-root")
	if err == nil && out != "" {
		return normalizeRepoRootPath(out)
	}
	xmlOut, xmlErr := runVcsCommand(ctx, path, "svn", "info", "--xml")
	if xmlErr != nil || xmlOut == "" {
		return ""
	}
	var info svnInfoXML
	if unmarshalErr := xml.Unmarshal([]byte(xmlOut), &info); unmarshalErr != nil {
		return ""
	}
	if len(info.Entries) == 0 {
		return ""
	}
	if info.Entries[0].WcInfo.WcRootAbsPath == "" {
		return ""
	}
	return normalizeRepoRootPath(info.Entries[0].WcInfo.WcRootAbsPath)
}

func detectRepoType(ctx context.Context, rootPath string) string {
	if _, err := os.Stat(filepath.Join(rootPath, ".git")); err == nil {
		return "git"
	}
	if stat, err := os.Stat(filepath.Join(rootPath, ".svn")); err == nil && stat.IsDir() {
		return "svn"
	}
	if detectGitRoot(ctx, rootPath) != "" {
		return "git"
	}
	if detectSvnRoot(ctx, rootPath) != "" {
		return "svn"
	}
	return ""
}

func shouldSkipVcsScanDir(name string) bool {
	_, found := vcsScanSkipDirNames[name]
	return found
}

func detectRepoRoots(ctx context.Context, basePath string, scanDepth int, includeParent bool) []detectedRepoRoot {
	if scanDepth <= 0 {
		scanDepth = DefaultVcsScanDepth
	}
	repoSet := make(map[string]detectedRepoRoot)
	addRepo := func(repoType string, path string) {
		entry, ok := makeDetectedRepoRoot(repoType, path)
		if !ok {
			return
		}
		dedupKey := repoRootDedupKey(entry.RepoType, entry.RootPath)
		if dedupKey == "" {
			return
		}
		if _, exists := repoSet[dedupKey]; exists {
			return
		}
		repoSet[dedupKey] = entry
	}
	if includeParent {
		if gitRoot := detectGitRoot(ctx, basePath); gitRoot != "" {
			addRepo("git", gitRoot)
		}
		if svnRoot := detectSvnRoot(ctx, basePath); svnRoot != "" {
			addRepo("svn", svnRoot)
		}
	}
	_ = filepath.WalkDir(basePath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		relPath, relErr := filepath.Rel(basePath, path)
		if relErr != nil {
			return nil
		}
		depth := 0
		if relPath != "." {
			depth = strings.Count(relPath, string(os.PathSeparator)) + 1
		}
		if depth > scanDepth && entry.IsDir() {
			return filepath.SkipDir
		}
		name := entry.Name()
		if entry.IsDir() {
			if name == ".git" || name == ".svn" {
				addRepo(strings.TrimPrefix(name, "."), filepath.Dir(path))
				return filepath.SkipDir
			}
			if shouldSkipVcsScanDir(name) {
				return filepath.SkipDir
			}
			if len(repoSet) >= MaxVcsRepos {
				return filepath.SkipDir
			}
			return nil
		}
		if name == ".git" {
			addRepo("git", filepath.Dir(path))
		}
		return nil
	})
	repos := make([]detectedRepoRoot, 0, len(repoSet))
	for _, repo := range repoSet {
		repos = append(repos, repo)
	}
	sortDetectedRepoRootsByPath(repos)
	if len(repos) > MaxVcsRepos {
		repos = repos[:MaxVcsRepos]
	}
	return repos
}

func chooseResolvedRepoRoot(gitRoot string, svnRoot string) (string, string) {
	resolved := buildResolvedRepoRoots(gitRoot, svnRoot)
	if len(resolved) == 0 {
		return "", ""
	}
	return resolved[0].RepoType, resolved[0].RootPath
}

func makeRepoInfo(repoType string, repoRoot string) wshrpc.VcsRepositoryInfo {
	repoInfo := wshrpc.VcsRepositoryInfo{
		RepoId:   repoRootId(repoType, repoRoot),
		RepoType: repoType,
		RootPath: repoRoot,
		Name:     filepath.Base(repoRoot),
	}
	if repoInfo.Name == "" || repoInfo.Name == "." {
		repoInfo.Name = repoRoot
	}
	return repoInfo
}

func parseGitStatus(statusOut string, statusLimit int) []wshrpc.VcsFileStatus {
	if statusLimit <= 0 {
		statusLimit = DefaultVcsStatusLimit
	}
	lines := strings.Split(statusOut, "\n")
	statuses := make([]wshrpc.VcsFileStatus, 0, len(lines))
	for _, rawLine := range lines {
		line := strings.TrimRight(rawLine, "\r")
		if strings.TrimSpace(line) == "" || len(line) < 3 {
			continue
		}
		code := strings.TrimSpace(line[0:2])
		if code == "" {
			code = line[0:2]
		}
		path := strings.TrimSpace(line[3:])
		if idx := strings.LastIndex(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}
		path = strings.Trim(path, "\"")
		if path == "" {
			continue
		}
		fileStatus := wshrpc.VcsFileStatus{
			Path:      filepath.ToSlash(path),
			Code:      code,
			Staged:    line[0] != ' ' && line[0] != '?',
			Untracked: strings.HasPrefix(line, "??"),
		}
		statuses = append(statuses, fileStatus)
		if len(statuses) >= statusLimit {
			break
		}
	}
	sort.Slice(statuses, func(i, j int) bool {
		return statuses[i].Path < statuses[j].Path
	})
	return statuses
}

func loadGitRepoState(ctx context.Context, repoPath string, statusLimit int) (string, []wshrpc.VcsFileStatus, error) {
	branch, branchErr := runVcsCommand(ctx, repoPath, "git", "rev-parse", "--abbrev-ref", "HEAD")
	if branchErr != nil {
		return "", nil, branchErr
	}
	if branch == "HEAD" {
		shortHash, hashErr := runVcsCommand(ctx, repoPath, "git", "rev-parse", "--short", "HEAD")
		if hashErr == nil && shortHash != "" {
			branch = "detached@" + shortHash
		}
	}
	statusOut, statusErr := runVcsCommand(ctx, repoPath, "git", "status", "--porcelain=1", "-uall")
	if statusErr != nil {
		return branch, nil, statusErr
	}
	return branch, parseGitStatus(statusOut, statusLimit), nil
}

func appendRemoteStateError(state *wshrpc.VcsRemoteState, err error) {
	if state == nil || err == nil {
		return
	}
	errMsg := strings.TrimSpace(err.Error())
	if errMsg == "" {
		return
	}
	if state.Error == "" {
		state.Error = errMsg
		return
	}
	state.Error += "\n" + errMsg
}

func parseGitAheadBehind(out string) (int, int, error) {
	fields := strings.Fields(strings.TrimSpace(out))
	if len(fields) < 2 {
		return 0, 0, fmt.Errorf("invalid ahead/behind output %q", out)
	}
	ahead, aheadErr := strconv.Atoi(fields[0])
	if aheadErr != nil {
		return 0, 0, fmt.Errorf("invalid ahead count %q: %w", fields[0], aheadErr)
	}
	behind, behindErr := strconv.Atoi(fields[1])
	if behindErr != nil {
		return 0, 0, fmt.Errorf("invalid behind count %q: %w", fields[1], behindErr)
	}
	return ahead, behind, nil
}

func loadGitRemoteCommits(ctx context.Context, repoPath string, rangeSpec string, limit int) ([]wshrpc.VcsCommitInfo, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > DefaultVcsCommitLimit {
		limit = DefaultVcsCommitLimit
	}
	args := []string{
		"log",
		"--max-count=" + strconv.Itoa(limit),
		"--pretty=format:%H%x1f%an%x1f%aI%x1f%s%x1e",
		rangeSpec,
	}
	out, err := runVcsCommand(ctx, repoPath, "git", args...)
	if err != nil {
		return nil, err
	}
	return parseGitCommits(out), nil
}

func loadGitRemoteState(ctx context.Context, repoPath string, commitLimit int) *wshrpc.VcsRemoteState {
	state := &wshrpc.VcsRemoteState{}
	upstream, upstreamErr := runVcsCommand(ctx, repoPath, "git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	if upstreamErr != nil {
		state.Error = "No upstream configured."
		return state
	}
	state.Upstream = strings.TrimSpace(upstream)
	countOut, countErr := runVcsCommand(ctx, repoPath, "git", "rev-list", "--left-right", "--count", "HEAD...@{u}")
	if countErr != nil {
		appendRemoteStateError(state, countErr)
		return state
	}
	ahead, behind, parseErr := parseGitAheadBehind(countOut)
	if parseErr != nil {
		appendRemoteStateError(state, parseErr)
		return state
	}
	state.Ahead = ahead
	state.Behind = behind
	if behind > 0 {
		incoming, incomingErr := loadGitRemoteCommits(ctx, repoPath, "HEAD..@{u}", commitLimit)
		if incomingErr != nil {
			appendRemoteStateError(state, incomingErr)
		} else {
			state.Incoming = incoming
		}
	}
	if ahead > 0 {
		outgoing, outgoingErr := loadGitRemoteCommits(ctx, repoPath, "@{u}..HEAD", commitLimit)
		if outgoingErr != nil {
			appendRemoteStateError(state, outgoingErr)
		} else {
			state.Outgoing = outgoing
		}
	}
	return state
}

func parseSvnStatus(statusOut string, statusLimit int) []wshrpc.VcsFileStatus {
	if statusLimit <= 0 {
		statusLimit = DefaultVcsStatusLimit
	}
	lines := strings.Split(statusOut, "\n")
	statuses := make([]wshrpc.VcsFileStatus, 0, len(lines))
	for _, rawLine := range lines {
		line := strings.TrimRight(rawLine, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		code := strings.TrimSpace(line)
		if len(line) >= 1 {
			code = string(line[0])
		}
		path := strings.TrimSpace(line)
		if len(line) >= 8 {
			path = strings.TrimSpace(line[8:])
		}
		if path == "" {
			continue
		}
		statusCode := strings.TrimSpace(code)
		statuses = append(statuses, wshrpc.VcsFileStatus{
			Path:      filepath.ToSlash(path),
			Code:      statusCode,
			Staged:    statusCode == "A" || statusCode == "M" || statusCode == "D" || statusCode == "R",
			Untracked: statusCode == "?",
		})
		if len(statuses) >= statusLimit {
			break
		}
	}
	sort.Slice(statuses, func(i, j int) bool {
		return statuses[i].Path < statuses[j].Path
	})
	return statuses
}

func mapSvnStatusItemToCode(item string) string {
	switch item {
	case "added":
		return "A"
	case "modified":
		return "M"
	case "deleted":
		return "D"
	case "replaced":
		return "R"
	case "conflicted":
		return "C"
	case "missing", "incomplete":
		return "!"
	case "ignored":
		return "I"
	case "external":
		return "X"
	case "obstructed":
		return "~"
	case "unversioned":
		return "?"
	default:
		return ""
	}
}

func parseSvnStatusXML(statusOut string, statusLimit int) []wshrpc.VcsFileStatus {
	if statusLimit <= 0 {
		statusLimit = DefaultVcsStatusLimit
	}
	var parsed svnStatusXML
	if err := xml.Unmarshal([]byte(statusOut), &parsed); err != nil {
		return parseSvnStatus(statusOut, statusLimit)
	}
	statuses := make([]wshrpc.VcsFileStatus, 0)
	for _, target := range parsed.Targets {
		for _, entry := range target.Entries {
			path := strings.TrimSpace(entry.Path)
			if path == "" {
				continue
			}
			code := mapSvnStatusItemToCode(strings.TrimSpace(entry.WCStatus.Item))
			if code == "" {
				continue
			}
			statuses = append(statuses, wshrpc.VcsFileStatus{
				Path:      filepath.ToSlash(path),
				Code:      code,
				Staged:    code == "A" || code == "M" || code == "D" || code == "R",
				Untracked: code == "?",
			})
			if len(statuses) >= statusLimit {
				sort.Slice(statuses, func(i, j int) bool {
					return statuses[i].Path < statuses[j].Path
				})
				return statuses
			}
		}
	}
	sort.Slice(statuses, func(i, j int) bool {
		return statuses[i].Path < statuses[j].Path
	})
	return statuses
}

func parseSvnRemoteStatusXML(statusOut string, statusLimit int) []wshrpc.VcsFileStatus {
	if statusLimit <= 0 {
		statusLimit = DefaultVcsStatusLimit
	}
	var parsed svnStatusXML
	if err := xml.Unmarshal([]byte(statusOut), &parsed); err != nil {
		return nil
	}
	statuses := make([]wshrpc.VcsFileStatus, 0)
	for _, target := range parsed.Targets {
		for _, entry := range target.Entries {
			path := strings.TrimSpace(entry.Path)
			if path == "" {
				continue
			}
			item := strings.TrimSpace(entry.ReposStatus.Item)
			code := mapSvnStatusItemToCode(item)
			if code == "" {
				continue
			}
			statuses = append(statuses, wshrpc.VcsFileStatus{
				Path: filepath.ToSlash(path),
				Code: code,
			})
			if len(statuses) >= statusLimit {
				sort.Slice(statuses, func(i, j int) bool {
					return statuses[i].Path < statuses[j].Path
				})
				return statuses
			}
		}
	}
	sort.Slice(statuses, func(i, j int) bool {
		return statuses[i].Path < statuses[j].Path
	})
	return statuses
}

func loadSvnRepoState(ctx context.Context, repoPath string, statusLimit int) (string, []wshrpc.VcsFileStatus, error) {
	branch, branchErr := runVcsCommand(ctx, repoPath, "svn", "info", "--show-item", "relative-url")
	if branchErr != nil || branch == "" {
		branch, branchErr = runVcsCommand(ctx, repoPath, "svn", "info", "--show-item", "url")
		if branchErr != nil {
			return "", nil, branchErr
		}
	}
	statusOut, statusErr := runSvnStatusXMLCommand(ctx, repoPath)
	if statusErr != nil {
		return branch, nil, statusErr
	}
	return branch, parseSvnStatusXML(statusOut, statusLimit), nil
}

func loadSvnRemoteState(ctx context.Context, repoPath string, statusLimit int) *wshrpc.VcsRemoteState {
	state := &wshrpc.VcsRemoteState{}
	upstream, upstreamErr := runVcsCommand(ctx, repoPath, "svn", "info", "--show-item", "url")
	if upstreamErr != nil {
		appendRemoteStateError(state, upstreamErr)
	} else {
		state.Upstream = strings.TrimSpace(upstream)
	}
	statusOut, statusErr := runSvnRemoteStatusXMLCommand(ctx, repoPath)
	if statusErr != nil {
		appendRemoteStateError(state, statusErr)
		return state
	}
	state.Files = parseSvnRemoteStatusXML(statusOut, statusLimit)
	return state
}

func normalizeRepositoryBrowseUrl(remoteURL string) string {
	trimmed := strings.TrimSpace(strings.TrimSuffix(remoteURL, "/"))
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return strings.TrimSuffix(trimmed, ".git")
	}
	if strings.HasPrefix(trimmed, "ssh://") {
		withoutScheme := strings.TrimPrefix(trimmed, "ssh://")
		if atIdx := strings.Index(withoutScheme, "@"); atIdx >= 0 {
			withoutScheme = withoutScheme[atIdx+1:]
		}
		slashIdx := strings.Index(withoutScheme, "/")
		if slashIdx <= 0 || slashIdx >= len(withoutScheme)-1 {
			return ""
		}
		host := withoutScheme[:slashIdx]
		path := strings.Trim(withoutScheme[slashIdx+1:], "/")
		path = strings.TrimSuffix(path, ".git")
		if host == "" || path == "" {
			return ""
		}
		return "https://" + host + "/" + path
	}
	if strings.HasPrefix(trimmed, "git://") {
		withoutScheme := strings.TrimPrefix(trimmed, "git://")
		slashIdx := strings.Index(withoutScheme, "/")
		if slashIdx <= 0 || slashIdx >= len(withoutScheme)-1 {
			return ""
		}
		host := withoutScheme[:slashIdx]
		path := strings.Trim(withoutScheme[slashIdx+1:], "/")
		path = strings.TrimSuffix(path, ".git")
		if host == "" || path == "" {
			return ""
		}
		return "https://" + host + "/" + path
	}
	if strings.Contains(trimmed, "@") && strings.Contains(trimmed, ":") && !strings.Contains(trimmed, "://") {
		afterUser := trimmed
		if atIdx := strings.LastIndex(trimmed, "@"); atIdx >= 0 {
			afterUser = trimmed[atIdx+1:]
		}
		parts := strings.SplitN(afterUser, ":", 2)
		if len(parts) != 2 {
			return ""
		}
		host := strings.TrimSpace(parts[0])
		path := strings.Trim(strings.TrimSpace(parts[1]), "/")
		path = strings.TrimSuffix(path, ".git")
		if host == "" || path == "" {
			return ""
		}
		return "https://" + host + "/" + path
	}
	return ""
}

func loadGitRemoteUrls(ctx context.Context, repoPath string) (string, string) {
	remoteUrl, remoteErr := runVcsCommand(ctx, repoPath, "git", "remote", "get-url", "origin")
	if remoteErr != nil || strings.TrimSpace(remoteUrl) == "" {
		remotesOut, remotesErr := runVcsCommand(ctx, repoPath, "git", "remote")
		if remotesErr == nil && strings.TrimSpace(remotesOut) != "" {
			for _, remoteName := range strings.Split(remotesOut, "\n") {
				remoteName = strings.TrimSpace(remoteName)
				if remoteName == "" {
					continue
				}
				candidate, candidateErr := runVcsCommand(ctx, repoPath, "git", "remote", "get-url", remoteName)
				if candidateErr == nil && strings.TrimSpace(candidate) != "" {
					remoteUrl = candidate
					break
				}
			}
		}
	}
	remoteUrl = strings.TrimSpace(remoteUrl)
	if remoteUrl == "" {
		return "", ""
	}
	return remoteUrl, normalizeRepositoryBrowseUrl(remoteUrl)
}

func loadSvnRemoteUrls(ctx context.Context, repoPath string) (string, string) {
	remoteUrl, remoteErr := runVcsCommand(ctx, repoPath, "svn", "info", "--show-item", "url")
	if remoteErr != nil {
		return "", ""
	}
	remoteUrl = strings.TrimSpace(remoteUrl)
	if remoteUrl == "" {
		return "", ""
	}
	browseUrl := normalizeRepositoryBrowseUrl(remoteUrl)
	if browseUrl == "" {
		browseUrl = remoteUrl
	}
	return remoteUrl, browseUrl
}

func parseGitCommits(logOut string) []wshrpc.VcsCommitInfo {
	records := strings.Split(logOut, "\x1e")
	commits := make([]wshrpc.VcsCommitInfo, 0, len(records))
	for _, record := range records {
		trimmed := strings.TrimSpace(record)
		if trimmed == "" {
			continue
		}
		fields := strings.Split(trimmed, "\x1f")
		if len(fields) < 4 {
			continue
		}
		commits = append(commits, wshrpc.VcsCommitInfo{
			Hash:    fields[0],
			Author:  fields[1],
			Date:    fields[2],
			Subject: fields[3],
		})
	}
	return commits
}

func toRepoRelativePath(repoPath string, filePath string) string {
	trimmed := strings.TrimSpace(strings.Trim(normalizeVcsInputPath(filePath), "\""))
	if trimmed == "" {
		return ""
	}
	if expanded, err := wavebase.ExpandHomeDir(trimmed); err == nil {
		trimmed = expanded
	}
	cleanPath := filepath.Clean(trimmed)
	if filepath.IsAbs(cleanPath) {
		relPath, err := filepath.Rel(repoPath, cleanPath)
		if err == nil && relPath == "." {
			return ""
		}
		if err == nil && !strings.HasPrefix(relPath, "..") {
			return filepath.ToSlash(relPath)
		}
	}
	return filepath.ToSlash(cleanPath)
}

func loadGitCommitsWithOffset(ctx context.Context, repoPath string, filePath string, limit int, offset int) ([]wshrpc.VcsCommitInfo, error) {
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if limit > MaxVcsCommitScanLimit {
		limit = MaxVcsCommitScanLimit
	}
	if offset < 0 {
		offset = 0
	}
	args := []string{
		"log",
		"--date=iso-strict",
		"--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1e",
		"-n",
		strconv.Itoa(limit),
	}
	if offset > 0 {
		args = append(args, "--skip", strconv.Itoa(offset))
	}
	relPath := toRepoRelativePath(repoPath, filePath)
	if relPath != "" {
		args = append(args, "--", relPath)
	}
	out, err := runVcsCommand(ctx, repoPath, "git", args...)
	if err != nil {
		return nil, err
	}
	return parseGitCommits(out), nil
}

func loadGitCommits(ctx context.Context, repoPath string, filePath string, limit int) ([]wshrpc.VcsCommitInfo, error) {
	return loadGitCommitsWithOffset(ctx, repoPath, filePath, limit, 0)
}

func parseSvnCommits(logOut string) ([]wshrpc.VcsCommitInfo, error) {
	var parsed svnLogXML
	if err := xml.Unmarshal([]byte(logOut), &parsed); err != nil {
		return nil, fmt.Errorf("cannot parse svn log xml: %w", err)
	}
	commits := make([]wshrpc.VcsCommitInfo, 0, len(parsed.Entries))
	for _, entry := range parsed.Entries {
		subject := strings.TrimSpace(entry.Message)
		if idx := strings.Index(subject, "\n"); idx >= 0 {
			subject = subject[:idx]
		}
		commits = append(commits, wshrpc.VcsCommitInfo{
			Hash:    entry.Revision,
			Author:  strings.TrimSpace(entry.Author),
			Date:    strings.TrimSpace(entry.Date),
			Subject: subject,
		})
	}
	return commits, nil
}

func loadSvnCommits(ctx context.Context, repoPath string, filePath string, limit int) ([]wshrpc.VcsCommitInfo, error) {
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if limit > MaxVcsCommitScanLimit {
		limit = MaxVcsCommitScanLimit
	}
	args := []string{"log", "--xml", "-l", strconv.Itoa(limit)}
	relPath := toRepoRelativePath(repoPath, filePath)
	if relPath != "" {
		args = append(args, "--", relPath)
	}
	out, err := runVcsCommand(ctx, repoPath, "svn", args...)
	if err != nil {
		return nil, err
	}
	return parseSvnCommits(out)
}

func parseCommitFilterTime(val string, endOfDay bool) (*time.Time, error) {
	trimmed := strings.TrimSpace(val)
	if trimmed == "" {
		return nil, nil
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		parsed, err := time.Parse(layout, trimmed)
		if err != nil {
			continue
		}
		if layout == "2006-01-02" {
			if endOfDay {
				parsed = parsed.Add(24*time.Hour - time.Nanosecond)
			}
		}
		return &parsed, nil
	}
	return nil, fmt.Errorf("invalid time format %q", val)
}

func parseCommitDate(dateStr string) *time.Time {
	trimmed := strings.TrimSpace(dateStr)
	if trimmed == "" {
		return nil
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05 -0700",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			return &parsed
		}
	}
	return nil
}

func commitMatchesTimeRange(commit wshrpc.VcsCommitInfo, sinceTime *time.Time, untilTime *time.Time) bool {
	if sinceTime == nil && untilTime == nil {
		return true
	}
	commitTime := parseCommitDate(commit.Date)
	if commitTime == nil {
		return false
	}
	if sinceTime != nil && commitTime.Before(*sinceTime) {
		return false
	}
	if untilTime != nil && commitTime.After(*untilTime) {
		return false
	}
	return true
}

func commitMatchesKeyword(commit wshrpc.VcsCommitInfo, keyword string) bool {
	trimmedKeyword := strings.TrimSpace(strings.ToLower(keyword))
	if trimmedKeyword == "" {
		return true
	}
	return strings.Contains(strings.ToLower(commit.Hash), trimmedKeyword) ||
		strings.Contains(strings.ToLower(commit.Author), trimmedKeyword) ||
		strings.Contains(strings.ToLower(commit.Subject), trimmedKeyword) ||
		strings.Contains(strings.ToLower(commit.Date), trimmedKeyword)
}

func filterAndPaginateCommits(
	commits []wshrpc.VcsCommitInfo,
	offset int,
	limit int,
	sinceTime *time.Time,
	untilTime *time.Time,
	keyword string,
) ([]wshrpc.VcsCommitInfo, bool) {
	filtered := make([]wshrpc.VcsCommitInfo, 0, len(commits))
	for _, commit := range commits {
		if !commitMatchesTimeRange(commit, sinceTime, untilTime) {
			continue
		}
		if !commitMatchesKeyword(commit, keyword) {
			continue
		}
		filtered = append(filtered, commit)
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if offset >= len(filtered) {
		return []wshrpc.VcsCommitInfo{}, false
	}
	end := offset + limit
	if end > len(filtered) {
		end = len(filtered)
	}
	hasMore := end < len(filtered)
	return filtered[offset:end], hasMore
}

func loadGitCommitsForQuery(
	ctx context.Context,
	repoPath string,
	limit int,
	offset int,
	since string,
	until string,
	keyword string,
) ([]wshrpc.VcsCommitInfo, bool, error) {
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	sinceTime, err := parseCommitFilterTime(since, false)
	if err != nil {
		return nil, false, err
	}
	untilTime, err := parseCommitFilterTime(until, true)
	if err != nil {
		return nil, false, err
	}
	trimmedKeyword := strings.TrimSpace(keyword)
	if sinceTime == nil && untilTime == nil && trimmedKeyword == "" {
		rawCommits, err := loadGitCommitsWithOffset(ctx, repoPath, "", limit+1, offset)
		if err != nil {
			return nil, false, err
		}
		hasMore := len(rawCommits) > limit
		if hasMore {
			rawCommits = rawCommits[:limit]
		}
		return rawCommits, hasMore, nil
	}
	scanLimit := offset + limit + 1
	if scanLimit < 500 {
		scanLimit = 500
	}
	if scanLimit > MaxVcsCommitScanLimit {
		scanLimit = MaxVcsCommitScanLimit
	}
	rawCommits, err := loadGitCommits(ctx, repoPath, "", scanLimit)
	if err != nil {
		return nil, false, err
	}
	filteredCommits, hasMore := filterAndPaginateCommits(rawCommits, offset, limit, sinceTime, untilTime, trimmedKeyword)
	return filteredCommits, hasMore, nil
}

func loadSvnCommitsForQuery(
	ctx context.Context,
	repoPath string,
	limit int,
	offset int,
	since string,
	until string,
	keyword string,
) ([]wshrpc.VcsCommitInfo, bool, error) {
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	sinceTime, err := parseCommitFilterTime(since, false)
	if err != nil {
		return nil, false, err
	}
	untilTime, err := parseCommitFilterTime(until, true)
	if err != nil {
		return nil, false, err
	}
	scanLimit := offset + limit + 1
	if scanLimit < 500 {
		scanLimit = 500
	}
	if scanLimit > MaxVcsCommitScanLimit {
		scanLimit = MaxVcsCommitScanLimit
	}
	rawCommits, err := loadSvnCommits(ctx, repoPath, "", scanLimit)
	if err != nil {
		return nil, false, err
	}
	filteredCommits, hasMore := filterAndPaginateCommits(rawCommits, offset, limit, sinceTime, untilTime, keyword)
	return filteredCommits, hasMore, nil
}

func parseGitCommitFiles(nameStatusOut string) []wshrpc.VcsCommitFileInfo {
	files := make([]wshrpc.VcsCommitFileInfo, 0)
	for _, rawLine := range strings.Split(nameStatusOut, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		code := strings.TrimSpace(fields[0])
		filePath := strings.TrimSpace(fields[len(fields)-1])
		filePath = filepath.ToSlash(filePath)
		if filePath == "" {
			continue
		}
		files = append(files, wshrpc.VcsCommitFileInfo{
			Path: filePath,
			Code: code,
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files
}

func loadGitCommitFiles(ctx context.Context, repoPath string, revision string) ([]wshrpc.VcsCommitFileInfo, error) {
	trimmedRevision := strings.TrimSpace(revision)
	if trimmedRevision == "" {
		return nil, fmt.Errorf("revision is required")
	}
	out, err := runVcsCommandRaw(ctx, repoPath, "git", "show", "--name-status", "--pretty=format:", trimmedRevision)
	if err != nil {
		return nil, err
	}
	return parseGitCommitFiles(out), nil
}

func parseSvnCommitFiles(repoPath string, summarizeOut string) []wshrpc.VcsCommitFileInfo {
	files := make([]wshrpc.VcsCommitFileInfo, 0)
	for _, rawLine := range strings.Split(summarizeOut, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		code := strings.TrimSpace(string(line[0]))
		filePath := strings.TrimSpace(line[1:])
		filePath = toRepoRelativePath(repoPath, filePath)
		if filePath == "" {
			continue
		}
		files = append(files, wshrpc.VcsCommitFileInfo{
			Path: filePath,
			Code: code,
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files
}

func loadSvnCommitFiles(ctx context.Context, repoPath string, revision string) ([]wshrpc.VcsCommitFileInfo, error) {
	trimmedRevision := strings.TrimSpace(revision)
	if strings.HasPrefix(trimmedRevision, "r") {
		trimmedRevision = strings.TrimPrefix(trimmedRevision, "r")
	}
	if trimmedRevision == "" {
		return nil, fmt.Errorf("revision is required")
	}
	out, err := runVcsCommandRaw(ctx, repoPath, "svn", "diff", "--summarize", "-c", trimmedRevision)
	if err != nil {
		return nil, err
	}
	return parseSvnCommitFiles(repoPath, out), nil
}

func normalizeCommitPaths(repoPath string, files []string) []string {
	uniquePaths := make(map[string]struct{})
	for _, filePath := range files {
		relPath := toRepoRelativePath(repoPath, filePath)
		if relPath == "" || relPath == "." {
			continue
		}
		uniquePaths[relPath] = struct{}{}
	}
	normalized := make([]string, 0, len(uniquePaths))
	for path := range uniquePaths {
		normalized = append(normalized, path)
	}
	sort.Strings(normalized)
	return normalized
}

func commitGit(ctx context.Context, repoPath string, message string, files []string) (string, error) {
	if len(files) == 0 {
		return "", fmt.Errorf("no files selected")
	}
	addArgs := append([]string{"add", "--"}, files...)
	if _, err := runVcsCommand(ctx, repoPath, "git", addArgs...); err != nil {
		return "", err
	}
	commitArgs := append([]string{"commit", "-m", message, "--"}, files...)
	out, err := runVcsCommand(ctx, repoPath, "git", commitArgs...)
	if err != nil {
		return out, err
	}
	return out, nil
}

func commitSvn(ctx context.Context, repoPath string, message string, files []string) (string, error) {
	if len(files) == 0 {
		return "", fmt.Errorf("no files selected")
	}
	addArgs := append([]string{"add", "--force"}, files...)
	_, _ = runVcsCommand(ctx, repoPath, "svn", addArgs...)
	commitArgs := append([]string{"commit", "-m", message}, files...)
	out, err := runVcsCommand(ctx, repoPath, "svn", commitArgs...)
	if err != nil {
		return out, err
	}
	return out, nil
}

func (impl *ServerImpl) RemoteVcsRepositoriesCommand(ctx context.Context, data wshrpc.CommandRemoteVcsRepositoriesData) (*wshrpc.RemoteVcsRepositoriesRtnData, error) {
	basePath, err := normalizeVcsBasePath(data.Path)
	if err != nil {
		return nil, err
	}
	statusLimit := data.StatusLimit
	if statusLimit <= 0 {
		statusLimit = DefaultVcsStatusLimit
	}
	if statusLimit > 2000 {
		statusLimit = 2000
	}
	scanDepth := data.ScanDepth
	if scanDepth <= 0 {
		scanDepth = DefaultVcsScanDepth
	}
	repoRoots := detectRepoRoots(ctx, basePath, scanDepth, data.IncludeParent)
	repositories := make([]wshrpc.VcsRepositoryInfo, 0, len(repoRoots))
	for _, repoRoot := range repoRoots {
		repoInfo := makeRepoInfo(repoRoot.RepoType, repoRoot.RootPath)
		switch repoRoot.RepoType {
		case "git":
			branch, status, statusErr := loadGitRepoState(ctx, repoRoot.RootPath, statusLimit)
			remoteUrl, browseUrl := loadGitRemoteUrls(ctx, repoRoot.RootPath)
			repoInfo.Branch = branch
			repoInfo.RemoteUrl = remoteUrl
			repoInfo.BrowseUrl = browseUrl
			repoInfo.Remote = loadGitRemoteState(ctx, repoRoot.RootPath, 20)
			repoInfo.Status = status
			if statusErr != nil {
				repoInfo.StatusErr = statusErr.Error()
			}
		case "svn":
			branch, status, statusErr := loadSvnRepoState(ctx, repoRoot.RootPath, statusLimit)
			remoteUrl, browseUrl := loadSvnRemoteUrls(ctx, repoRoot.RootPath)
			repoInfo.Branch = branch
			repoInfo.RemoteUrl = remoteUrl
			repoInfo.BrowseUrl = browseUrl
			repoInfo.Remote = loadSvnRemoteState(ctx, repoRoot.RootPath, statusLimit)
			repoInfo.Status = status
			if statusErr != nil {
				repoInfo.StatusErr = statusErr.Error()
			}
		}
		repositories = append(repositories, repoInfo)
	}
	sort.Slice(repositories, func(i, j int) bool {
		if repositories[i].RootPath != repositories[j].RootPath {
			return repositories[i].RootPath < repositories[j].RootPath
		}
		return repositories[i].RepoType < repositories[j].RepoType
	})
	return &wshrpc.RemoteVcsRepositoriesRtnData{
		BasePath:     basePath,
		Repositories: repositories,
	}, nil
}

func (impl *ServerImpl) RemoteVcsResolvePathCommand(ctx context.Context, data wshrpc.CommandRemoteVcsResolvePathData) (*wshrpc.RemoteVcsResolvePathRtnData, error) {
	result := &wshrpc.RemoteVcsResolvePathRtnData{
		Path: strings.TrimSpace(data.Path),
	}
	basePath, err := normalizeVcsBasePath(data.Path)
	if err != nil {
		result.Error = err.Error()
		log.Printf("[vcsresolve] normalize failed path=%q err=%v", data.Path, err)
		return result, nil
	}
	result.BasePath = basePath
	gitRoot := detectGitRoot(ctx, basePath)
	svnRoot := detectSvnRoot(ctx, basePath)
	resolvedRepos := buildResolvedRepoRoots(gitRoot, svnRoot)
	if len(resolvedRepos) == 0 {
		log.Printf("[vcsresolve] no repo path=%q base=%q git=%q svn=%q", data.Path, basePath, gitRoot, svnRoot)
		return result, nil
	}
	result.Matched = true
	result.Repositories = make([]wshrpc.VcsRepositoryInfo, 0, len(resolvedRepos))
	for _, resolvedRepo := range resolvedRepos {
		result.Repositories = append(result.Repositories, makeRepoInfo(resolvedRepo.RepoType, resolvedRepo.RootPath))
	}
	firstRepo := result.Repositories[0]
	result.RepoType = firstRepo.RepoType
	result.RepoPath = firstRepo.RootPath
	result.RepoId = firstRepo.RepoId
	result.RepoName = firstRepo.Name
	log.Printf("[vcsresolve] matched path=%q base=%q repos=%v git=%q svn=%q", data.Path, basePath, result.Repositories, gitRoot, svnRoot)
	return result, nil
}

func (impl *ServerImpl) RemoteVcsCommitsCommand(ctx context.Context, data wshrpc.CommandRemoteVcsCommitsData) (*wshrpc.RemoteVcsCommitsRtnData, error) {
	repoPath, err := normalizeVcsBasePath(data.RepoPath)
	if err != nil {
		return nil, err
	}
	repoType := strings.ToLower(strings.TrimSpace(data.RepoType))
	if repoType == "" {
		repoType = detectRepoType(ctx, repoPath)
	}
	if repoType != "git" && repoType != "svn" {
		return nil, fmt.Errorf("unsupported repo type %q", repoType)
	}
	limit := data.Limit
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if limit > 500 {
		limit = 500
	}
	offset := data.Offset
	if offset < 0 {
		offset = 0
	}
	var commits []wshrpc.VcsCommitInfo
	var hasMore bool
	switch repoType {
	case "git":
		commits, hasMore, err = loadGitCommitsForQuery(ctx, repoPath, limit, offset, data.Since, data.Until, data.Keyword)
	case "svn":
		commits, hasMore, err = loadSvnCommitsForQuery(ctx, repoPath, limit, offset, data.Since, data.Until, data.Keyword)
	}
	if err != nil {
		return nil, err
	}
	return &wshrpc.RemoteVcsCommitsRtnData{
		RepoPath: repoPath,
		RepoType: repoType,
		Commits:  commits,
		Offset:   offset,
		Limit:    limit,
		HasMore:  hasMore,
	}, nil
}

func (impl *ServerImpl) RemoteVcsCommitFilesCommand(
	ctx context.Context,
	data wshrpc.CommandRemoteVcsCommitFilesData,
) (*wshrpc.RemoteVcsCommitFilesRtnData, error) {
	repoPath, err := normalizeVcsBasePath(data.RepoPath)
	if err != nil {
		return nil, err
	}
	repoType := strings.ToLower(strings.TrimSpace(data.RepoType))
	if repoType == "" {
		repoType = detectRepoType(ctx, repoPath)
	}
	if repoType != "git" && repoType != "svn" {
		return nil, fmt.Errorf("unsupported repo type %q", repoType)
	}
	revision := strings.TrimSpace(data.Revision)
	if revision == "" {
		return nil, fmt.Errorf("revision is required")
	}
	var files []wshrpc.VcsCommitFileInfo
	switch repoType {
	case "git":
		files, err = loadGitCommitFiles(ctx, repoPath, revision)
	case "svn":
		files, err = loadSvnCommitFiles(ctx, repoPath, revision)
	}
	if err != nil {
		return nil, err
	}
	return &wshrpc.RemoteVcsCommitFilesRtnData{
		RepoPath: repoPath,
		RepoType: repoType,
		Revision: revision,
		Files:    files,
	}, nil
}

func (impl *ServerImpl) RemoteVcsCommitCommand(ctx context.Context, data wshrpc.CommandRemoteVcsCommitData) (*wshrpc.RemoteVcsCommitRtnData, error) {
	repoPath, err := normalizeVcsBasePath(data.RepoPath)
	if err != nil {
		return nil, err
	}
	repoType := strings.ToLower(strings.TrimSpace(data.RepoType))
	if repoType == "" {
		repoType = detectRepoType(ctx, repoPath)
	}
	if repoType != "git" && repoType != "svn" {
		return nil, fmt.Errorf("unsupported repo type %q", repoType)
	}
	commitMessage := strings.TrimSpace(data.Message)
	if commitMessage == "" {
		return &wshrpc.RemoteVcsCommitRtnData{
			Success: false,
			Error:   "commit message is required",
		}, nil
	}
	files := normalizeCommitPaths(repoPath, data.Files)
	if len(files) == 0 {
		return &wshrpc.RemoteVcsCommitRtnData{
			Success: false,
			Error:   "no files selected for commit",
		}, nil
	}
	var output string
	switch repoType {
	case "git":
		output, err = commitGit(ctx, repoPath, commitMessage, files)
	case "svn":
		output, err = commitSvn(ctx, repoPath, commitMessage, files)
	}
	if err != nil {
		return &wshrpc.RemoteVcsCommitRtnData{
			Success: false,
			Output:  output,
			Error:   err.Error(),
		}, nil
	}
	return &wshrpc.RemoteVcsCommitRtnData{
		Success: true,
		Output:  output,
	}, nil
}

func (impl *ServerImpl) RemoteVcsSyncCommand(ctx context.Context, data wshrpc.CommandRemoteVcsSyncData) (*wshrpc.RemoteVcsSyncRtnData, error) {
	repoPath, err := normalizeVcsBasePath(data.RepoPath)
	if err != nil {
		return nil, err
	}
	repoType := strings.ToLower(strings.TrimSpace(data.RepoType))
	if repoType == "" {
		repoType = detectRepoType(ctx, repoPath)
	}
	if repoType != "git" && repoType != "svn" {
		return nil, fmt.Errorf("unsupported repo type %q", repoType)
	}

	var output string
	action := strings.ToLower(strings.TrimSpace(data.Action))
	if action == "" {
		if repoType == "svn" {
			action = "update"
		} else {
			action = "pull"
		}
	}
	defaultOutput := ""
	switch repoType {
	case "git":
		switch action {
		case "fetch":
			output, err = runVcsCommandRaw(ctx, repoPath, "git", "fetch", "--prune")
			defaultOutput = "Fetch completed."
		case "pull":
			output, err = runVcsCommandRaw(ctx, repoPath, "git", "pull", "--ff-only")
			defaultOutput = "Pull completed."
		case "push":
			output, err = runVcsCommandRaw(ctx, repoPath, "git", "push")
			defaultOutput = "Push completed."
		default:
			return &wshrpc.RemoteVcsSyncRtnData{
				Success: false,
				Error:   fmt.Sprintf("unsupported git sync action %q", action),
			}, nil
		}
	case "svn":
		switch action {
		case "update":
			output, err = runVcsCommandRaw(ctx, repoPath, "svn", "update", "--accept", "postpone", "--non-interactive")
			defaultOutput = "Update completed."
		case "fetch":
			_, err = runSvnRemoteStatusXMLCommand(ctx, repoPath)
			output = ""
			defaultOutput = "Remote status checked."
		default:
			return &wshrpc.RemoteVcsSyncRtnData{
				Success: false,
				Error:   fmt.Sprintf("unsupported svn sync action %q", action),
			}, nil
		}
	}
	if err != nil {
		return &wshrpc.RemoteVcsSyncRtnData{
			Success: false,
			Output:  strings.TrimSpace(output),
			Error:   err.Error(),
		}, nil
	}
	trimmedOutput := strings.TrimSpace(output)
	if trimmedOutput == "" {
		trimmedOutput = defaultOutput
	}
	return &wshrpc.RemoteVcsSyncRtnData{
		Success: true,
		Output:  trimmedOutput,
	}, nil
}

func (impl *ServerImpl) RemoteVcsFileHistoryCommand(ctx context.Context, data wshrpc.CommandRemoteVcsFileHistoryData) (*wshrpc.RemoteVcsFileHistoryRtnData, error) {
	repoPath, err := normalizeVcsBasePath(data.RepoPath)
	if err != nil {
		return nil, err
	}
	repoType := strings.ToLower(strings.TrimSpace(data.RepoType))
	if repoType == "" {
		repoType = detectRepoType(ctx, repoPath)
	}
	if repoType != "git" && repoType != "svn" {
		return nil, fmt.Errorf("unsupported repo type %q", repoType)
	}
	filePath := strings.TrimSpace(data.FilePath)
	if filePath == "" {
		return nil, fmt.Errorf("filepath is required")
	}
	limit := data.Limit
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	var commits []wshrpc.VcsCommitInfo
	switch repoType {
	case "git":
		commits, err = loadGitCommits(ctx, repoPath, filePath, limit)
	case "svn":
		commits, err = loadSvnCommits(ctx, repoPath, filePath, limit)
	}
	if err != nil {
		return nil, err
	}
	return &wshrpc.RemoteVcsFileHistoryRtnData{
		RepoPath: repoPath,
		RepoType: repoType,
		FilePath: toRepoRelativePath(repoPath, filePath),
		Commits:  commits,
	}, nil
}

func loadGitDiff(ctx context.Context, repoPath string, filePath string, revision string) (string, error) {
	relPath := toRepoRelativePath(repoPath, filePath)
	if relPath == "" {
		return "", fmt.Errorf("filepath is required")
	}
	var out string
	var err error
	if strings.TrimSpace(revision) == "" {
		out, err = runVcsCommandRaw(ctx, repoPath, "git", "diff", "HEAD", "--", relPath)
	} else {
		out, err = runVcsCommandRaw(ctx, repoPath, "git", "show", "--pretty=format:", revision, "--", relPath)
	}
	if err != nil {
		return "", err
	}
	return out, nil
}

func loadSvnDiff(ctx context.Context, repoPath string, filePath string, revision string) (string, error) {
	relPath := toRepoRelativePath(repoPath, filePath)
	if relPath == "" {
		return "", fmt.Errorf("filepath is required")
	}
	trimmedRev := strings.TrimSpace(revision)
	if strings.HasPrefix(trimmedRev, "r") {
		trimmedRev = strings.TrimPrefix(trimmedRev, "r")
	}
	var out string
	var err error
	if trimmedRev == "" {
		out, err = runVcsCommandRaw(ctx, repoPath, "svn", "diff", relPath)
	} else {
		out, err = runVcsCommandRaw(ctx, repoPath, "svn", "diff", "-c", trimmedRev, relPath)
	}
	if err != nil {
		return "", err
	}
	return out, nil
}

func makeStringPtr(val string) *string {
	return &val
}

func toRepoAbsolutePath(repoPath string, relPath string) (string, error) {
	nativeRel := filepath.Clean(filepath.FromSlash(relPath))
	if nativeRel == "." || nativeRel == ".." || strings.HasPrefix(nativeRel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("filepath %q escapes repository", relPath)
	}
	return filepath.Join(repoPath, nativeRel), nil
}

func normalizeTextContent(content string) (string, error) {
	if strings.ContainsRune(content, '\x00') {
		return "", errVcsNonTextContent
	}
	if !utf8.ValidString(content) {
		return "", errVcsNonTextContent
	}
	return content, nil
}

func readWorkingTreeTextFile(repoPath string, relPath string) (string, error) {
	absPath, err := toRepoAbsolutePath(repoPath, relPath)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return "", errVcsNonTextContent
	}
	if !utf8.Valid(data) {
		return "", errVcsNonTextContent
	}
	return string(data), nil
}

func isGitPathMissingError(err error) bool {
	if err == nil {
		return false
	}
	lowerErr := strings.ToLower(err.Error())
	return strings.Contains(lowerErr, "does not exist in") ||
		strings.Contains(lowerErr, "exists on disk, but not in") ||
		strings.Contains(lowerErr, "unknown revision or path not in the working tree")
}

func isSvnPathMissingError(err error) bool {
	if err == nil {
		return false
	}
	lowerErr := strings.ToLower(err.Error())
	return strings.Contains(lowerErr, "non-existent") ||
		strings.Contains(lowerErr, "path not found") ||
		strings.Contains(lowerErr, "not under version control") ||
		strings.Contains(lowerErr, "e200009")
}

func loadGitFileAtRevision(ctx context.Context, repoPath string, relPath string, revision string) (string, error) {
	showSpec := fmt.Sprintf("%s:%s", revision, relPath)
	out, err := runVcsCommandRaw(ctx, repoPath, "git", "show", showSpec)
	if err != nil {
		return "", err
	}
	return normalizeTextContent(out)
}

func loadSvnFileAtRevision(ctx context.Context, repoPath string, relPath string, revision string) (string, error) {
	out, err := runVcsCommandRaw(ctx, repoPath, "svn", "cat", "-r", revision, relPath)
	if err != nil {
		return "", err
	}
	return normalizeTextContent(out)
}

func loadGitDiffContentPair(ctx context.Context, repoPath string, filePath string, revision string) (*string, *string) {
	relPath := toRepoRelativePath(repoPath, filePath)
	if relPath == "" {
		return nil, nil
	}
	trimmedRevision := strings.TrimSpace(revision)
	if trimmedRevision == "" {
		original, originalErr := loadGitFileAtRevision(ctx, repoPath, relPath, "HEAD")
		modified, modifiedErr := readWorkingTreeTextFile(repoPath, relPath)
		if isGitPathMissingError(originalErr) {
			original = ""
			originalErr = nil
		}
		if errors.Is(modifiedErr, os.ErrNotExist) {
			modified = ""
			modifiedErr = nil
		}
		if errors.Is(originalErr, errVcsNonTextContent) || errors.Is(modifiedErr, errVcsNonTextContent) {
			return nil, nil
		}
		if originalErr != nil || modifiedErr != nil {
			return nil, nil
		}
		return makeStringPtr(original), makeStringPtr(modified)
	}
	parentRevision := trimmedRevision + "^"
	original, originalErr := loadGitFileAtRevision(ctx, repoPath, relPath, parentRevision)
	modified, modifiedErr := loadGitFileAtRevision(ctx, repoPath, relPath, trimmedRevision)
	if isGitPathMissingError(originalErr) {
		original = ""
		originalErr = nil
	}
	if isGitPathMissingError(modifiedErr) {
		modified = ""
		modifiedErr = nil
	}
	if errors.Is(originalErr, errVcsNonTextContent) || errors.Is(modifiedErr, errVcsNonTextContent) {
		return nil, nil
	}
	if originalErr != nil || modifiedErr != nil {
		return nil, nil
	}
	return makeStringPtr(original), makeStringPtr(modified)
}

func parseSvnRevision(revision string) int {
	trimmed := strings.TrimSpace(revision)
	trimmed = strings.TrimPrefix(strings.ToLower(trimmed), "r")
	if trimmed == "" {
		return 0
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed < 0 {
		return 0
	}
	return parsed
}

func loadSvnDiffContentPair(ctx context.Context, repoPath string, filePath string, revision string) (*string, *string) {
	relPath := toRepoRelativePath(repoPath, filePath)
	if relPath == "" {
		return nil, nil
	}
	trimmedRevision := strings.TrimSpace(revision)
	if trimmedRevision == "" {
		original, originalErr := loadSvnFileAtRevision(ctx, repoPath, relPath, "BASE")
		modified, modifiedErr := readWorkingTreeTextFile(repoPath, relPath)
		if isSvnPathMissingError(originalErr) {
			original = ""
			originalErr = nil
		}
		if errors.Is(modifiedErr, os.ErrNotExist) {
			modified = ""
			modifiedErr = nil
		}
		if errors.Is(originalErr, errVcsNonTextContent) || errors.Is(modifiedErr, errVcsNonTextContent) {
			return nil, nil
		}
		if originalErr != nil || modifiedErr != nil {
			return nil, nil
		}
		return makeStringPtr(original), makeStringPtr(modified)
	}
	revisionNum := parseSvnRevision(trimmedRevision)
	if revisionNum == 0 {
		return nil, nil
	}
	modified, modifiedErr := loadSvnFileAtRevision(ctx, repoPath, relPath, strconv.Itoa(revisionNum))
	if isSvnPathMissingError(modifiedErr) {
		modified = ""
		modifiedErr = nil
	}
	original := ""
	var originalErr error
	if revisionNum > 1 {
		original, originalErr = loadSvnFileAtRevision(ctx, repoPath, relPath, strconv.Itoa(revisionNum-1))
		if isSvnPathMissingError(originalErr) {
			original = ""
			originalErr = nil
		}
	}
	if errors.Is(originalErr, errVcsNonTextContent) || errors.Is(modifiedErr, errVcsNonTextContent) {
		return nil, nil
	}
	if originalErr != nil || modifiedErr != nil {
		return nil, nil
	}
	return makeStringPtr(original), makeStringPtr(modified)
}

func (impl *ServerImpl) RemoteVcsFileDiffCommand(ctx context.Context, data wshrpc.CommandRemoteVcsFileDiffData) (*wshrpc.RemoteVcsFileDiffRtnData, error) {
	repoPath, err := normalizeVcsBasePath(data.RepoPath)
	if err != nil {
		return nil, err
	}
	repoType := strings.ToLower(strings.TrimSpace(data.RepoType))
	if repoType == "" {
		repoType = detectRepoType(ctx, repoPath)
	}
	if repoType != "git" && repoType != "svn" {
		return nil, fmt.Errorf("unsupported repo type %q", repoType)
	}
	filePath := strings.TrimSpace(data.FilePath)
	if filePath == "" {
		return nil, fmt.Errorf("filepath is required")
	}
	revision := strings.TrimSpace(data.Revision)
	var diffText string
	var originalText *string
	var modifiedText *string
	switch repoType {
	case "git":
		diffText, err = loadGitDiff(ctx, repoPath, filePath, revision)
		originalText, modifiedText = loadGitDiffContentPair(ctx, repoPath, filePath, revision)
	case "svn":
		diffText, err = loadSvnDiff(ctx, repoPath, filePath, revision)
		originalText, modifiedText = loadSvnDiffContentPair(ctx, repoPath, filePath, revision)
	}
	if err != nil {
		return nil, err
	}
	return &wshrpc.RemoteVcsFileDiffRtnData{
		RepoPath: repoPath,
		RepoType: repoType,
		FilePath: toRepoRelativePath(repoPath, filePath),
		Diff:     diffText,
		Original: originalText,
		Modified: modifiedText,
	}, nil
}
