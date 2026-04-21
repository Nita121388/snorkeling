package wshremote

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func collectFileNameSearch(t *testing.T, data wshrpc.CommandRemoteFileNameSearchData) ([]wshrpc.FileNameSearchMatch, bool) {
	t.Helper()

	basePath, normalizedData, err := normalizeRemoteFileNameSearchData(data)
	if err != nil {
		t.Fatalf("normalizeRemoteFileNameSearchData: %v", err)
	}

	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteFileNameSearchRtnData], 16)
	collector := newFileNameSearchCollector(ch, normalizedData.Limit)
	err = runFileNameSearch(context.Background(), basePath, normalizedData, collector)
	if err != nil && !errors.Is(err, errFileSearchLimitReached) {
		t.Fatalf("runFileNameSearch: %v", err)
	}
	if errors.Is(err, errFileSearchLimitReached) {
		collector.truncated = true
	}
	collector.flush(collector.truncated)
	close(ch)

	var matches []wshrpc.FileNameSearchMatch
	truncated := false
	for packet := range ch {
		if packet.Error != nil {
			t.Fatalf("stream packet error: %v", packet.Error)
		}
		matches = append(matches, packet.Response.Matches...)
		truncated = truncated || packet.Response.Truncated
	}
	slices.SortFunc(matches, func(left, right wshrpc.FileNameSearchMatch) int {
		return compareString(left.RelPath, right.RelPath)
	})
	return matches, truncated
}

func compareString(left string, right string) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func TestRunFileNameSearchMatchesNamesAndSkipsHidden(t *testing.T) {
	root := t.TempDir()
	paths := []string{
		filepath.Join(root, "configs"),
		filepath.Join(root, "nested"),
		filepath.Join(root, ".hidden"),
	}
	for _, path := range paths {
		if err := os.Mkdir(path, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
	}
	files := []string{
		filepath.Join(root, "app-config.ts"),
		filepath.Join(root, "nested", "ConfigMap.yaml"),
		filepath.Join(root, ".hidden", "config-secret.txt"),
	}
	for _, path := range files {
		if err := os.WriteFile(path, []byte("test"), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	matches, truncated := collectFileNameSearch(t, wshrpc.CommandRemoteFileNameSearchData{
		Path:          root,
		Query:         "config",
		IncludeHidden: false,
	})

	if truncated {
		t.Fatalf("expected non-truncated result set")
	}
	gotRelPaths := make([]string, 0, len(matches))
	for _, match := range matches {
		gotRelPaths = append(gotRelPaths, match.RelPath)
	}
	wantRelPaths := []string{"app-config.ts", "configs", filepath.Join("nested", "ConfigMap.yaml")}
	if !slices.Equal(gotRelPaths, wantRelPaths) {
		t.Fatalf("expected relpaths %v, got %v", wantRelPaths, gotRelPaths)
	}
	if !matches[1].IsDir {
		t.Fatalf("expected %q to be a directory match", matches[1].RelPath)
	}
}

func TestRunFileNameSearchUsesSmartCaseAndLimit(t *testing.T) {
	root := t.TempDir()
	files := []string{
		filepath.Join(root, "config-alpha.txt"),
		filepath.Join(root, "ConfigBeta.txt"),
		filepath.Join(root, "config-gamma.txt"),
	}
	for _, path := range files {
		if err := os.WriteFile(path, []byte("test"), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	caseSensitiveMatches, truncated := collectFileNameSearch(t, wshrpc.CommandRemoteFileNameSearchData{
		Path:  root,
		Query: "Config",
	})
	if truncated {
		t.Fatalf("expected non-truncated result set")
	}
	if len(caseSensitiveMatches) != 1 || caseSensitiveMatches[0].RelPath != "ConfigBeta.txt" {
		t.Fatalf("expected only ConfigBeta.txt, got %#v", caseSensitiveMatches)
	}

	limitedMatches, truncated := collectFileNameSearch(t, wshrpc.CommandRemoteFileNameSearchData{
		Path:  root,
		Query: "config",
		Limit: 2,
	})
	if !truncated {
		t.Fatalf("expected truncated result set")
	}
	if len(limitedMatches) != 2 {
		t.Fatalf("expected 2 limited matches, got %d", len(limitedMatches))
	}
}
