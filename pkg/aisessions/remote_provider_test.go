// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type fakeRemoteFileReader struct {
	files map[string][]byte
	info  map[string]*wshrpc.FileInfo
}

func (r *fakeRemoteFileReader) SearchNames(
	ctx context.Context,
	basePath string,
	query string,
	limit int,
) ([]wshrpc.FileNameSearchMatch, error) {
	var matches []wshrpc.FileNameSearchMatch
	for filePath := range r.files {
		if ctx.Err() != nil {
			return matches, ctx.Err()
		}
		if !strings.HasPrefix(filePath, strings.TrimRight(basePath, "/")+"/") {
			continue
		}
		if !strings.Contains(filePath, query) {
			continue
		}
		matches = append(matches, wshrpc.FileNameSearchMatch{Path: filePath})
		if limit > 0 && len(matches) >= limit {
			break
		}
	}
	return matches, nil
}

func (r *fakeRemoteFileReader) ReadFile(
	ctx context.Context,
	filePath string,
	maxSize int64,
) ([]byte, *wshrpc.FileInfo, error) {
	return r.ReadFileRange(ctx, filePath, 0, int(maxSize))
}

func (r *fakeRemoteFileReader) ReadFileRange(
	ctx context.Context,
	filePath string,
	offset int64,
	size int,
) ([]byte, *wshrpc.FileInfo, error) {
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	raw, ok := r.files[filePath]
	if !ok {
		return nil, nil, fmt.Errorf("not found: %s", filePath)
	}
	info := r.info[filePath]
	if info == nil {
		info = &wshrpc.FileInfo{Path: filePath, Size: int64(len(raw))}
	}
	if offset > int64(len(raw)) {
		return nil, info, nil
	}
	raw = raw[offset:]
	if size > 0 && len(raw) > size {
		raw = raw[:size]
	}
	return raw, info, nil
}

func TestRemoteProviderListsAndLoadsCodexSession(t *testing.T) {
	sessionPath := "/home/tester/.codex/sessions/2026/05/29/rollout-remote-session.jsonl"
	reader := &fakeRemoteFileReader{
		files: map[string][]byte{
			sessionPath: []byte(strings.Join([]string{
				`{"timestamp":"2026-05-29T00:00:00Z","type":"session_meta","payload":{"id":"remote-session","cwd":"/srv/project"}}`,
				`{"timestamp":"2026-05-29T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":"Remote user request"}}`,
				`{"timestamp":"2026-05-29T00:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Remote answer"}}`,
			}, "\n") + "\n"),
		},
		info: map[string]*wshrpc.FileInfo{
			sessionPath: {Path: sessionPath, Size: 300, ModTime: 1234},
		},
	}
	provider, err := NewRemoteProvider(RemoteProviderOptions{
		Connection: "ssh://example",
		HomeDir:    "/home/tester",
		FileReader: reader,
	})
	if err != nil {
		t.Fatal(err)
	}

	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected one summary, got %#v", summaries)
	}
	summary := summaries[0]
	if summary.ID != "remote-session" || summary.Source != SourceCodex || summary.ProjectPath != "/srv/project" {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if !strings.Contains(summary.Key, "remote:codex:c3NoOi8vZXhhbXBsZQ:") {
		t.Fatalf("expected remote key, got %q", summary.Key)
	}

	messages, err := provider.LoadMessages(context.Background(), summary.FilePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].Text != "Remote user request" {
		t.Fatalf("unexpected messages: %#v", messages)
	}
}
