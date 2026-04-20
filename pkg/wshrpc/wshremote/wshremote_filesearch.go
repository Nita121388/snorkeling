// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	defaultFileSearchLimit     = 500
	maxFileSearchLimit         = 2000
	defaultFileSearchMaxSize   = 1024 * 1024
	maxFileSearchScannerBuffer = 4 * 1024 * 1024
	fileSearchChunkSize        = 50
)

var errFileSearchLimitReached = errors.New("file search limit reached")

type rgJSONPayload struct {
	Text string `json:"text"`
}

type rgJSONLine struct {
	Type string `json:"type"`
	Data struct {
		Path struct {
			Text string `json:"text"`
		} `json:"path"`
		Lines      rgJSONPayload `json:"lines"`
		LineNumber int           `json:"line_number"`
	} `json:"data"`
}

type fileSearchCollector struct {
	ch        chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteFileSearchRtnData]
	chunk     []wshrpc.FileSearchMatch
	total     int
	limit     int
	truncated bool
}

func normalizeRemoteFileSearchData(data wshrpc.CommandRemoteFileSearchData) (string, wshrpc.CommandRemoteFileSearchData, error) {
	if strings.TrimSpace(data.Query) == "" {
		return "", data, fmt.Errorf("query is required")
	}
	if data.Limit <= 0 {
		data.Limit = defaultFileSearchLimit
	}
	if data.Limit > maxFileSearchLimit {
		data.Limit = maxFileSearchLimit
	}
	if data.MaxFileSize <= 0 {
		data.MaxFileSize = defaultFileSearchMaxSize
	}
	expandedPath, err := wavebase.ExpandHomeDir(data.Path)
	if err != nil {
		return "", data, fmt.Errorf("cannot expand path %q: %w", data.Path, err)
	}
	cleanPath := filepath.Clean(expandedPath)
	stat, err := os.Stat(cleanPath)
	if err != nil {
		return "", data, fmt.Errorf("cannot access %q: %w", cleanPath, err)
	}
	if stat.IsDir() {
		return cleanPath, data, nil
	}
	return filepath.Dir(cleanPath), data, nil
}

func newFileSearchCollector(ch chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteFileSearchRtnData], limit int) *fileSearchCollector {
	return &fileSearchCollector{
		ch:    ch,
		chunk: make([]wshrpc.FileSearchMatch, 0, fileSearchChunkSize),
		limit: limit,
	}
}

func (c *fileSearchCollector) add(match wshrpc.FileSearchMatch) error {
	if c.total >= c.limit {
		c.truncated = true
		return errFileSearchLimitReached
	}
	c.chunk = append(c.chunk, match)
	c.total++
	if len(c.chunk) >= fileSearchChunkSize {
		c.flush(false)
	}
	if c.total >= c.limit {
		c.truncated = true
		return errFileSearchLimitReached
	}
	return nil
}

func (c *fileSearchCollector) flush(truncated bool) {
	if len(c.chunk) == 0 && !truncated {
		return
	}
	resp := wshrpc.CommandRemoteFileSearchRtnData{
		Matches:   c.chunk,
		Truncated: truncated,
	}
	c.ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteFileSearchRtnData]{Response: resp}
	c.chunk = make([]wshrpc.FileSearchMatch, 0, fileSearchChunkSize)
}

func shouldSkipFileSearchPath(name string, includeHidden bool, isDir bool) bool {
	if name == ".git" || name == ".svn" {
		return true
	}
	if !includeHidden && strings.HasPrefix(name, ".") {
		return true
	}
	if isDir {
		return shouldSkipVcsScanDir(name)
	}
	return false
}

func hasUppercaseLetters(s string) bool {
	for _, r := range s {
		if unicode.IsUpper(r) {
			return true
		}
	}
	return false
}

func makeFileSearchMatch(basePath string, path string, lineNumber int, lineText string) wshrpc.FileSearchMatch {
	cleanPath := filepath.Clean(path)
	relPath, err := filepath.Rel(basePath, cleanPath)
	if err != nil || relPath == "." {
		relPath = filepath.Base(cleanPath)
	}
	return wshrpc.FileSearchMatch{
		Path:       cleanPath,
		RelPath:    relPath,
		LineNumber: lineNumber,
		LineText:   strings.TrimRight(lineText, "\r\n"),
	}
}

func parseRipgrepJSONLine(basePath string, line []byte) (*wshrpc.FileSearchMatch, error) {
	var msg rgJSONLine
	if err := json.Unmarshal(line, &msg); err != nil {
		return nil, err
	}
	if msg.Type != "match" {
		return nil, nil
	}
	matchPath := filepath.Clean(filepath.Join(basePath, msg.Data.Path.Text))
	match := makeFileSearchMatch(basePath, matchPath, msg.Data.LineNumber, msg.Data.Lines.Text)
	return &match, nil
}

