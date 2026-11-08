// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sync

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// GitTransport syncs through a private git repository.
//
// Ownership: the transport keeps its **own clone** under the app data dir. It never touches a
// repository the user already has, and it never writes global git config. Both of those would be
// surprising side effects for a "sync my snippets" feature.
//
// Non-interactivity is enforced per invocation (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never,
// SSH_ASKPASS_REQUIRE=never). Without it a credential prompt would hang the background sync
// forever with no visible window — the user would just see "syncing" never finish.
type GitTransport struct {
	// RemoteURL is the repository to sync with (https or ssh).
	RemoteURL string
	// RepoDir is the local clone this transport manages.
	RepoDir string
	// Token is an optional access token, injected per-invocation via http.extraheader so it is
	// never written into .git/config.
	Token string
	// PayloadName is the file inside the repo.
	PayloadName string
	// Branch overrides the auto-detected default branch (mainly for tests).
	Branch string
	// Timeout bounds each git invocation.
	Timeout time.Duration
}

const (
	DefaultGitPayloadName = "commontext.json"
	defaultGitTimeout     = 60 * time.Second
)

func NewGitTransport(remoteURL, repoDir, token string) (*GitTransport, error) {
	if strings.TrimSpace(remoteURL) == "" {
		return nil, errors.New("git transport requires a remote URL")
	}
	if strings.TrimSpace(repoDir) == "" {
		return nil, errors.New("git transport requires a local repo directory")
	}
	return &GitTransport{
		RemoteURL:   strings.TrimSpace(remoteURL),
		RepoDir:     repoDir,
		Token:       token,
		PayloadName: DefaultGitPayloadName,
		Timeout:     defaultGitTimeout,
	}, nil
}

func (t *GitTransport) Id() TransportId { return TransportGit }

func (t *GitTransport) Caps() Caps {
	return Caps{
		RequiresCredential: strings.HasPrefix(t.RemoteURL, "https://"),
		AtomicWrite:        true, // writePayloadFile renames atomically inside the working tree
		Incremental:        false,
		Realtime:           false, // no webhook/fsnotify wiring yet
	}
}

// runGit executes one git command inside the managed clone.
//
// The token (when present) is passed as a per-command header rather than a credential helper or an
// authenticated URL: a helper would persist it in the repo config, and an authenticated URL would
// leak it into logs and the remote list.
func (t *GitTransport) runGit(ctx context.Context, args ...string) (string, error) {
	timeout := t.Timeout
	if timeout <= 0 {
		timeout = defaultGitTimeout
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	fullArgs := make([]string, 0, len(args)+6)
	fullArgs = append(fullArgs, "-c", "core.quotePath=false")
	if t.Token != "" && strings.HasPrefix(t.RemoteURL, "https://") {
		basic := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + t.Token))
		fullArgs = append(fullArgs, "-c", "http.extraheader=Authorization: Basic "+basic)
	}
	fullArgs = append(fullArgs, args...)

	cmd := exec.CommandContext(cmdCtx, "git", fullArgs...)
	cmd.Dir = t.RepoDir
	cmd.Env = gitEnv()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if errors.Is(cmdCtx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf("git %s timed out after %s", strings.Join(args, " "), timeout)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("git %s: %s", gitSubcommand(args), firstLines(msg, 3))
	}
	return stdout.String(), nil
}

// gitEnv hardens the environment so a background sync can never block on a prompt.
func gitEnv() []string {
	env := os.Environ()
	set := func(key, value string) {
		prefix := key + "="
		for i, kv := range env {
			if strings.HasPrefix(kv, prefix) {
				env[i] = prefix + value
				return
			}
		}
		env = append(env, prefix+value)
	}
	set("GIT_TERMINAL_PROMPT", "0")
	set("GCM_INTERACTIVE", "never")
	set("SSH_ASKPASS_REQUIRE", "never")
	set("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
	return env
}

func gitSubcommand(args []string) string {
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			return a
		}
	}
	return strings.Join(args, " ")
}

func firstLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) <= n {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(strings.Join(lines[:n], "\n"))
}

