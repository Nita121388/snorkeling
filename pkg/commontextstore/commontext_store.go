// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/util/dbutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type commonTextItem = wconfig.CommonTextItemType

type commonTextDBRow struct {
	ID         string  `db:"id"`
	Title      string  `db:"title"`
	Text       string  `db:"text"`
	Shortcut   *string `db:"shortcut"`
	Tags       string  `db:"tags"`
	Pinned     int64   `db:"pinned"`
	CreatedAt  int64   `db:"createdat"`
	UpdatedAt  int64   `db:"updatedat"`
	LastUsedAt *int64  `db:"lastusedat"`
	UsageCount int64   `db:"usagecount"`
}

func normalizeCommonTextTitle(title string, text string) string {
	normalizedTitle := strings.TrimSpace(title)
	if normalizedTitle != "" {
		return normalizedTitle
	}
	firstLine := ""
	for _, line := range strings.Split(text, "\n") {
		trimmedLine := strings.TrimSpace(line)
		if trimmedLine == "" {
			continue
		}
		firstLine = trimmedLine
		break
	}
	if firstLine == "" {
		return "Untitled text"
	}
	runes := []rune(firstLine)
	if len(runes) <= 48 {
		return firstLine
	}
	return string(runes[:45]) + "..."
}

func normalizeCommonTextTags(tags []string) []string {
	seen := make(map[string]struct{})
	rtn := make([]string, 0, len(tags))
	for _, tag := range tags {
		normalized := strings.TrimSpace(tag)
		if normalized == "" {
			continue
		}
		lower := strings.ToLower(normalized)
		if _, found := seen[lower]; found {
			continue
		}
		seen[lower] = struct{}{}
		rtn = append(rtn, normalized)
	}
	return rtn
}

func sortCommonTextItems(items []commonTextItem) []commonTextItem {
	rtn := append([]commonTextItem(nil), items...)
	sort.Slice(rtn, func(i, j int) bool {
		if rtn[i].Pinned != rtn[j].Pinned {
			return rtn[i].Pinned
		}
		if rtn[i].LastUsedAt != rtn[j].LastUsedAt {
			return rtn[i].LastUsedAt > rtn[j].LastUsedAt
		}
		if rtn[i].UpdatedAt != rtn[j].UpdatedAt {
			return rtn[i].UpdatedAt > rtn[j].UpdatedAt
		}
		return strings.Compare(rtn[i].Title, rtn[j].Title) < 0
	})
	return rtn
}

func normalizeCommonTextItem(item commonTextItem, nowMs int64) (commonTextItem, bool) {
	text := strings.TrimSpace(item.Text)
	if text == "" {
		return commonTextItem{}, false
	}

	normalized := commonTextItem{
		Id:         strings.TrimSpace(item.Id),
		Title:      normalizeCommonTextTitle(item.Title, item.Text),
		Text:       item.Text,
		Shortcut:   strings.TrimSpace(item.Shortcut),
		Tags:       normalizeCommonTextTags(item.Tags),
		Pinned:     item.Pinned,
		CreatedAt:  item.CreatedAt,
		UpdatedAt:  item.UpdatedAt,
		LastUsedAt: item.LastUsedAt,
		UsageCount: item.UsageCount,
	}
	if normalized.Id == "" {
		normalized.Id = uuid.NewString()
	}
	if normalized.CreatedAt <= 0 {
		normalized.CreatedAt = float64(nowMs)
	}
	if normalized.UpdatedAt <= 0 {
		normalized.UpdatedAt = normalized.CreatedAt
	}
	if normalized.LastUsedAt <= 0 {
		normalized.LastUsedAt = 0
	}
	if normalized.UsageCount < 0 {
		normalized.UsageCount = 0
	}
	return normalized, true
}

func normalizeCommonTextItems(items []commonTextItem) []commonTextItem {
	nowMs := time.Now().UnixMilli()
	seenText := make(map[string]struct{}, len(items))
	normalizedItems := make([]commonTextItem, 0, len(items))
	for _, item := range items {
		normalizedItem, ok := normalizeCommonTextItem(item, nowMs)
		if !ok {
			continue
		}
		textKey := strings.TrimSpace(normalizedItem.Text)
		if _, found := seenText[textKey]; found {
			continue
		}
		seenText[textKey] = struct{}{}
		normalizedItems = append(normalizedItems, normalizedItem)
	}
	return sortCommonTextItems(normalizedItems)
}

