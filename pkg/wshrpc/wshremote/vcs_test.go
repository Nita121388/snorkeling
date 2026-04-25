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

func TestNormalizeVcsInputPathStripsWshUri(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{
			name: "absolute path",
			path: "wsh://local//Users/test/project/file.go",
			want: "/Users/test/project/file.go",
		},
		{
			name: "home path",
			path: "wsh://local/~/project/file.go",
			want: "~/project/file.go",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := normalizeVcsInputPath(test.path)
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestParseGitAheadBehind(t *testing.T) {
	ahead, behind, err := parseGitAheadBehind("12\t4\n")
	if err != nil {
		t.Fatalf("parse ahead/behind: %v", err)
	}
	if ahead != 12 || behind != 4 {
		t.Fatalf("expected ahead=12 behind=4, got ahead=%d behind=%d", ahead, behind)
	}

	if _, _, err := parseGitAheadBehind("bad output"); err == nil {
		t.Fatalf("expected invalid output to fail")
	}
}

func TestParseSvnRemoteStatusXML(t *testing.T) {
	statusOut := `
<status>
  <target path=".">
    <entry path="z.txt">
      <wc-status item="normal" revision="3" />
      <repos-status item="modified" />
    </entry>
    <entry path="local.txt">
      <wc-status item="modified" revision="3" />
    </entry>
    <entry path="a.txt">
      <wc-status item="normal" revision="3" />
      <repos-status item="deleted" />
    </entry>
    <entry path="normal.txt">
      <wc-status item="normal" revision="3" />
      <repos-status item="none" />
    </entry>
  </target>
</status>`

	statuses := parseSvnRemoteStatusXML(statusOut, 10)
	if len(statuses) != 2 {
		t.Fatalf("expected 2 remote statuses, got %d (%v)", len(statuses), statuses)
	}
	if statuses[0].Path != "a.txt" || statuses[0].Code != "D" {
		t.Fatalf("expected first status a.txt D, got %#v", statuses[0])
	}
	if statuses[1].Path != "z.txt" || statuses[1].Code != "M" {
		t.Fatalf("expected second status z.txt M, got %#v", statuses[1])
	}
}