// ensureClone creates the managed clone on first use.
//
// An existing directory that is not a git repo is reported, not silently reused: overwriting it
// would destroy whatever the user put there.
func (t *GitTransport) ensureClone(ctx context.Context) error {
	gitDir := filepath.Join(t.RepoDir, ".git")
	if _, err := os.Stat(gitDir); err == nil {
		return nil
	}
	if entries, err := os.ReadDir(t.RepoDir); err == nil && len(entries) > 0 {
		return fmt.Errorf(
			"sync repo directory %s exists but is not a git repository; remove it or point git sync elsewhere",
			t.RepoDir,
		)
	}
	if err := os.MkdirAll(t.RepoDir, 0o700); err != nil {
		return fmt.Errorf("creating sync repo dir: %w", err)
	}
	// Clone into place. An empty remote is a legitimate starting point: clone succeeds and leaves
	// an unborn branch, which the first commit then creates.
	if _, err := t.runGit(ctx, "clone", "--depth", "1", t.RemoteURL, "."); err != nil {
		// Retry without depth: `--depth` fails on servers that only support the dumb protocol.
		if _, err2 := t.runGit(ctx, "clone", t.RemoteURL, "."); err2 != nil {
			return err
		}
	}
	return nil
}

// currentBranch resolves the branch to operate on.
func (t *GitTransport) currentBranch(ctx context.Context) string {
	if t.Branch != "" {
		return t.Branch
	}
	if out, err := t.runGit(ctx, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		if branch := strings.TrimSpace(out); branch != "" && branch != "HEAD" {
			t.Branch = branch
			return branch
		}
	}
	// Unborn branch (fresh clone of an empty repo): ask the remote what its HEAD is.
	if out, err := t.runGit(ctx, "symbolic-ref", "--short", "HEAD"); err == nil {
		if branch := strings.TrimSpace(out); branch != "" {
			t.Branch = branch
			return branch
		}
	}
	t.Branch = "main"
	return "main"
}

func (t *GitTransport) payloadPath() string {
	return filepath.Join(t.RepoDir, t.PayloadName)
}

// Pull fetches and rebases, then reads the payload from the working tree.
func (t *GitTransport) Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error) {
	if err := t.ensureClone(ctx); err != nil {
		return nil, err
	}
	branch := t.currentBranch(ctx)

	// A sync push leaves the working tree clean, so `pull --rebase` cannot conflict on our own
	// changes. --autostash covers the case where a previous write landed but the commit did not.
	if _, err := t.runGit(ctx, "pull", "--rebase", "--autostash", "origin", branch); err != nil {
		// An empty remote has no branch yet; that is "nothing to pull", not a failure.
		if !isMissingRemoteRef(err) {
			return nil, err
		}
	}

	payload, err := readPayloadFile(t.payloadPath())
	if err != nil {
		return nil, err
	}
	if payload == nil {
		return &syncproto.Snapshot{}, nil
	}
	items := payload.Items
	if sinceRev > 0 {
		filtered := make([]syncproto.SnapshotItem, 0, len(payload.Items))
		for _, it := range payload.Items {
			if it.Rev > sinceRev {
				filtered = append(filtered, it)
			}
		}
		items = filtered
	}
	return &syncproto.Snapshot{
		DeviceId:   payload.DeviceId,
		DeviceName: payload.DeviceName,
		Rev:        payload.Rev,
		Items:      items,
	}, nil
}

// Push merges into the payload, commits and pushes. A rejected push is retried once after a rebase —
// that is the normal "someone else pushed first" case, not an error worth surfacing.
func (t *GitTransport) Push(ctx context.Context, req syncproto.PushRequest) (*PushOutcome, error) {
	if err := t.ensureClone(ctx); err != nil {
		return nil, err
	}
	// Read the latest payload first so the merge sees the remote's current state.
	if _, err := t.Pull(ctx, 0); err != nil {
		return nil, err
	}
	payload, err := readPayloadFile(t.payloadPath())
	if err != nil {
		return nil, err
	}
	if payload == nil {
		payload = &FolderPayload{FormatVersion: FolderFormatVersion}
	}

	outcome, merged := mergeIntoPayload(payload, req)
	if merged == nil {
		// Nothing to write (all items unchanged).
		return outcome, nil
	}
	merged.DeviceId = req.DeviceId
	merged.DeviceName = req.DeviceName
	merged.WrittenAt = time.Now().UTC().Format(time.RFC3339)
	if err := writePayloadFile(t.payloadPath(), merged); err != nil {
		return nil, err
	}

	branch := t.currentBranch(ctx)
	if _, err := t.runGit(ctx, "add", "--", t.PayloadName); err != nil {
		return nil, err
	}
	// --quiet + checking the exit code: `git diff --cached --quiet` exits 1 when there are staged
	// changes, which is the "should commit" case.
	if _, err := t.runGit(ctx, "diff", "--cached", "--quiet"); err == nil {
		// No staged change: the payload was byte-identical.
		return outcome, nil
	}

	msg := fmt.Sprintf("commontext sync: %d item(s) from %s", outcome.Applied, nonEmpty(req.DeviceName, "unknown device"))
	if _, err := t.runGit(ctx, "commit", "-m", msg); err != nil && !strings.Contains(err.Error(), "nothing to commit") {
		return nil, err
	}

	if _, err := t.runGit(ctx, "push", "origin", "HEAD:"+branch); err != nil {
		// Rebase onto the remote and retry exactly once: a second failure is a real problem
		// (auth, permissions, protected branch) and must be surfaced.
		if _, rebaseErr := t.runGit(ctx, "pull", "--rebase", "--autostash", "origin", branch); rebaseErr != nil {
			if !isMissingRemoteRef(rebaseErr) {
				return nil, rebaseErr
			}
		}
		if _, retryErr := t.runGit(ctx, "push", "origin", "HEAD:"+branch); retryErr != nil {
			return nil, retryErr
		}
	}
	return outcome, nil
}

