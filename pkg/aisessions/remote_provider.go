// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"path"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const remoteSessionReadLimit = 16 * 1024 * 1024

type remoteFileReader interface {
	SearchNames(ctx context.Context, basePath string, query string, limit int) ([]wshrpc.FileNameSearchMatch, error)
	ReadFile(ctx context.Context, path string, maxSize int64) ([]byte, *wshrpc.FileInfo, error)
}

type rpcRemoteFileReader struct {
	connection string
	route      string
}

func newRPCRemoteFileReader(connection string) (*rpcRemoteFileReader, error) {
	connection = strings.TrimSpace(connection)
	if connection == "" || connection == wshrpc.LocalConnName || strings.HasPrefix(connection, "local:") {
		return nil, fmt.Errorf("remote connection is required")
	}
	return &rpcRemoteFileReader{
		connection: connection,
		route:      wshutil.MakeConnectionRouteId(connection),
	}, nil
}

func (r *rpcRemoteFileReader) SearchNames(
	ctx context.Context,
	basePath string,
	query string,
	limit int,
) ([]wshrpc.FileNameSearchMatch, error) {
	ch := wshclient.RemoteFileNameSearchStreamCommand(
		wshfs.RpcClient,
		wshrpc.CommandRemoteFileNameSearchData{
			Path:          basePath,
			Query:         query,
			Limit:         limit,
			IncludeHidden: true,
		},
		&wshrpc.RpcOpts{Route: r.route},
	)
	var matches []wshrpc.FileNameSearchMatch
	for resp := range ch {
		if ctx.Err() != nil {
			return matches, ctx.Err()
		}
		if resp.Error != nil {
			return matches, resp.Error
		}
		matches = append(matches, resp.Response.Matches...)
	}
	return matches, nil
}

func (r *rpcRemoteFileReader) ReadFile(
	ctx context.Context,
	filePath string,
	maxSize int64,
) ([]byte, *wshrpc.FileInfo, error) {
	data, err := wshfs.Read(ctx, wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: fmt.Sprintf("wsh://%s/%s", r.connection, strings.TrimPrefix(filePath, "/")),
		},
		At: &wshrpc.FileDataAt{
			Offset: 0,
			Size:   int(maxSize),
		},
	})
	if err != nil {
		return nil, nil, err
	}
	if data == nil || data.Info == nil {
		return nil, nil, fmt.Errorf("empty remote file response")
	}
	if data.Info.IsDir {
		return nil, data.Info, fmt.Errorf("remote session path is a directory: %s", filePath)
	}
	if data.Info.NotFound {
		return nil, data.Info, fmt.Errorf("remote session file not found: %s", filePath)
	}
	if maxSize > 0 && data.Info.Size > maxSize {
		return nil, data.Info, fmt.Errorf("remote session file %q is too large (%d bytes)", filePath, data.Info.Size)
	}
	raw, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return nil, data.Info, fmt.Errorf("cannot decode remote session file %q: %w", filePath, err)
	}
	return raw, data.Info, nil
}

type RemoteProviderOptions struct {
	Connection  string
	HomeDir     string
	FileReader  remoteFileReader
	SearchLimit int
}

type RemoteProvider struct {
	connection string
	homeDir    string
	reader     remoteFileReader
	limit      int
}

func NewRemoteProvider(opts RemoteProviderOptions) (*RemoteProvider, error) {
	reader := opts.FileReader
	if reader == nil {
		var err error
		reader, err = newRPCRemoteFileReader(opts.Connection)
		if err != nil {
			return nil, err
		}
	}
	homeDir := strings.TrimSpace(opts.HomeDir)
	if homeDir == "" {
		homeDir = "~"
	}
	limit := opts.SearchLimit
	if limit <= 0 {
		limit = 200
	}
	return &RemoteProvider{
		connection: strings.TrimSpace(opts.Connection),
		homeDir:    strings.TrimRight(homeDir, "/"),
		reader:     reader,
		limit:      limit,
	}, nil
}

func (p *RemoteProvider) Source() string {
	return "remote"
}

