// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

func TestNormalizeProjectFilters(t *testing.T) {
	got := normalizeProjectFilters([]string{
		"  /Users/nita/Primary/projects/snorkeling  ",
		"/users/nita/primary/projects/Snorkeling/",
		"",
		"   ",
		ProjectFilterOther,
		"~/",
		"E:/",
		"e:\\",
		"relative/path",
	})
	want := []string{
		"/Users/nita/Primary/projects/snorkeling",
		ProjectFilterOther,
		"~/",
		`E:\`,
		"relative/path",
	}
	if len(got) != len(want) {
		t.Fatalf("normalizeProjectFilters len = %d, want %d: %#v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("normalizeProjectFilters[%d] = %q, want %q (full: %#v)", i, got[i], want[i], got)
		}
	}
}

func TestNormalizeProjectPrefixRootForms(t *testing.T) {
	cases := map[string]string{
		"":                 "",
		"   ":              "",
		"/":                "/",
		"~":                "~/",
		"~\\":              "~/",
		"e:":               `E:\`,
		"e:/":              `E:\`,
		`E:\`:              `E:\`,
		"/Users/nita/":     "/Users/nita",
		`/Users\nita\`:     `/Users\nita`,
		ProjectFilterOther: ProjectFilterOther,
	}
	for in, want := range cases {
		if got := normalizeProjectPrefix(in); got != want {
			t.Errorf("normalizeProjectPrefix(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestProjectPathIsOther(t *testing.T) {
	others := []string{"", "   ", "relative/path", "projects/snorkeling"}
	for _, p := range others {
		if !projectPathIsOther(p) {
			t.Errorf("projectPathIsOther(%q) = false, want true", p)
		}
	}
	absolutes := []string{"/Users/nita", "~", "~/", `~\code`, "E:\\code", "e:/code"}
	for _, p := range absolutes {
		if projectPathIsOther(p) {
			t.Errorf("projectPathIsOther(%q) = true, want false", p)
		}
	}
}

func TestEffectiveProjectsSupersedesProject(t *testing.T) {
	if got := effectiveProjects(ListOptions{Project: "/legacy/only"}); len(got) != 1 || got[0] != "/legacy/only" {
		t.Fatalf("legacy Project fallback = %#v", got)
	}
	got := effectiveProjects(ListOptions{Project: "/legacy/only", Projects: []string{"/new/one", "/new/two"}})
	if len(got) != 2 || got[0] != "/new/one" || got[1] != "/new/two" {
		t.Fatalf("Projects must supersede Project, got %#v", got)
	}
	if got := effectiveProjects(ListOptions{}); got != nil {
		t.Fatalf("empty options must produce no include constraint, got %#v", got)
	}
}

func TestProjectPathMatchesAny(t *testing.T) {
	if !projectPathMatchesAny("/anywhere", nil) {
		t.Fatal("empty selection must not constrain")
	}
	// Union of two unrelated directories.
	if !projectPathMatchesAny("/Users/nita/a", []string{"/Users/nita/a", "/tmp/b"}) {
		t.Fatal("first selection must match")
	}
	if !projectPathMatchesAny("/tmp/b/child", []string{"/Users/nita/a", "/tmp/b"}) {
		t.Fatal("second selection must match")
	}
	if projectPathMatchesAny("/Users/nita/c", []string{"/Users/nita/a", "/tmp/b"}) {
		t.Fatal("unselected path must not match")
	}
	// Boundary: siblings with a shared name prefix never leak.
	if projectPathMatchesAny("/Users/nita/snorkeling-light-theme", []string{"/Users/nita/snorkeling"}) {
		t.Fatal("same-name-prefix sibling leaked into the selection")
	}
	// Parent + child selection is idempotent with parent-only.
	redundant := projectPathMatchesAny("/p/child/grand", []string{"/p", "/p/child"})
	parentOnly := projectPathMatchesAny("/p/child/grand", []string{"/p"})
	if redundant != parentOnly || !redundant {
		t.Fatalf("redundant parent+child selection changed the result: %v vs %v", redundant, parentOnly)
	}
	// Case-insensitive.
	if !projectPathMatchesAny(`E:\Code\Snorkeling`, []string{`e:\code\snorkeling`}) {
		t.Fatal("expected case-insensitive match")
	}
	// Other sentinel.
	if !projectPathMatchesAny("", []string{ProjectFilterOther}) {
		t.Fatal("sentinel must match empty projectPath")
	}
	if projectPathMatchesAny("/tmp/x", []string{ProjectFilterOther}) {
		t.Fatal("sentinel must not match absolute projectPath")
	}
	// Mixed selection: sentinel + real prefix.
	if !projectPathMatchesAny("relative/dir", []string{ProjectFilterOther, "/tmp/x"}) {
		t.Fatal("mixed selection must match the Other bucket")
	}
	if !projectPathMatchesAny("/tmp/x", []string{ProjectFilterOther, "/tmp/x"}) {
		t.Fatal("mixed selection must match the real prefix")
	}
	if projectPathMatchesAny("/tmp/y", []string{ProjectFilterOther, "/tmp/x"}) {
		t.Fatal("mixed selection must reject unrelated absolute path")
	}
}

func TestProjectPathExcluded(t *testing.T) {
	if projectPathExcluded("/anywhere", nil) {
		t.Fatal("empty exclude list must exclude nothing")
	}
	if !projectPathExcluded("/p/child/grand", []string{"/p"}) {
		t.Fatal("excluding a parent must remove its descendants")
	}
	if projectPathExcluded("/p-sibling", []string{"/p"}) {
		t.Fatal("exclude must not leak into same-name-prefix siblings")
	}
	if !projectPathExcluded("relative/dir", []string{ProjectFilterOther}) {
		t.Fatal("sentinel exclude must remove the Other bucket")
	}
}

func TestSessionTagsExcludeAny(t *testing.T) {
	if sessionTagsExcludeAny([]string{"a"}, nil) {
		t.Fatal("empty exclude list must exclude nothing")
	}
	if sessionTagsExcludeAny(nil, []string{"a"}) {
		t.Fatal("session without tags cannot match an excluded tag")
	}
	if sessionTagsExcludeAny([]string{"review"}, []string{"debug"}) {
		t.Fatal("unrelated exclude must not remove the session")
	}
	if !sessionTagsExcludeAny([]string{"Review", "urgent"}, []string{"#debug", "REVIEW"}) {
		t.Fatal("exclude must normalize case and # prefix")
	}
	if !sessionTagsExcludeAny([]string{"a", "b"}, []string{"b", "c"}) {
		t.Fatal("exclude list is a union: any hit removes the session")
	}
}

func TestSQLiteListMultiSelectProjectsAndExclusions(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	summaries := []SessionSummary{
		{Key: "k1", ID: "s1", Source: SourceCodex, ProjectPath: "/Users/nita/Primary/projects/snorkeling", FilePath: filepath.Join(dir, "s1.jsonl"), Tags: []string{"work"}},
		{Key: "k2", ID: "s2", Source: SourceCodex, ProjectPath: "/Users/nita/Primary/projects/snorkeling/frontend", FilePath: filepath.Join(dir, "s2.jsonl"), Tags: []string{"debug"}},
		{Key: "k3", ID: "s3", Source: SourceCodex, ProjectPath: "/Users/nita/Primary/projects/FileDock", FilePath: filepath.Join(dir, "s3.jsonl"), Tags: []string{"work"}},
		{Key: "k4", ID: "s4", Source: SourceCodex, ProjectPath: "/tmp/scratch", FilePath: filepath.Join(dir, "s4.jsonl"), Tags: []string{"work"}},
		{Key: "k5", ID: "s5", Source: SourceCodex, ProjectPath: "relative/junk", FilePath: filepath.Join(dir, "s5.jsonl"), Tags: []string{"work"}},
	}
	idx, err := OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), summaries, true); len(errs) != 0 {
		t.Fatalf("unexpected save errors: %v", errs)
	}
	defer idx.Close()

	// Tags live in ai_session_meta (they derive from the note), so seed them
	// through the normal meta write path instead of the summary payload.
	for key, tags := range map[string][]string{
		"k1": {"work"},
		"k2": {"debug"},
		"k3": {"work"},
		"k4": {"work"},
		"k5": {"work"},
	} {
		if err := idx.SetNoteAndTags(context.Background(), key, "", tags); err != nil {
			t.Fatal(err)
		}
	}

	keySet := func(opts ListOptions) map[string]bool {
		list, _, err := idx.ListWithDistribution(context.Background(), opts)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, s := range list {
			out[s.Key] = true
		}
		return out
	}

	// Multi-select union.
	got := keySet(ListOptions{Projects: []string{"/Users/nita/Primary/projects/snorkeling", "/tmp/scratch"}, Limit: 0})
	if len(got) != 3 || !got["k1"] || !got["k2"] || !got["k4"] {
		t.Fatalf("multi-select union = %v, want k1+k2+k4", got)
	}

	// Other sentinel is selectable server-side.
	got = keySet(ListOptions{Projects: []string{ProjectFilterOther}, Limit: 0})
	if len(got) != 1 || !got["k5"] {
		t.Fatalf("Other sentinel = %v, want k5 only", got)
	}

	// Exclude a directory prefix (takes its children with it). k5 lives on a
	// relative path and therefore survives.
	got = keySet(ListOptions{ExcludeProjects: []string{"/Users/nita/Primary/projects/snorkeling"}, Limit: 0})
	if len(got) != 3 || !got["k3"] || !got["k4"] || !got["k5"] {
		t.Fatalf("exclude directory = %v, want k3+k4+k5", got)
	}

	// Exclude a tag.
	got = keySet(ListOptions{ExcludeTags: []string{"#debug"}, Limit: 0})
	if len(got) != 4 || got["k2"] {
		t.Fatalf("exclude tag = %v, want everything but k2", got)
	}

	// Include + exclude compose; exclusion wins when a tag is on both sides.
	got = keySet(ListOptions{TagFilters: []string{"work"}, ExcludeTags: []string{"work"}, Limit: 0})
	if len(got) != 0 {
		t.Fatalf("exclusion must win over inclusion, got %v", got)
	}

	// Exclusion applies before the distribution, so counts shrink with the list.
	_, dist, err := idx.ListWithDistribution(context.Background(), ListOptions{ExcludeProjects: []string{"/tmp/scratch"}, Limit: 0})
	if err != nil {
		t.Fatal(err)
	}
	distByPath := map[string]int{}
	for _, d := range dist {
		distByPath[d.Path] = d.Count
	}
	if _, ok := distByPath["/tmp/scratch"]; ok {
		t.Fatalf("excluded path still contributes to the distribution: %#v", distByPath)
	}
	if distByPath["/Users/nita/Primary/projects/snorkeling"] != 1 {
		t.Fatalf("unexpected surviving distribution: %#v", distByPath)
	}

	// The include-side selection must NOT narrow the distribution: users need
	// every directory's true count to keep multi-selecting.
	_, dist, err = idx.ListWithDistribution(context.Background(), ListOptions{Projects: []string{"/tmp/scratch"}, Limit: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(dist) != 5 {
		t.Fatalf("include selection narrowed the distribution to %d entries: %#v", len(dist), dist)
	}
}

func TestJSONIndexMultiSelectProjectsAndExclusions(t *testing.T) {
	dir := t.TempDir()
	indexPath := filepath.Join(dir, "index.json")
	summaries := []SessionSummary{
		{Key: "k1", ID: "s1", Source: SourceCodex, ProjectPath: "/Users/nita/a", FilePath: filepath.Join(dir, "s1.jsonl"), Tags: []string{"work"}},
		{Key: "k2", ID: "s2", Source: SourceCodex, ProjectPath: "/Users/nita/a/child", FilePath: filepath.Join(dir, "s2.jsonl"), Tags: []string{"debug"}},
		{Key: "k3", ID: "s3", Source: SourceCodex, ProjectPath: "/tmp/b", FilePath: filepath.Join(dir, "s3.jsonl"), Tags: []string{"work"}},
		{Key: "k4", ID: "s4", Source: SourceCodex, ProjectPath: "", FilePath: filepath.Join(dir, "s4.jsonl"), Tags: []string{"work"}},
	}
	idx, err := OpenIndex(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, summary := range summaries {
		idx.data.Sessions[summary.Key] = summary
	}
	if err := idx.save(); err != nil {
		t.Fatal(err)
	}

	keySet := func(opts ListOptions) map[string]bool {
		list, err := idx.List(context.Background(), opts)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, s := range list {
			out[s.Key] = true
		}
		return out
	}

	got := keySet(ListOptions{Projects: []string{"/Users/nita/a", ProjectFilterOther}, Limit: 0})
	if len(got) != 3 || !got["k1"] || !got["k2"] || !got["k4"] {
		t.Fatalf("json multi-select + Other = %v, want k1+k2+k4", got)
	}

	got = keySet(ListOptions{ExcludeProjects: []string{"/Users/nita/a"}, ExcludeTags: []string{"work"}, Limit: 0})
	if len(got) != 0 {
		t.Fatalf("json exclusions should empty the list, got %v", got)
	}

	got = keySet(ListOptions{ExcludeTags: []string{"work"}, Limit: 0})
	if len(got) != 1 || !got["k2"] {
		t.Fatalf("json exclude tags = %v, want k2", got)
	}
}

func TestManagerSearchAppliesProjectsAndExclusions(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: "k1", ID: "s1", Source: SourceCodex, ProjectPath: "/Users/nita/a", FilePath: filepath.Join(dir, "s1.jsonl"), Title: "alpha", Tags: []string{"work"}},
			{Key: "k2", ID: "s2", Source: SourceCodex, ProjectPath: "/Users/nita/a", FilePath: filepath.Join(dir, "s2.jsonl"), Title: "alpha", Tags: []string{"debug"}},
			{Key: "k3", ID: "s3", Source: SourceCodex, ProjectPath: "/tmp/b", FilePath: filepath.Join(dir, "s3.jsonl"), Title: "alpha"},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})
	ctx := context.Background()
	if _, err := manager.ScanList(ctx, ListOptions{}, ""); err != nil {
		t.Fatal(err)
	}

	matches, err := manager.Search(ctx, SearchOptions{Query: "alpha", Projects: []string{"/Users/nita/a"}, Limit: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("search with multi-select = %d matches, want 2: %#v", len(matches), matches)
	}

	matches, err = manager.Search(ctx, SearchOptions{Query: "alpha", ExcludeTags: []string{"debug"}, Limit: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("search with exclude tag = %d matches, want 2: %#v", len(matches), matches)
	}

	matches, err = manager.Search(ctx, SearchOptions{Query: "alpha", ExcludeProjects: []string{"/tmp/b"}, Limit: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("search with exclude project = %d matches, want 2: %#v", len(matches), matches)
	}
}

func TestSessionMatchesTagPresenceUntaggedWithExcludeTags(t *testing.T) {
	untagged := SessionSummary{Key: "k1", ID: "s1", Source: SourceCodex, ProjectPath: "/Users/nita/a"}
	tagged := SessionSummary{Key: "k2", ID: "s2", Source: SourceCodex, ProjectPath: "/Users/nita/b", Tags: []string{"work"}}

	opts := ListOptions{TagPresence: TagPresenceUntagged, ExcludeTags: []string{"debug"}}
	if !summaryMatchesList(untagged, opts) {
		t.Fatalf("untagged summary should satisfy %#v even though ExcludeTags is set", opts)
	}
	if summaryMatchesList(tagged, opts) {
		t.Fatalf("tagged summary must not satisfy %#v", opts)
	}
}
