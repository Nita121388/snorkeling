// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextstore

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestMain(m *testing.M) {
	tmpDir, err := os.MkdirTemp("", "commontextstore-test-*")
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

func resetCommonTextTestState(t *testing.T, settings waveobj.MetaMapType) {
	t.Helper()
	if settings == nil {
		settings = make(waveobj.MetaMapType)
	}
	if err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM db_common_text`)
		return nil
	}); err != nil {
		t.Fatalf("clear common text db: %v", err)
	}
	if err := wconfig.WriteWaveHomeConfigFile(wconfig.SettingsFile, settings); err != nil {
		t.Fatalf("write settings: %v", err)
	}
}

func mustReadCommonTextTestSettings(t *testing.T) waveobj.MetaMapType {
	t.Helper()
	settings, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.SettingsFile)
	if len(cerrs) > 0 {
		t.Fatalf("read settings: %v", cerrs[0])
	}
	return settings
}

func TestMigrateCommonTextItemsImportsVerifiesAndBacksUpLegacy(t *testing.T) {
	legacyItems := []commonTextItem{{
		Id:        "11111111-1111-1111-1111-111111111111",
		Title:     "Research",
		Text:      "deep research prompt",
		Tags:      []string{"study"},
		CreatedAt: 1700000000000,
		UpdatedAt: 1700000000000,
	}}
	resetCommonTextTestState(t, waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: legacyItems,
	})

	MigrateCommonTextItems()

	dbItems, err := loadCommonTextItemsFromDB()
	if err != nil {
		t.Fatalf("load migrated items: %v", err)
	}
	if len(dbItems) != 1 {
		t.Fatalf("expected 1 migrated item, got %d", len(dbItems))
	}
	if dbItems[0].Id != legacyItems[0].Id || dbItems[0].Text != legacyItems[0].Text {
		t.Fatalf("migrated item mismatch: %#v", dbItems[0])
	}

	settings := mustReadCommonTextTestSettings(t)
	if settings.HasKey(wconfig.ConfigKey_CommonTextItems) {
		t.Fatalf("legacy common text key should be moved out of active settings")
	}
	if backupItems := settings.GetArray(commonTextMigratedBackupKey); len(backupItems) != 1 {
		t.Fatalf("expected migrated backup with 1 item, got %#v", settings[commonTextMigratedBackupKey])
	}
	if migrationMeta := settings.GetMap(commonTextMigrationMetaKey); migrationMeta == nil {
		t.Fatalf("expected migration metadata")
	}
}

func TestSaveFromConfigMapRejectsAccidentalEmptySaveAfterMigrationBackup(t *testing.T) {
	resetCommonTextTestState(t, waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []commonTextItem{{
			Id:        "22222222-2222-2222-2222-222222222222",
			Title:     "Saved",
			Text:      "keep me",
			CreatedAt: 1700000000000,
			UpdatedAt: 1700000000000,
		}},
	})
	MigrateCommonTextItems()

	updated, err := SaveFromConfigMap(waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []any{},
	})
	if !updated {
		t.Fatalf("expected common text update to be handled")
	}
	if err == nil {
		t.Fatalf("expected accidental empty save to be rejected")
	}

	dbItems, err := loadCommonTextItemsFromDB()
	if err != nil {
		t.Fatalf("load common text db: %v", err)
	}
	if len(dbItems) != 1 || dbItems[0].Text != "keep me" {
		t.Fatalf("expected db item to be preserved, got %#v", dbItems)
	}
}

func TestSaveFromConfigMapRejectsInvalidItemsThatWouldClearDB(t *testing.T) {
	resetCommonTextTestState(t, waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []commonTextItem{{
			Id:        "33333333-3333-3333-3333-333333333333",
			Title:     "Saved",
			Text:      "keep me",
			CreatedAt: 1700000000000,
			UpdatedAt: 1700000000000,
		}},
	})
	MigrateCommonTextItems()

	updated, err := SaveFromConfigMap(waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []commonTextItem{{Title: "empty", Text: "  "}},
	})
	if !updated {
		t.Fatalf("expected common text update to be handled")
	}
	if err == nil {
		t.Fatalf("expected invalid item save to be rejected")
	}

	dbItems, err := loadCommonTextItemsFromDB()
	if err != nil {
		t.Fatalf("load common text db: %v", err)
	}
	if len(dbItems) != 1 || dbItems[0].Text != "keep me" {
		t.Fatalf("expected db item to be preserved, got %#v", dbItems)
	}
}

func TestSaveFromConfigMapAllowsExplicitEmptySave(t *testing.T) {
	resetCommonTextTestState(t, waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []commonTextItem{{
			Id:        "44444444-4444-4444-4444-444444444444",
			Title:     "Delete",
			Text:      "delete me",
			CreatedAt: 1700000000000,
			UpdatedAt: 1700000000000,
		}},
	})
	MigrateCommonTextItems()

	updated, err := SaveFromConfigMap(waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []any{},
		commonTextAllowEmptySaveKey:       true,
	})
	if !updated {
		t.Fatalf("expected common text update to be handled")
	}
	if err != nil {
		t.Fatalf("explicit empty save should be allowed: %v", err)
	}

	dbItems, err := loadCommonTextItemsFromDB()
	if err != nil {
		t.Fatalf("load common text db: %v", err)
	}
	if len(dbItems) != 0 {
		t.Fatalf("expected db to be cleared, got %#v", dbItems)
	}
}