func (p *RemoteProvider) SupportsSource(source string) bool {
	return source == SourceCodex || source == SourceClaude
}

func (p *RemoteProvider) List(ctx context.Context) ([]SessionSummary, error) {
	var summaries []SessionSummary
	summaryMap := make(map[string]SessionSummary)
	for _, summary := range p.listSource(ctx, SourceCodex) {
		summaryMap[summary.Key] = summary
	}
	for _, summary := range p.listSource(ctx, SourceClaude) {
		summaryMap[summary.Key] = summary
	}
	for _, summary := range summaryMap {
		summaries = append(summaries, summary)
	}
	sortSummaries(summaries)
	return summaries, nil
}

func (p *RemoteProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	source, remotePath, ok := splitRemoteSessionPath(filePath)
	if !ok {
		return nil, fmt.Errorf("invalid remote session path: %s", filePath)
	}
	raw, _, err := p.reader.ReadFile(ctx, remotePath, remoteSessionReadLimit)
	if err != nil {
		return nil, err
	}
	switch source {
	case SourceCodex:
		return parseCodexMessages(ctx, bytes.NewReader(raw))
	case SourceClaude:
		return parseClaudeMessages(ctx, bytes.NewReader(raw))
	default:
		return nil, fmt.Errorf("unsupported remote AI session source %q", source)
	}
}

func (p *RemoteProvider) listSource(ctx context.Context, source string) []SessionSummary {
	var summaries []SessionSummary
	for _, root := range p.rootsForSource(source) {
		matches, err := p.reader.SearchNames(ctx, root, ".jsonl", p.limit)
		if err != nil {
			continue
		}
		for _, match := range matches {
			if ctx.Err() != nil {
				return summaries
			}
			if match.IsDir || !strings.EqualFold(path.Ext(match.Path), ".jsonl") {
				continue
			}
			if source == SourceClaude && isClaudeAgentSession(match.Path) {
				continue
			}
			summary, ok := p.parseSummary(ctx, source, match.Path)
			if ok {
				summaries = append(summaries, summary)
			}
		}
	}
	return summaries
}

func (p *RemoteProvider) parseSummary(ctx context.Context, source string, remotePath string) (SessionSummary, bool) {
	raw, info, err := p.reader.ReadFile(ctx, remotePath, remoteSessionReadLimit)
	if err != nil {
		return SessionSummary{}, false
	}
	lines, err := readAllLines(bytes.NewReader(raw))
	if err != nil {
		return SessionSummary{}, false
	}
	mtime := int64(0)
	size := int64(len(raw))
	if info != nil {
		mtime = info.ModTime
		size = info.Size
	}
	stablePath := makeRemoteSessionPath(source, p.connection, remotePath)
	head := cloneLinesPrefix(lines, 10)
	tail := cloneLinesSuffix(lines, 30)
	switch source {
	case SourceCodex:
		return NewCodexProvider("").parseSummaryFromLines(stablePath, head, tail, mtime, size)
	case SourceClaude:
		return NewClaudeProvider(nil).parseSummaryFromLines(stablePath, head, tail, mtime, size)
	default:
		return SessionSummary{}, false
	}
}

func (p *RemoteProvider) rootsForSource(source string) []string {
	switch source {
	case SourceCodex:
		return []string{path.Join(p.homeDir, ".codex", "sessions")}
	case SourceClaude:
		return []string{
			path.Join(p.homeDir, ".claude", "projects"),
			path.Join(p.homeDir, ".cache", "claude", "projects"),
		}
	default:
		return nil
	}
}

func makeRemoteSessionPath(source string, connection string, remotePath string) string {
	return fmt.Sprintf("remote:%s:%s:%s", source, base64.RawURLEncoding.EncodeToString([]byte(connection)), remotePath)
}

func splitRemoteSessionPath(filePath string) (source string, remotePath string, ok bool) {
	if !strings.HasPrefix(filePath, "remote:") {
		return "", filePath, false
	}
	parts := strings.SplitN(filePath, ":", 4)
	if len(parts) != 4 || parts[1] == "" || parts[3] == "" {
		return "", "", false
	}
	return parts[1], parts[3], true
}
