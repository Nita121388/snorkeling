// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextstore

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func saveItemsForTest(t *testing.T, items []wconfig.CommonTextItemType) {
	t.Helper()
	settings := waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: items,
		commonTextAllowEmptySaveKey:       true,
	}
	if _, err := SaveFromConfigMap(settings); err != nil {
		t.Fatalf("save items: %v", err)
	}
}

// A row written before sync metadata existed must read back with stable defaults and must not
// be rewritten by the read path (that would turn an upgrade into a full table write).
func TestLegacyRowsGetSyncDefaultsOnRead(t *testing.T) {
	resetCommonTextTestState(t, nil)
	if err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(
			`INSERT INTO db_common_text (id, title, text, tags, pinned, createdat, updatedat, usagecount)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			"legacy-1", "Legacy item", "body", "[]", 0, 1000, 2000, 3,
		)
		return nil
	}); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}

	items, err := List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	item := items[0]
	if item.CreatedBy == nil || item.CreatedBy.Kind != "human" || item.CreatedBy.Name != "" {
		t.Fatalf("expected human/empty createdBy default, got %+v", item.CreatedBy)
	}
	if item.Origin == nil || item.Origin.DeviceId != "local" || item.Origin.DeviceName != "This machine" {
		t.Fatalf("expected local device default, got %+v", item.Origin)
	}
	if item.Rev != 0 {
		t.Fatalf("expected rev 0, got %v", item.Rev)
	}
	if item.DeletedAt != 0 {
		t.Fatalf("expected no tombstone, got %v", item.DeletedAt)
	}

	// Read path must not have written anything back.
	var kind *string
	if err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Select(&[]struct {
			Kind *string `db:"createdby_kind"`
		}{}, `SELECT createdby_kind FROM db_common_text`)
		var rows []struct {
			Kind *string `db:"createdby_kind"`
		}
		tx.Select(&rows, `SELECT createdby_kind FROM db_common_text WHERE id = ?`, "legacy-1")
		if len(rows) > 0 {
			kind = rows[0].Kind
		}
		return nil
	}); err != nil {
		t.Fatalf("read raw column: %v", err)
	}
	if kind != nil {
		t.Fatalf("read path must not backfill the column, got %q", *kind)
	}
}

func TestSyncMetadataRoundTrip(t *testing.T) {
	resetCommonTextTestState(t, nil)
	items := []wconfig.CommonTextItemType{
		{
			Id:    "meta-1",
			Title: "Agent note",
			Text:  "body",
			CreatedBy: &wconfig.CommonTextCreatedByType{
				Kind: "agent",
				Name: "pi",
			},
			Origin: &wconfig.CommonTextOriginType{
				DeviceId:   "dev-home-7c3a",
				DeviceName: "Home PC",
				Platform:   "win32",
			},
			Rev: 7,
		},
	}
	saveItemsForTest(t, items)

	got, found, err := Get(context.Background(), "meta-1")
	if err != nil || !found {
		t.Fatalf("get: found=%v err=%v", found, err)
	}
	if got.CreatedBy == nil || got.CreatedBy.Kind != "agent" || got.CreatedBy.Name != "pi" {
		t.Fatalf("createdBy lost: %+v", got.CreatedBy)
	}
	if got.Origin == nil || got.Origin.DeviceId != "dev-home-7c3a" ||
		got.Origin.DeviceName != "Home PC" || got.Origin.Platform != "win32" {
		t.Fatalf("origin lost: %+v", got.Origin)
	}
	if got.Rev != 7 {
		t.Fatalf("rev lost: %v", got.Rev)
	}
}

func TestCreatorAndDeviceFilters(t *testing.T) {
	resetCommonTextTestState(t, nil)
	home := &wconfig.CommonTextOriginType{DeviceId: "dev-home", DeviceName: "Home PC", Platform: "win32"}
	work := &wconfig.CommonTextOriginType{DeviceId: "dev-work", DeviceName: "Work Mac", Platform: "darwin"}
	items := []wconfig.CommonTextItemType{
		{Id: "a", Title: "A", Text: "a", CreatedBy: &wconfig.CommonTextCreatedByType{Kind: "human", Name: "Nita"}, Origin: home},
		{Id: "b", Title: "B", Text: "b", CreatedBy: &wconfig.CommonTextCreatedByType{Kind: "agent", Name: "pi"}, Origin: home},
		{Id: "c", Title: "C", Text: "c", CreatedBy: &wconfig.CommonTextCreatedByType{Kind: "human", Name: "Nita"}, Origin: work},
		{Id: "d", Title: "D", Text: "d", CreatedBy: &wconfig.CommonTextCreatedByType{Kind: "agent", Name: "codex"}, Origin: work},
	}
	saveItemsForTest(t, items)

	cases := []struct {
		name    string
		opts    ListOptions
		wantIDs []string
	}{
		{"no filter", ListOptions{}, []string{"a", "b", "c", "d"}},
		{"human only", ListOptions{CreatorFilter: "human"}, []string{"a", "c"}},
		{"agent only", ListOptions{CreatorFilter: "agent"}, []string{"b", "d"}},
		{"all creator", ListOptions{CreatorFilter: "all"}, []string{"a", "b", "c", "d"}},
		{"unknown creator falls through", ListOptions{CreatorFilter: "robot"}, []string{"a", "b", "c", "d"}},
		{"device home", ListOptions{DeviceFilter: "dev-home"}, []string{"a", "b"}},
		{"device work", ListOptions{DeviceFilter: "dev-work"}, []string{"c", "d"}},
		{"device any", ListOptions{DeviceFilter: "any"}, []string{"a", "b", "c", "d"}},
		{"human on work", ListOptions{CreatorFilter: "human", DeviceFilter: "dev-work"}, []string{"c"}},
		{"agent on home", ListOptions{CreatorFilter: "agent", DeviceFilter: "dev-home"}, []string{"b"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := List(context.Background(), tc.opts)
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			if len(got) != len(tc.wantIDs) {
				t.Fatalf("expected %d items (%v), got %d", len(tc.wantIDs), tc.wantIDs, len(got))
			}
			seen := make(map[string]bool, len(got))
			for _, item := range got {
				seen[item.Id] = true
			}
			for _, id := range tc.wantIDs {
				if !seen[id] {
					t.Fatalf("expected id %q in result, got %v", id, seen)
				}
			}
		})
	}
}

func TestTombstonesHiddenByDefault(t *testing.T) {
	resetCommonTextTestState(t, nil)
	items := []wconfig.CommonTextItemType{
		{Id: "alive", Title: "Alive", Text: "a"},
		{Id: "gone", Title: "Gone", Text: "b", DeletedAt: 5000},
	}
	saveItemsForTest(t, items)

	visible, err := List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(visible) != 1 || visible[0].Id != "alive" {
		t.Fatalf("expected only the alive item, got %+v", visible)
	}

	all, err := List(context.Background(), ListOptions{IncludeDeleted: true})
	if err != nil {
		t.Fatalf("list with deleted: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 items with IncludeDeleted, got %d", len(all))
	}
	var tombstone commonTextItem
	for _, item := range all {
		if item.Id == "gone" {
			tombstone = item
		}
	}
	if tombstone.DeletedAt != 5000 {
		t.Fatalf("tombstone timestamp lost: %v", tombstone.DeletedAt)
	}
}

func TestLegacyItemMatchesLocalDeviceFilter(t *testing.T) {
	resetCommonTextTestState(t, nil)
	if err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(
			`INSERT INTO db_common_text (id, title, text, tags, pinned, createdat, updatedat, usagecount)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			"legacy-2", "Legacy", "body", "[]", 0, 1000, 2000, 0,
		)
		return nil
	}); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	got, err := List(context.Background(), ListOptions{DeviceFilter: "local"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("legacy row should match the local device filter, got %d", len(got))
	}
	human, err := List(context.Background(), ListOptions{CreatorFilter: "human"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(human) != 1 {
		t.Fatalf("legacy row should count as human, got %d", len(human))
	}
}
