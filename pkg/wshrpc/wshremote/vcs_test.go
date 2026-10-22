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

func TestNewVcsCommandDisablesGitPathQuoting(t *testing.T) {
	gitCmd, _, gitCancel := newVcsCommand(context.Background(), "", "git", "status", "--porcelain=1")
	defer gitCancel()
	if len(gitCmd.Args) < 4 || gitCmd.Args[1] != "-c" || gitCmd.Args[2] != "core.quotePath=false" {
		t.Fatalf("expected git args to disable quotePath, got %v", gitCmd.Args)
	}
	if gitCmd.Args[3] != "status" {
		t.Fatalf("expected subcommand after git options, got %v", gitCmd.Args)
	}

	svnCmd, _, svnCancel := newVcsCommand(context.Background(), "", "svn", "status")
	defer svnCancel()
	if len(svnCmd.Args) != 2 || svnCmd.Args[1] != "status" {
		t.Fatalf("expected svn args to stay unchanged, got %v", svnCmd.Args)
	}

	// The caller-provided slice must not be reused/overwritten.
	args := []string{"status"}
	_, _, cancel := newVcsCommand(context.Background(), "", "git", args...)
	defer cancel()
	if len(args) != 1 || args[0] != "status" {
		t.Fatalf("expected caller args to be untouched, got %v", args)
	}
}

