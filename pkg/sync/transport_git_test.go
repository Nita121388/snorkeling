// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sync

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// newBareRepo creates an empty bare repository to act as "the remote". Using a local path means the
// test needs no network and no credentials, which is what the PRD asks for.
func newBareRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := filepath.Join(t.TempDir(), "remote.git")
	cmd := exec.Command("git", "init", "--bare", "--initial-branch=main", dir)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("init bare repo: %v: %s", err, out)
	}
	return dir
}

// gitTestTransport builds a transport whose clone lives in its own temp dir, with identity set so
// commits work on machines without a global git config.
func gitTestTransport(t *testing.T, remote, cloneDir string) *GitTransport {
	t.Helper()
	tr, err := NewGitTransport(remote, cloneDir, "")
	if err != nil {
		t.Fatalf("new transport: %v", err)
	}
	return tr
}

func TestGitTransportSharesPayloadFormatWithFolder(t *testing.T) {
	// Both transports read/write the same FolderPayload; a divergence here would make a folder
	// repo unreadable after switching to git.
	remote := newBareRepo(t)
	clone := filepath.Join(t.TempDir(), "clone")
	tr := gitTestTransport(t, remote, clone)

	if _, err := tr.Push(context.Background(), syncproto.PushRequest{
		DeviceId: "dev-a", DeviceName: "Home PC",
		Items: []syncproto.SnapshotItem{{Id: "ct1", Title: "T", Text: "hello", UpdatedAt: 1000}},
	}); err != nil {
		t.Fatalf("push: %v", err)
	}

	// The file must exist in the working tree and parse as the shared format.
	raw, err := os.ReadFile(filepath.Join(clone, DefaultGitPayloadName))
	if err != nil {
		t.Fatalf("payload not written: %v", err)
	}
	if !strings.Contains(string(raw), `"formatVersion"`) {
		t.Fatalf("payload must be versioned, got: %s", raw)
	}
	payload, err := readPayloadFile(filepath.Join(clone, DefaultGitPayloadName))
	if err != nil {
		t.Fatalf("read payload: %v", err)
	}
	if payload.FormatVersion != FolderFormatVersion {
		t.Fatalf("wrong format version: %d", payload.FormatVersion)
	}
}

// TestTwoGitClonesSyncThroughBareRemote is the end-to-end case: two machines, one remote.
func TestTwoGitClonesSyncThroughBareRemote(t *testing.T) {
	remote := newBareRepo(t)

	storeA := newMemStore()
	storeB := newMemStore()
	trA := gitTestTransport(t, remote, filepath.Join(t.TempDir(), "clone-a"))
	trB := gitTestTransport(t, remote, filepath.Join(t.TempDir(), "clone-b"))
	engA := NewEngine(storeA, trA, PolicyRowMerge, "dev-a", "Home PC", nil)
	engB := NewEngine(storeB, trB, PolicyRowMerge, "dev-b", "Work Mac", nil)

	// A creates and pushes.
	storeA.put(syncproto.SnapshotItem{Id: "ct1", Title: "Checklist", Text: "v1", UpdatedAt: 1000, Rev: 1})
	if _, err := engA.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("A run: %v", err)
	}

	// B clones fresh and receives it.
	if _, err := engB.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("B run: %v", err)
	}
	if it, ok := storeB.get("ct1"); !ok || it.Text != "v1" {
		t.Fatalf("B did not receive the item: %+v", it)
	}

	// B edits and pushes; A picks the edit up.
	storeB.put(syncproto.SnapshotItem{Id: "ct1", Title: "Checklist", Text: "v2 from B", UpdatedAt: 2000, Rev: 2})
	if _, err := engB.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("B push: %v", err)
	}
	if _, err := engA.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("A pull: %v", err)
	}
	if it, _ := storeA.get("ct1"); it.Text != "v2 from B" {
		t.Fatalf("A did not receive B's edit: %+v", it)
	}

	// B deletes; the tombstone must survive the trip so A does not resurrect it.
	storeB.put(syncproto.SnapshotItem{Id: "ct1", DeletedAt: 3000, UpdatedAt: 3000, Rev: 3})
	if _, err := engB.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("B delete: %v", err)
	}
	if _, err := engA.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("A pull delete: %v", err)
	}
	if it, _ := storeA.get("ct1"); it.DeletedAt == 0 {
		t.Fatalf("A must learn about the delete, got %+v", it)
	}
}

func TestGitTransportRefusesNonRepoDirectory(t *testing.T) {
	// Pointing git sync at a directory that holds unrelated files must not silently reuse (and
	// later overwrite) it.
	remote := newBareRepo(t)
	dir := filepath.Join(t.TempDir(), "occupied")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "important.txt"), []byte("keep me"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	tr := gitTestTransport(t, remote, dir)
	_, err := tr.Pull(context.Background(), 0)
	if err == nil {
		t.Fatal("must refuse a non-empty non-repo directory")
	}
	if !strings.Contains(err.Error(), "not a git repository") {
		t.Fatalf("error should name the problem, got: %v", err)
	}
	// The unrelated file must still be there.
	if _, statErr := os.Stat(filepath.Join(dir, "important.txt")); statErr != nil {
		t.Fatalf("must not delete user files: %v", statErr)
	}
}

func TestGitTransportNoOpPushCreatesNoCommit(t *testing.T) {
	// A sync with nothing to change must not spam the history with empty commits.
	remote := newBareRepo(t)
	clone := filepath.Join(t.TempDir(), "clone")
	tr := gitTestTransport(t, remote, clone)

	req := syncproto.PushRequest{
		DeviceId: "dev-a", DeviceName: "A",
		Items: []syncproto.SnapshotItem{{Id: "ct1", Text: "x", UpdatedAt: 1000}},
	}
	if _, err := tr.Push(context.Background(), req); err != nil {
		t.Fatalf("first push: %v", err)
	}
	firstCount := gitCommitCount(t, clone)

	outcome, err := tr.Push(context.Background(), req)
	if err != nil {
		t.Fatalf("second push: %v", err)
	}
	if outcome.Applied != 0 {
		t.Fatalf("a repeat push must apply nothing, got %+v", outcome)
	}
	if got := gitCommitCount(t, clone); got != firstCount {
		t.Fatalf("no-op push must not commit: %d -> %d", firstCount, got)
	}
}

func gitCommitCount(t *testing.T, dir string) int {
	t.Helper()
	cmd := exec.Command("git", "rev-list", "--count", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("rev-list: %v", err)
	}
	count := 0
	for _, c := range strings.TrimSpace(string(out)) {
		if c >= '0' && c <= '9' {
			count = count*10 + int(c-'0')
		}
	}
	return count
}

func TestGitTransportMissingRemoteFailsClearly(t *testing.T) {
	if _, err := NewGitTransport("", "/tmp/x", ""); err == nil {
		t.Fatal("a transport without a remote must not be constructible")
	}
	tr, err := NewGitTransport("file:///nonexistent/repo.git", filepath.Join(t.TempDir(), "clone"), "")
	if err != nil {
		t.Fatalf("construct: %v", err)
	}
	if _, pullErr := tr.Pull(context.Background(), 0); pullErr == nil {
		t.Fatal("cloning a nonexistent remote must fail")
	}
}
