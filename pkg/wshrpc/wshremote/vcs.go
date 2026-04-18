// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	DefaultVcsScanDepth   = 3
	DefaultVcsStatusLimit = 200
	DefaultVcsCommitLimit = 50
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

func normalizeVcsBasePath(path string) (string, error) {
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

func detectGitRoot(ctx context.Context, path string) string {
	out, err := runVcsCommand(ctx, path, "git", "rev-parse", "--show-toplevel")
	if err != nil || out == "" {
		return ""
	}
	return filepath.Clean(out)
}

func detectSvnRoot(ctx context.Context, path string) string {
	out, err := runVcsCommand(ctx, path, "svn", "info", "--show-item", "wc-root")
	if err == nil && out != "" {
		return filepath.Clean(out)
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
	return filepath.Clean(info.Entries[0].WcInfo.WcRootAbsPath)
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

func detectRepoRoots(ctx context.Context, basePath string, scanDepth int, includeParent bool) []string {
	if scanDepth <= 0 {
		scanDepth = DefaultVcsScanDepth
	}
	repoSet := make(map[string]struct{})
	addRepo := func(path string) {
		cleanPath := filepath.Clean(path)
		if cleanPath == "" || cleanPath == "." {
			return
		}
		repoSet[cleanPath] = struct{}{}
	}
	if includeParent {
		if gitRoot := detectGitRoot(ctx, basePath); gitRoot != "" {
			addRepo(gitRoot)
		}
		if svnRoot := detectSvnRoot(ctx, basePath); svnRoot != "" {
			addRepo(svnRoot)
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
				addRepo(filepath.Dir(path))
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
			addRepo(filepath.Dir(path))
		}
		return nil
	})
	repos := make([]string, 0, len(repoSet))
	for repo := range repoSet {
		repos = append(repos, repo)
	}
	sort.Strings(repos)
	if len(repos) > MaxVcsRepos {
		repos = repos[:MaxVcsRepos]
	}
	return repos
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

func loadSvnRepoState(ctx context.Context, repoPath string, statusLimit int) (string, []wshrpc.VcsFileStatus, error) {
	branch, branchErr := runVcsCommand(ctx, repoPath, "svn", "info", "--show-item", "relative-url")
	if branchErr != nil || branch == "" {
		branch, branchErr = runVcsCommand(ctx, repoPath, "svn", "info", "--show-item", "url")
		if branchErr != nil {
			return "", nil, branchErr
		}
	}
	statusOut, statusErr := runVcsCommand(ctx, repoPath, "svn", "status")
	if statusErr != nil {
		return branch, nil, statusErr
	}
	return branch, parseSvnStatus(statusOut, statusLimit), nil
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
	trimmed := strings.TrimSpace(strings.Trim(filePath, "\""))
	if trimmed == "" {
		return ""
	}
	cleanPath := filepath.Clean(trimmed)
	if filepath.IsAbs(cleanPath) {
		relPath, err := filepath.Rel(repoPath, cleanPath)
		if err == nil && relPath != "." && !strings.HasPrefix(relPath, "..") {
			return filepath.ToSlash(relPath)
		}
	}
	return filepath.ToSlash(cleanPath)
}

func loadGitCommits(ctx context.Context, repoPath string, filePath string, limit int) ([]wshrpc.VcsCommitInfo, error) {
	if limit <= 0 {
		limit = DefaultVcsCommitLimit
	}
	if limit > 500 {
		limit = 500
	}
	args := []string{
		"log",
		"--date=iso-strict",
		"--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1e",
		"-n",
		strconv.Itoa(limit),
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
	if limit > 500 {
		limit = 500
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
		repoType := detectRepoType(ctx, repoRoot)
		if repoType == "" {
			continue
		}
		repoInfo := wshrpc.VcsRepositoryInfo{
			RepoId:   repoRootId(repoType, repoRoot),
			RepoType: repoType,
			RootPath: repoRoot,
			Name:     filepath.Base(repoRoot),
		}
		if repoInfo.Name == "" || repoInfo.Name == "." {
			repoInfo.Name = repoRoot
		}
		switch repoType {
		case "git":
			branch, status, statusErr := loadGitRepoState(ctx, repoRoot, statusLimit)
			remoteUrl, browseUrl := loadGitRemoteUrls(ctx, repoRoot)
			repoInfo.Branch = branch
			repoInfo.RemoteUrl = remoteUrl
			repoInfo.BrowseUrl = browseUrl
			repoInfo.Status = status
			if statusErr != nil {
				repoInfo.StatusErr = statusErr.Error()
			}
		case "svn":
			branch, status, statusErr := loadSvnRepoState(ctx, repoRoot, statusLimit)
			remoteUrl, browseUrl := loadSvnRemoteUrls(ctx, repoRoot)
			repoInfo.Branch = branch
			repoInfo.RemoteUrl = remoteUrl
			repoInfo.BrowseUrl = browseUrl
			repoInfo.Status = status
			if statusErr != nil {
				repoInfo.StatusErr = statusErr.Error()
			}
		}
		repositories = append(repositories, repoInfo)
	}
	sort.Slice(repositories, func(i, j int) bool {
		return repositories[i].RootPath < repositories[j].RootPath
	})
	return &wshrpc.RemoteVcsRepositoriesRtnData{
		BasePath:     basePath,
		Repositories: repositories,
	}, nil
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
	var commits []wshrpc.VcsCommitInfo
	switch repoType {
	case "git":
		commits, err = loadGitCommits(ctx, repoPath, "", limit)
	case "svn":
		commits, err = loadSvnCommits(ctx, repoPath, "", limit)
	}
	if err != nil {
		return nil, err
	}
	return &wshrpc.RemoteVcsCommitsRtnData{
		RepoPath: repoPath,
		RepoType: repoType,
		Commits:  commits,
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