// isMissingRemoteRef reports the "remote has no such branch yet" family of errors, which is the
// expected state for a freshly created empty repository.
func isMissingRemoteRef(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "couldn't find remote ref") ||
		strings.Contains(msg, "no such ref") ||
		strings.Contains(msg, "couldn't find remote branch") ||
		strings.Contains(msg, "invalid refspec") ||
		strings.Contains(msg, "no commits yet") ||
		strings.Contains(msg, "unborn")
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// mergeIntoPayload applies req to payload and returns the merged payload.
//
// It returns (outcome, nil) when nothing changed, so the caller can skip the commit entirely — a
// no-op sync must not create empty commits that pollute the history.
func mergeIntoPayload(payload *FolderPayload, req syncproto.PushRequest) (*PushOutcome, *FolderPayload) {
	byId := make(map[string]syncproto.SnapshotItem, len(payload.Items))
	for _, it := range payload.Items {
		byId[it.Id] = it
	}
	baseById := make(map[string]*syncproto.SnapshotItem, len(req.Base))
	for idx := range req.Base {
		if req.Base[idx].Id != "" {
			baseById[req.Base[idx].Id] = &req.Base[idx]
		}
	}

	outcome := &PushOutcome{Rev: payload.Rev}
	newRev := payload.Rev
	changed := false
	for _, incoming := range req.Items {
		if incoming.Id == "" {
			continue
		}
		nextRev := newRev + 1
		if incoming.Rev > nextRev {
			nextRev = incoming.Rev
		}
		stored, found := byId[incoming.Id]
		if !found {
			incoming.Rev = nextRev
			byId[incoming.Id] = incoming
			outcome.Applied++
			newRev = nextRev
			changed = true
			continue
		}
		if incoming.DeletedAt > 0 && incoming.Rev >= stored.Rev {
			incoming.Rev = nextRev
			byId[incoming.Id] = incoming
			outcome.Applied++
			newRev = nextRev
			changed = true
			continue
		}
		base := baseById[incoming.Id]
		if base == nil {
			if incoming.UpdatedAt > stored.UpdatedAt {
				incoming.Rev = nextRev
				byId[incoming.Id] = incoming
				outcome.Applied++
				newRev = nextRev
				changed = true
			} else {
				outcome.Unchanged++
			}
			continue
		}
		fields := syncproto.DetectConflictFields(base, &incoming, &stored)
		if len(fields) > 0 {
			local := incoming
			remote := stored
			outcome.Conflicts = append(outcome.Conflicts, syncproto.Conflict{
				Id: incoming.Id, Fields: fields, Local: &local, Remote: &remote,
				Reason: "both sides changed the same field",
			})
			continue
		}
		merged, didChange := mergeForFolder(base, &incoming, &stored)
		if !didChange {
			outcome.Unchanged++
			continue
		}
		merged.Rev = nextRev
		byId[merged.Id] = merged
		outcome.Applied++
		newRev = nextRev
		changed = true
	}
	if !changed {
		return outcome, nil
	}

	items := make([]syncproto.SnapshotItem, 0, len(byId))
	for _, it := range byId {
		items = append(items, it)
	}
	sortItemsById(items)
	payload.Items = items
	payload.Rev = newRev
	outcome.Rev = newRev
	return outcome, payload
}

func sortItemsById(items []syncproto.SnapshotItem) {
	// Insertion sort: payloads are small (hundreds of items) and this avoids importing sort in a
	// file that only needs one call.
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].Id < items[j-1].Id; j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}
