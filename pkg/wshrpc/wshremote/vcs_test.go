package wshremote

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

func TestToRepoRelativePathExpandsHomePaths(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("home dir: %v", err)
	}
	repoPath := filepath.Join(homeDir, "project")

	tests := []struct {
		name     string
		filePath string
		want     string
	}{
		{
			name:     "home file path",
			filePath: "~/project/README.md",
			want:     "README.md",
		},
		{
			name:     "home repo root",
			filePath: "~/project",
			want:     "",
		},
		{
			name:     "wsh home file path",
			filePath: "wsh://local/~/project/docs/plan.md",
			want:     "docs/plan.md",
		},
		{
			name:     "wsh home repo root",
			filePath: "wsh://local/~/project",
			want:     "",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := toRepoRelativePath(repoPath, test.filePath)
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestToRepoRelativePathRepoRootVariants(t *testing.T) {
	repoPath := filepath.Join(t.TempDir(), "repo")
	if err := os.Mkdir(repoPath, 0o755); err != nil {
		t.Fatalf("mkdir repo: %v", err)
	}
	repoPath = filepath.Clean(repoPath)

	tests := []string{
		repoPath,
		repoPath + string(os.PathSeparator),
	}
	for _, path := range tests {
		t.Run(strings.ReplaceAll(path, string(os.PathSeparator), "_"), func(t *testing.T) {
			got := toRepoRelativePath(repoPath, path)
			if got != "" {
				t.Fatalf("expected repo root to map to empty pathspec, got %q", got)
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

func TestNonInteractiveGitSSHCommandAddsSafetyOptions(t *testing.T) {
	got := nonInteractiveGitSSHCommand("ssh -i ~/.ssh/id_ed25519")

	for _, want := range []string{"ssh -i ~/.ssh/id_ed25519", "-o BatchMode=yes", "-o ConnectTimeout=15", "-o ConnectionAttempts=1"} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected %q to contain %q", got, want)
		}
	}
}

func TestVcsCommandEnvDisablesInteractiveGitPrompts(t *testing.T) {
	t.Setenv("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")

	env := vcsCommandEnv()
	envMap := make(map[string]string)
	for _, entry := range env {
		key, value, found := strings.Cut(entry, "=")
		if found {
			envMap[key] = value
		}
	}

	if envMap["GIT_TERMINAL_PROMPT"] != "0" {
		t.Fatalf("expected GIT_TERMINAL_PROMPT=0, got %q", envMap["GIT_TERMINAL_PROMPT"])
	}
	if envMap["GCM_INTERACTIVE"] != "never" {
		t.Fatalf("expected GCM_INTERACTIVE=never, got %q", envMap["GCM_INTERACTIVE"])
	}
	if envMap["SSH_ASKPASS_REQUIRE"] != "never" {
		t.Fatalf("expected SSH_ASKPASS_REQUIRE=never, got %q", envMap["SSH_ASKPASS_REQUIRE"])
	}
	if !strings.Contains(envMap["GIT_SSH_COMMAND"], "-o ConnectTimeout=15") {
		t.Fatalf("expected GIT_SSH_COMMAND to include ConnectTimeout, got %q", envMap["GIT_SSH_COMMAND"])
	}
}

func TestFormatCopyableVcsCommandRedactsCommitMessage(t *testing.T) {
	t.Setenv("GIT_SSH_COMMAND", "ssh")

	got := formatCopyableVcsCommand("git", []string{"commit", "-m", "secret message", "--", "file name.txt"})

	if strings.Contains(got, "secret message") {
		t.Fatalf("expected commit message to be redacted, got %q", got)
	}
	for _, want := range []string{"GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "git", "commit", "<redacted>", "file name.txt"} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected %q to contain %q", got, want)
		}
	}
}

func TestSummarizeVcsOutputTruncatesLongOutput(t *testing.T) {
	got := summarizeVcsOutput(strings.Repeat("a", 900))
	if len(got) <= 800 || !strings.HasSuffix(got, "...(truncated)") {
		t.Fatalf("expected long output summary to be truncated, got len=%d value=%q", len(got), got)
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

func TestParseSvnCommits(t *testing.T) {
	logOut := `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry revision="5187">
<author>nita</author>
<date>2026-05-12T02:03:04.000000Z</date>
<msg>Fix commits view

Body text</msg>
</logentry>
</log>`

	commits, err := parseSvnCommits(logOut)
	if err != nil {
		t.Fatalf("parse svn commits: %v", err)
	}
	if len(commits) != 1 {
		t.Fatalf("expected 1 commit, got %d", len(commits))
	}
	if commits[0].Hash != "5187" || commits[0].Author != "nita" || commits[0].Subject != "Fix commits view" {
		t.Fatalf("unexpected commit: %#v", commits[0])
	}
}

func TestFilterAndPaginateCommitsReportsHasMore(t *testing.T) {
	commits := []wshrpc.VcsCommitInfo{
		{Hash: "1", Subject: "one"},
		{Hash: "2", Subject: "two"},
		{Hash: "3", Subject: "three"},
	}

	page, hasMore := filterAndPaginateCommits(commits, 1, 1, nil, nil, "")
	if len(page) != 1 || page[0].Hash != "2" || !hasMore {
		t.Fatalf("unexpected page=%#v hasMore=%v", page, hasMore)
	}
}

func runGitForTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git not available: %v", err)
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(out))
	}
	return string(out)
}

func TestLoadGitCommitFilesScopesToPath(t *testing.T) {
	repoPath := t.TempDir()
	runGitForTest(t, repoPath, "init")
	runGitForTest(t, repoPath, "config", "user.name", "Test User")
	runGitForTest(t, repoPath, "config", "user.email", "test@example.com")

	for _, dir := range []string{"docs", "src"} {
		if err := os.Mkdir(filepath.Join(repoPath, dir), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(repoPath, "docs", "guide.md"), []byte("docs\n"), 0o644); err != nil {
		t.Fatalf("write docs file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "src", "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("write src file: %v", err)
	}
	runGitForTest(t, repoPath, "add", ".")
	runGitForTest(t, repoPath, "commit", "-m", "initial")
	revision := strings.TrimSpace(runGitForTest(t, repoPath, "rev-parse", "HEAD"))

	files, err := loadGitCommitFiles(context.Background(), repoPath, revision, "docs")
	if err != nil {
		t.Fatalf("load scoped git commit files: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 scoped file, got %d (%#v)", len(files), files)
	}
	if files[0].Path != "docs/guide.md" || files[0].Code != "A" {
		t.Fatalf("unexpected scoped file: %#v", files[0])
	}
}