func commonTextItemsFromValue(value any) ([]commonTextItem, error) {
	if value == nil {
		return nil, nil
	}
	rawBytes, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var items []commonTextItem
	if err := json.Unmarshal(rawBytes, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func commonTextItemsToDBRows(items []commonTextItem) []commonTextDBRow {
	rows := make([]commonTextDBRow, 0, len(items))
	for _, item := range items {
		row := commonTextDBRow{
			ID:         item.Id,
			Title:      item.Title,
			Text:       item.Text,
			Tags:       dbutil.QuickJsonArr(item.Tags),
			Pinned:     0,
			CreatedAt:  int64(item.CreatedAt),
			UpdatedAt:  int64(item.UpdatedAt),
			UsageCount: int64(item.UsageCount),
		}
		if item.Shortcut != "" {
			shortcut := item.Shortcut
			row.Shortcut = &shortcut
		}
		if item.Pinned {
			row.Pinned = 1
		}
		if item.LastUsedAt > 0 {
			lastUsedAt := int64(item.LastUsedAt)
			row.LastUsedAt = &lastUsedAt
		}
		rows = append(rows, row)
	}
	return rows
}

func commonTextItemsFromDBRows(rows []commonTextDBRow) []commonTextItem {
	items := make([]commonTextItem, 0, len(rows))
	for _, row := range rows {
		item := commonTextItem{
			Id:         row.ID,
			Title:      row.Title,
			Text:       row.Text,
			Pinned:     row.Pinned != 0,
			CreatedAt:  float64(row.CreatedAt),
			UpdatedAt:  float64(row.UpdatedAt),
			UsageCount: float64(row.UsageCount),
		}
		if row.Shortcut != nil {
			item.Shortcut = *row.Shortcut
		}
		if row.LastUsedAt != nil {
			item.LastUsedAt = float64(*row.LastUsedAt)
		}
		if tags := dbutil.ParseJsonArr[string](row.Tags); len(tags) > 0 {
			item.Tags = normalizeCommonTextTags(tags)
		}
		items = append(items, item)
	}
	return sortCommonTextItems(items)
}

func commonTextNullableString(val *string) any {
	if val == nil {
		return nil
	}
	return *val
}

func commonTextNullableInt64(val *int64) any {
	if val == nil {
		return nil
	}
	return *val
}

func loadCommonTextItemsFromDB() ([]commonTextItem, error) {
	if !wstore.IsInitialized() {
		return nil, nil
	}
	return wstore.WithTxRtn(context.Background(), func(tx *wstore.TxWrap) ([]commonTextItem, error) {
		var rows []commonTextDBRow
		query := `SELECT id, title, text, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount FROM db_common_text`
		tx.Select(&rows, query)
		return commonTextItemsFromDBRows(rows), nil
	})
}

func saveCommonTextItemsToDB(items []commonTextItem) error {
	if !wstore.IsInitialized() {
		return fmt.Errorf("wstore is not initialized")
	}
	normalizedItems := normalizeCommonTextItems(items)
	normalizedRows := commonTextItemsToDBRows(normalizedItems)
	return wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		if len(normalizedRows) == 0 {
			tx.Exec(`DELETE FROM db_common_text`)
			return nil
		}
		ids := make([]string, 0, len(normalizedRows))
		for _, row := range normalizedRows {
			ids = append(ids, row.ID)
			tx.Exec(
				`INSERT INTO db_common_text (
					id, title, text, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					title = excluded.title,
					text = excluded.text,
					shortcut = excluded.shortcut,
					tags = excluded.tags,
					pinned = excluded.pinned,
					createdat = excluded.createdat,
					updatedat = excluded.updatedat,
					lastusedat = excluded.lastusedat,
					usagecount = excluded.usagecount`,
				row.ID,
				row.Title,
				row.Text,
				commonTextNullableString(row.Shortcut),
				row.Tags,
				row.Pinned,
				row.CreatedAt,
				row.UpdatedAt,
				commonTextNullableInt64(row.LastUsedAt),
				row.UsageCount,
			)
		}
		tx.Exec(`DELETE FROM db_common_text WHERE id NOT IN (SELECT value FROM json_each(?))`, dbutil.QuickJsonArr(ids))
		return nil
	})
}

func SaveFromConfigMap(settings waveobj.MetaMapType) (bool, error) {
	value, found := settings[wconfig.ConfigKey_CommonTextItems]
	if !found {
		return false, nil
	}
	delete(settings, wconfig.ConfigKey_CommonTextItems)
	items, err := commonTextItemsFromValue(value)
	if err != nil {
		return true, err
	}
	return true, saveCommonTextItemsToDB(items)
}

func HydrateFullConfig(fullConfig *wconfig.FullConfigType) {
	items, err := loadCommonTextItemsFromDB()
	if err != nil || items == nil {
		return
	}
	fullConfig.Settings.CommonTextItems = items
}

func MigrateCommonTextItems() {
	settings, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.SettingsFile)
	if len(cerrs) > 0 {
		log.Printf("error reading settings file for common text migration: %v\n", cerrs[0])
		return
	}
	if settings == nil {
		return
	}
	if !settings.HasKey(wconfig.ConfigKey_CommonTextItems) {
		return
	}
	rawItems := settings.GetArray(wconfig.ConfigKey_CommonTextItems)
	if rawItems == nil {
		log.Printf("common text migration skipped: %s is not an array\n", wconfig.ConfigKey_CommonTextItems)
		return
	}

	existingItems, err := loadCommonTextItemsFromDB()
	if err != nil {
		log.Printf("error loading common text items from db during migration: %v\n", err)
		return
	}
	if len(existingItems) == 0 {
		items, err := commonTextItemsFromValue(rawItems)
		if err != nil {
			log.Printf("error parsing common text items during migration: %v\n", err)
			return
		}
		if err := saveCommonTextItemsToDB(items); err != nil {
			log.Printf("error saving common text items during migration: %v\n", err)
			return
		}
		log.Printf("migrated %d common text items to database\n", len(items))
	} else {
		log.Printf("common text database already populated, skipping import\n")
	}

	delete(settings, wconfig.ConfigKey_CommonTextItems)
	if err := wconfig.WriteWaveHomeConfigFile(wconfig.SettingsFile, settings); err != nil {
		log.Printf("error removing legacy common text items from settings file: %v\n", err)
	}
}
