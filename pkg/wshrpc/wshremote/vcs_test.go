package wshremote

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectRepoRootsRetainsGitAndSvnForSamePath(t *testing.T) {
	root := t.TempDir()
	normalizedRoot := normalizeRepoRootPath(root)
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, ".svn"), 0o755); err != nil {
		t.Fatalf("mkdir .svn: %v", err)
	}

	repos := detectRepoRoots(context.Background(), root, 1, false)
	if len(repos) != 2 {
		t.Fatalf("expected 2 repos, got %d (%v)", len(repos), repos)
	}

	if repos[0].RootPath != normalizedRoot || repos[1].RootPath != normalizedRoot {
		t.Fatalf("expected both repos at %q, got %#v", normalizedRoot, repos)
	}

	gotTypes := []string{repos[0].RepoType, repos[1].RepoType}
	wantTypes := []string{"git", "svn"}
	for i := range wantTypes {
		if gotTypes[i] != wantTypes[i] {
			t.Fatalf("expected repo types %v, got %v", wantTypes, gotTypes)
		}
	}
}

func TestBuildResolvedRepoRootsReturnsBothRepoTypes(t *testing.T) {
	root := t.TempDir()
	normalizedRoot := normalizeRepoRootPath(root)

	repos := buildResolvedRepoRoots(root, root)
	if len(repos) != 2 {
		t.Fatalf("expected 2 repos, got %d (%v)", len(repos), repos)
	}

	if repos[0].RootPath != normalizedRoot || repos[1].RootPath != normalizedRoot {
		t.Fatalf("expected both repos at %q, got %#v", normalizedRoot, repos)
	}

	gotTypes := []string{repos[0].RepoType, repos[1].RepoType}
	wantTypes := []string{"git", "svn"}
	for i := range wantTypes {
		if gotTypes[i] != wantTypes[i] {
			t.Fatalf("expected repo types %v, got %v", wantTypes, gotTypes)
		}
	}
}