func runRipgrepFileSearch(ctx context.Context, basePath string, data wshrpc.CommandRemoteFileSearchData, collector *fileSearchCollector) (bool, error) {
	if _, err := exec.LookPath("rg"); err != nil {
		return false, nil
	}
	searchCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	args := []string{
		"--json",
		"--line-number",
		"--with-filename",
		"--smart-case",
		"--color=never",
		"--max-filesize", fmt.Sprintf("%d", data.MaxFileSize),
		"--glob", "!**/.git/**",
		"--glob", "!**/.svn/**",
		"--glob", "!**/node_modules/**",
		"--glob", "!**/dist/**",
		"--glob", "!**/build/**",
		"--glob", "!**/target/**",
		"--glob", "!**/vendor/**",
		"--glob", "!**/.venv/**",
	}
	if data.IncludeHidden {
		args = append(args, "--hidden")
	}
	args = append(args, "--", data.Query, ".")
	cmd := exec.CommandContext(searchCtx, "rg", args...)
	cmd.Dir = basePath
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return true, err
	}
	if err := cmd.Start(); err != nil {
		return true, err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), maxFileSearchScannerBuffer)
	limitHit := false
	for scanner.Scan() {
		if ctx.Err() != nil {
			cancel()
			break
		}
		match, err := parseRipgrepJSONLine(basePath, scanner.Bytes())
		if err != nil || match == nil {
			continue
		}
		if err := collector.add(*match); err != nil {
			if errors.Is(err, errFileSearchLimitReached) {
				limitHit = true
				cancel()
				break
			}
			cancel()
			return true, err
		}
	}
	if scanErr := scanner.Err(); scanErr != nil && !limitHit {
		cancel()
		return true, scanErr
	}
	waitErr := cmd.Wait()
	if limitHit {
		collector.flush(true)
		return true, nil
	}
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	if waitErr == nil {
		return true, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) && exitErr.ExitCode() == 1 {
		return true, nil
	}
	errMsg := strings.TrimSpace(stderr.String())
	if errMsg == "" {
		errMsg = waitErr.Error()
	}
	return true, fmt.Errorf("rg: %s", errMsg)
}

func searchFileWithGo(basePath string, path string, fileSize int64, data wshrpc.CommandRemoteFileSearchData, collector *fileSearchCollector) error {
	if fileSize > data.MaxFileSize {
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	sample := make([]byte, 8192)
	n, _ := file.Read(sample)
	if bytes.IndexByte(sample[:n], 0) >= 0 {
		return nil
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil
	}
	query := data.Query
	caseSensitive := hasUppercaseLetters(query)
	lowerQuery := strings.ToLower(query)
	scanner := bufio.NewScanner(file)
	maxBuffer := int(data.MaxFileSize) + 1024
	if maxBuffer > maxFileSearchScannerBuffer {
		maxBuffer = maxFileSearchScannerBuffer
	}
	scanner.Buffer(make([]byte, 0, 64*1024), maxBuffer)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := scanner.Text()
		matched := strings.Contains(line, query)
		if !caseSensitive {
			matched = strings.Contains(strings.ToLower(line), lowerQuery)
		}
		if !matched {
			continue
		}
		match := makeFileSearchMatch(basePath, path, lineNumber, line)
		if err := collector.add(match); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return nil
	}
	return nil
}

func runFallbackFileSearch(ctx context.Context, basePath string, data wshrpc.CommandRemoteFileSearchData, collector *fileSearchCollector) error {
	return filepath.WalkDir(basePath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		name := entry.Name()
		if entry.IsDir() {
			if path != basePath && shouldSkipFileSearchPath(name, data.IncludeHidden, true) {
				return filepath.SkipDir
			}
			return nil
		}
		if shouldSkipFileSearchPath(name, data.IncludeHidden, false) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if err := searchFileWithGo(basePath, path, info.Size(), data, collector); err != nil {
			if errors.Is(err, errFileSearchLimitReached) {
				return err
			}
			return nil
		}
		return nil
	})
}

func (impl *ServerImpl) RemoteFileSearchStreamCommand(ctx context.Context, data wshrpc.CommandRemoteFileSearchData) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteFileSearchRtnData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteFileSearchRtnData], 16)
	go func() {
		defer func() {
			panichandler.PanicHandler("RemoteFileSearchStreamCommand", recover())
		}()
		defer close(ch)

		basePath, normalizedData, err := normalizeRemoteFileSearchData(data)
		if err != nil {
			ch <- wshutil.RespErr[wshrpc.CommandRemoteFileSearchRtnData](err)
			return
		}
		collector := newFileSearchCollector(ch, normalizedData.Limit)
		if usedRipgrep, err := runRipgrepFileSearch(ctx, basePath, normalizedData, collector); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			ch <- wshutil.RespErr[wshrpc.CommandRemoteFileSearchRtnData](err)
			return
		} else if !usedRipgrep {
			err = runFallbackFileSearch(ctx, basePath, normalizedData, collector)
			if err != nil && !errors.Is(err, errFileSearchLimitReached) && !errors.Is(err, context.Canceled) {
				ch <- wshutil.RespErr[wshrpc.CommandRemoteFileSearchRtnData](err)
				return
			}
			if errors.Is(err, errFileSearchLimitReached) {
				collector.truncated = true
			}
			if errors.Is(err, context.Canceled) {
				return
			}
			if collector.truncated {
				collector.flush(true)
				return
			}
		}
		if ctx.Err() != nil {
			return
		}
		collector.flush(false)
	}()
	return ch
}
