// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextservice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/syncconflict"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestMain(m *testing.M) {
	tmpDir, err := os.MkdirTemp("", "commontextservice-test-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tmpDir)

	configDir := filepath.Join(tmpDir, "config")
	dataDir := filepath.Join(tmpDir, "data")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, wavebase.WaveDBDir), 0700); err != nil {
		panic(err)
	}
	wavebase.ConfigHome_VarCache = configDir
	wavebase.DataHome_VarCache = dataDir
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}

	code := m.Run()
	os.RemoveAll(tmpDir)
	os.Exit(code)
}

func setupConflicts(t *testing.T) {
	t.Helper()
	syncconflict.SetDirForTesting(t.TempDir())
	t.Cleanup(func() { syncconflict.SetDirForTesting("") })
}

func testConflict(id, localText, remoteText string) syncproto.Conflict {
	return syncproto.Conflict{
		Id:     id,
		Fields: []string{syncproto.ConflictFieldText},
		Local:  &syncproto.SnapshotItem{Id: id, Title: "Checklist", Text: localText, UpdatedAt: 1000},
		Remote: &syncproto.SnapshotItem{Id: id, Title: "Checklist", Text: remoteText, UpdatedAt: 2000},
		Reason: "both sides changed text",
	}
}

func seedItem(t *testing.T, id, text string, rev int) {
	t.Helper()
	if err := commontextstore.SaveAll(context.Background(), []wconfig.CommonTextItemType{
		{Id: id, Title: "Checklist", Text: text, Rev: float64(rev)},
	}); err != nil {
		t.Fatalf("seed item: %v", err)
	}
}

// TestSyncConflictsCopyMatchesRenderAll is the acceptance anchor: the panel copy and the CLI
// copy must be byte-identical because they share one render source.
func TestSyncConflictsCopyMatchesRenderAll(t *testing.T) {
	setupConflicts(t)
	if err := syncconflict.Record([]syncproto.Conflict{
		testConflict("ct1", "local one", "remote one"),
		testConflict("ct2", "local two", "remote two"),
	}, "server", "Work Mac"); err != nil {
		t.Fatalf("record: %v", err)
	}

	svc := &CommonTextService{}
	resp, err := svc.SyncConflictsCopy(context.Background())
	if err != nil {
		t.Fatalf("SyncConflictsCopy: %v", err)
	}
	if resp.Count != 2 {
		t.Fatalf("expected count 2, got %d", resp.Count)
	}
	entries, err := syncconflict.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Text != syncconflict.RenderAll(entries) {
		t.Fatal("panel copy must be byte-identical to the CLI render source")
	}
	if !strings.HasPrefix(resp.Text, "# Sync conflicts (2)") {
		t.Fatalf("multi-conflict header missing: %q", firstLine(resp.Text))
	}
}

func firstLine(s string) string {
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		return s[:idx]
	}
	return s
}

func TestSyncConflictCopySingleEntry(t *testing.T) {
	setupConflicts(t)
	if err := syncconflict.Record([]syncproto.Conflict{
		testConflict("ct1", "local", "remote"),
		testConflict("ct2", "local", "remote"),
	}, "folder", "Laptop"); err != nil {
		t.Fatalf("record: %v", err)
	}

	svc := &CommonTextService{}
	resp, err := svc.SyncConflictCopy(context.Background(), &CommonTextSyncConflictCopyRequest{Id: "ct2"})
	if err != nil {
		t.Fatalf("SyncConflictCopy: %v", err)
	}
	if resp.Count != 1 || !strings.Contains(resp.Text, "## Sync conflict") {
		t.Fatalf("expected one rendered conflict, got count=%d", resp.Count)
	}
	if strings.Contains(resp.Text, "ct1") {
		t.Fatal("single-entry copy must not include other conflicts")
	}

	if _, err := svc.SyncConflictCopy(context.Background(), &CommonTextSyncConflictCopyRequest{Id: "nope"}); err == nil {
		t.Fatal("unknown id must be an error, not an empty copy")
	}
}

// TestSyncResolveHappyPath covers the paste-back half: merged text in, item updated with a bumped
// rev, conflict gone.
func TestSyncResolveHappyPath(t *testing.T) {
	setupConflicts(t)
	seedItem(t, "ct1", "old local", 5)
	if err := syncconflict.Record([]syncproto.Conflict{testConflict("ct1", "old local", "remote")}, "server", ""); err != nil {
		t.Fatalf("record: %v", err)
	}

	svc := &CommonTextService{}
	resp, err := svc.SyncResolve(context.Background(), &CommonTextSyncResolveRequest{Id: "ct1", Text: "merged text"})
	if err != nil {
		t.Fatalf("SyncResolve: %v", err)
	}
	if resp == nil || resp.Status.Conflicts != 0 {
		t.Fatalf("status must report 0 conflicts after resolve, got %+v", resp)
	}

	item, found, err := commontextstore.Get(context.Background(), "ct1")
	if err != nil || !found {
		t.Fatalf("item must survive resolve: found=%v err=%v", found, err)
	}
	if item.Text != "merged text" {
		t.Fatalf("merged text not applied: %q", item.Text)
	}
	if item.Rev != 6 {
		t.Fatalf("rev must bump so the next push is newer, got %v", item.Rev)
	}

	entries, err := syncconflict.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("resolved conflict must leave the list, got %d", len(entries))
	}
}

func TestSyncResolveValidations(t *testing.T) {
	setupConflicts(t)
	seedItem(t, "ct1", "old local", 5)
	if err := syncconflict.Record([]syncproto.Conflict{testConflict("ct1", "old local", "remote")}, "server", ""); err != nil {
		t.Fatalf("record: %v", err)
	}

	svc := &CommonTextService{}
	ctx := context.Background()
	if _, err := svc.SyncResolve(ctx, &CommonTextSyncResolveRequest{Id: "ct1", Text: "   "}); err == nil {
		t.Fatal("empty text must be refused")
	}
	if _, err := svc.SyncResolve(ctx, &CommonTextSyncResolveRequest{Id: "", Text: "merged"}); err == nil {
		t.Fatal("empty id must be refused")
	}
	if _, err := svc.SyncResolve(ctx, &CommonTextSyncResolveRequest{Id: "nope", Text: "merged"}); err == nil {
		t.Fatal("unknown conflict id must be refused")
	}
	// A missing local item is not silently ignored: the conflict would resolve in the UI but
	// the text would go nowhere.
	if err := syncconflict.Record([]syncproto.Conflict{testConflict("ghost", "a", "b")}, "server", ""); err != nil {
		t.Fatalf("record ghost: %v", err)
	}
	if _, err := svc.SyncResolve(ctx, &CommonTextSyncResolveRequest{Id: "ghost", Text: "merged"}); err == nil {
		t.Fatal("missing local item must be refused")
	}

	// Refusals must not touch the store: the conflict and the item stay as they were.
	entries, _ := syncconflict.List()
	if len(entries) != 2 {
		t.Fatalf("refused resolves must leave conflicts untouched, got %d", len(entries))
	}
	item, _, _ := commontextstore.Get(ctx, "ct1")
	if item.Text != "old local" {
		t.Fatalf("refused resolve must not write text, got %q", item.Text)
	}
}