func TestDecodeGitPathTokenDecodesUnicodeEscapes(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  string
	}{
		{
			name:  "unicode octal escapes",
			token: `"\346\226\260\345\273\272\346\226\207\344\273\266.txt"`,
			want:  "新建文件.txt",
		},
		{
			name:  "unicode octal escapes in subdirectory",
			token: `"\345\255\220\347\233\256\345\275\225/\346\265\213\350\257\225\346\226\207\344\273\266.md"`,
			want:  "子目录/测试文件.md",
		},
		{
			name:  "short octal escapes",
			token: `"\101\102\103"`,
			want:  "ABC",
		},
		{
			name:  "c style escapes",
			token: `"my\tfile\n.txt"`,
			want:  "my\tfile\n.txt",
		},
		{
			name:  "escaped quote and backslash",
			token: `"we\"ird\\name.txt"`,
			want:  `we"ird\name.txt`,
		},
		{
			name:  "unterminated quote",
			token: `"\346\226\260`,
			want:  "新",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := decodeGitPathToken(test.token)
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestDecodeGitPathTokenKeepsPlainPaths(t *testing.T) {
	for _, token := range []string{"README.md", "src/main.go", "子目录/测试文件.md", "my file.txt", ""} {
		got := decodeGitPathToken(token)
		if got != token {
			t.Fatalf("expected %q to be unchanged, got %q", token, got)
		}
	}
}

func TestSplitGitRenamePathIgnoresSeparatorInsideQuotes(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		want      string
		wantFound bool
	}{
		{
			name:      "quoted rename",
			raw:       `"\346\226\260.txt" -> "\351\207\215.txt"`,
			want:      `"\351\207\215.txt"`,
			wantFound: true,
		},
		{
			name:      "separator inside quotes is ignored",
			raw:       `"a -> b.txt" -> "c.txt"`,
			want:      `"c.txt"`,
			wantFound: true,
		},
		{
			name:      "escaped quote does not end the quoted section",
			raw:       `"we\"ird" -> "next.txt"`,
			want:      `"next.txt"`,
			wantFound: true,
		},
		{
			name:      "no separator",
			raw:       `"a -> b.txt"`,
			want:      `"a -> b.txt"`,
			wantFound: false,
		},
		{
			name:      "plain rename",
			raw:       "old.txt -> new.txt",
			want:      "new.txt",
			wantFound: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, found := splitGitRenamePath(test.raw)
			if found != test.wantFound {
				t.Fatalf("expected found=%v, got %v", test.wantFound, found)
			}
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestParseGitStatusDecodesQuotedUnicodePath(t *testing.T) {
	statusOut := `?? "\346\226\260\345\273\272\346\226\207\344\273\266.txt"` + "\n" +
		`R  "\346\226\260.txt" -> "\351\207\215\345\221\275\345\220\215\346\226\207\344\273\266.txt"` + "\n" +
		` M "my file.txt"` + "\n"

	statuses := parseGitStatus(statusOut, 10)
	if len(statuses) != 3 {
		t.Fatalf("expected 3 statuses, got %d (%#v)", len(statuses), statuses)
	}
	byPath := make(map[string]wshrpc.VcsFileStatus, len(statuses))
	for _, status := range statuses {
		if strings.Contains(status.Path, `\`) {
			t.Fatalf("expected decoded path without escapes, got %q", status.Path)
		}
		byPath[status.Path] = status
	}

	untracked, ok := byPath["新建文件.txt"]
	if !ok {
		t.Fatalf("expected decoded untracked path, got %#v", statuses)
	}
	if !untracked.Untracked || untracked.Staged {
		t.Fatalf("expected untracked status, got %#v", untracked)
	}

	renamed, ok := byPath["重命名文件.txt"]
	if !ok {
		t.Fatalf("expected decoded rename target path, got %#v", statuses)
	}
	if renamed.Code != "R" {
		t.Fatalf("expected rename code, got %#v", renamed)
	}

	spaced, ok := byPath["my file.txt"]
	if !ok {
		t.Fatalf("expected spaced path, got %#v", statuses)
	}
	if spaced.Staged {
		t.Fatalf("expected unstaged status, got %#v", spaced)
	}
}

func TestParseGitCommitFilesDecodesQuotedUnicodePath(t *testing.T) {
	nameStatusOut := "A\t" + `"\346\226\260\345\273\272\346\226\207\344\273\266.txt"` + "\n" +
		"M\t" + `"\345\255\220\347\233\256\345\275\225/\346\265\213\350\257\225\346\226\207\344\273\266.md"` + "\n"

	files := parseGitCommitFiles(nameStatusOut)
	if len(files) != 2 {
		t.Fatalf("expected 2 commit files, got %d (%#v)", len(files), files)
	}
	byPath := make(map[string]wshrpc.VcsCommitFileInfo, len(files))
	for _, file := range files {
		if strings.Contains(file.Path, `\`) {
			t.Fatalf("expected decoded path without escapes, got %q", file.Path)
		}
		byPath[file.Path] = file
	}

	added, ok := byPath["新建文件.txt"]
	if !ok {
		t.Fatalf("expected decoded commit file path, got %#v", files)
	}
	if added.Code != "A" {
		t.Fatalf("expected add code, got %#v", added)
	}

	modified, ok := byPath["子目录/测试文件.md"]
	if !ok {
		t.Fatalf("expected decoded commit file path, got %#v", files)
	}
	if modified.Code != "M" {
		t.Fatalf("expected modify code, got %#v", modified)
	}
}

func TestRemoteVcsRepositoriesCommandDecodesUnicodePaths(t *testing.T) {
	root := t.TempDir()
	runGitForTest(t, root, "init")
	runGitForTest(t, root, "config", "user.name", "Test User")
	runGitForTest(t, root, "config", "user.email", "test@example.com")

	const unicodeFileName = "新建文件.txt"
	if err := os.WriteFile(filepath.Join(root, unicodeFileName), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write unicode file: %v", err)
	}
	runGitForTest(t, root, "add", ".")
	runGitForTest(t, root, "commit", "-qm", "initial")
	if err := os.WriteFile(filepath.Join(root, unicodeFileName), []byte("hello\nworld\n"), 0o644); err != nil {
		t.Fatalf("modify unicode file: %v", err)
	}

	impl := &ServerImpl{}
	repos, err := impl.RemoteVcsRepositoriesCommand(context.Background(), wshrpc.CommandRemoteVcsRepositoriesData{
		Path: root, StatusLimit: 50,
	})
	if err != nil {
		t.Fatalf("repositories command: %v", err)
	}
	if len(repos.Repositories) != 1 {
		t.Fatalf("expected 1 repository, got %d (%#v)", len(repos.Repositories), repos.Repositories)
	}
	repo := repos.Repositories[0]
	if repo.StatusErr != "" {
		t.Fatalf("unexpected status error: %s", repo.StatusErr)
	}
	found := false
	for _, status := range repo.Status {
		if strings.Contains(status.Path, `\`) {
			t.Fatalf("expected decoded path without escapes, got %q", status.Path)
		}
		if status.Path == unicodeFileName {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected status entry %q, got %#v", unicodeFileName, repo.Status)
	}

	diff, err := impl.RemoteVcsFileDiffCommand(context.Background(), wshrpc.CommandRemoteVcsFileDiffData{
		RepoType: "git", RepoPath: repo.RootPath, FilePath: filepath.Join(repo.RootPath, unicodeFileName),
	})
	if err != nil {
		t.Fatalf("file diff command: %v", err)
	}
	if !strings.Contains(diff.Diff, "world") {
		t.Fatalf("expected diff content for unicode path, got %q", diff.Diff)
	}
}

// The first porcelain line of "git status" starts with a space when the change
// is unstaged (" M path"). Trimming the whole command output would drop that
// space and shift the path of the first entry by one character.
func TestLoadGitRepoStateKeepsFirstStatusLinePath(t *testing.T) {
	root := t.TempDir()
	runGitForTest(t, root, "init")
	runGitForTest(t, root, "config", "user.name", "Test User")
	runGitForTest(t, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "first.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForTest(t, root, "add", ".")
	runGitForTest(t, root, "commit", "-qm", "initial")
	if err := os.WriteFile(filepath.Join(root, "first.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, statuses, err := loadGitRepoState(context.Background(), root, 10)
	if err != nil {
		t.Fatalf("load git repo state: %v", err)
	}
	if len(statuses) != 1 {
		t.Fatalf("expected 1 status, got %d (%#v)", len(statuses), statuses)
	}
	if statuses[0].Path != "first.txt" {
		t.Fatalf("expected first.txt, got %q", statuses[0].Path)
	}
	if statuses[0].Staged {
		t.Fatalf("expected unstaged modification, got %#v", statuses[0])
	}
	if statuses[0].Untracked {
		t.Fatalf("expected tracked file, got %#v", statuses[0])
	}
}

func TestRemoteVcsSwitchBranchSwitchesLocalBranch(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	run("config", "user.email", "test@example.com")
	run("config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-qm", "initial")
	run("branch", "feature/test")

	impl := &ServerImpl{}
	result, err := impl.RemoteVcsSwitchBranchCommand(context.Background(), wshrpc.CommandRemoteVcsSwitchBranchData{
		RepoType: "git", RepoPath: root, Branch: "feature/test",
	})
	if err != nil || result.Error != "" {
		t.Fatalf("switch failed: err=%v result=%+v", err, result)
	}
	current, err := exec.Command("git", "-C", root, "branch", "--show-current").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(current)) != "feature/test" {
		t.Fatalf("expected feature/test, got %q", current)
	}
}

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

func TestRemoteVcsCreateBranchCreatesAndChecksOut(t *testing.T) {
	root := t.TempDir()
	runGitForTest(t, root, "init")
	runGitForTest(t, root, "config", "user.name", "Test User")
	runGitForTest(t, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForTest(t, root, "add", ".")
	runGitForTest(t, root, "commit", "-qm", "initial")

	impl := &ServerImpl{}
	result, err := impl.RemoteVcsCreateBranchCommand(context.Background(), wshrpc.CommandRemoteVcsCreateBranchData{
		RepoType: "git", RepoPath: root, Branch: "feature/new",
	})
	if err != nil || result.Error != "" {
		t.Fatalf("create failed: err=%v result=%+v", err, result)
	}
	if result.Branch != "feature/new" {
		t.Fatalf("expected feature/new, got %q", result.Branch)
	}
	current, err := exec.Command("git", "-C", root, "branch", "--show-current").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(current)) != "feature/new" {
		t.Fatalf("expected checked out feature/new, got %q", current)
	}
}

func TestRemoteVcsCreateBranchRejectsExistingAndInvalid(t *testing.T) {
	root := t.TempDir()
	runGitForTest(t, root, "init")
	runGitForTest(t, root, "config", "user.name", "Test User")
	runGitForTest(t, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForTest(t, root, "add", ".")
	runGitForTest(t, root, "commit", "-qm", "initial")
	runGitForTest(t, root, "branch", "existing")

	impl := &ServerImpl{}
	dup, err := impl.RemoteVcsCreateBranchCommand(context.Background(), wshrpc.CommandRemoteVcsCreateBranchData{
		RepoType: "git", RepoPath: root, Branch: "existing",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if dup.Error == "" || !strings.Contains(dup.Error, "already exists") {
		t.Fatalf("expected already-exists error, got %+v", dup)
	}

	bad, err := impl.RemoteVcsCreateBranchCommand(context.Background(), wshrpc.CommandRemoteVcsCreateBranchData{
		RepoType: "git", RepoPath: root, Branch: "../escape",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if bad.Error == "" || !strings.Contains(bad.Error, "invalid") {
		t.Fatalf("expected invalid-name error, got %+v", bad)
	}
}

func TestRemoteVcsDeleteBranchDeletesNonCurrentBranch(t *testing.T) {
	root := t.TempDir()
	runGitForTest(t, root, "init")
	runGitForTest(t, root, "config", "user.name", "Test User")
	runGitForTest(t, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForTest(t, root, "add", ".")
	runGitForTest(t, root, "commit", "-qm", "initial")
	runGitForTest(t, root, "branch", "todelete")

	impl := &ServerImpl{}
	result, err := impl.RemoteVcsDeleteBranchCommand(context.Background(), wshrpc.CommandRemoteVcsDeleteBranchData{
		RepoType: "git", RepoPath: root, Branch: "todelete",
	})
	if err != nil || result.Error != "" {
		t.Fatalf("delete failed: err=%v result=%+v", err, result)
	}
	out := runGitForTest(t, root, "branch", "--list", "todelete")
	if strings.TrimSpace(out) != "" {
		t.Fatalf("expected branch deleted, got %q", out)
	}

	// Deleting the current branch must fail.
	curlBranch := strings.TrimSpace(runGitForTest(t, root, "rev-parse", "--abbrev-ref", "HEAD"))
	current, err := impl.RemoteVcsDeleteBranchCommand(context.Background(), wshrpc.CommandRemoteVcsDeleteBranchData{
		RepoType: "git", RepoPath: root, Branch: curlBranch,
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if current.Error == "" || !strings.Contains(current.Error, "current") {
		t.Fatalf("expected current-branch error, got %+v", current)
	}
}
