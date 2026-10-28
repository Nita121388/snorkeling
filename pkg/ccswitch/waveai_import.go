// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type WaveAIImportData struct {
	Vendor WaveAIVendor
	Token  string
}

func extractModelIDs(raw json.RawMessage) []string {
	var values []json.RawMessage
	if len(raw) > 0 && json.Unmarshal(raw, &values) != nil {
		var keyed map[string]json.RawMessage
		if json.Unmarshal(raw, &keyed) == nil {
			for key, value := range keyed {
				var obj struct {
					ID    string `json:"id"`
					Model string `json:"model"`
					Name  string `json:"name"`
				}
				if json.Unmarshal(value, &obj) == nil {
					for _, candidate := range []string{obj.ID, obj.Model, obj.Name} {
						if candidate != "" {
							values = append(values, json.RawMessage(`"`+candidate+`"`))
							break
						}
					}
				} else {
					values = append(values, json.RawMessage(`"`+key+`"`))
				}
			}
		}
	}
	models := []string{}
	for _, item := range values {
		var text string
		if json.Unmarshal(item, &text) == nil && text != "" {
			models = append(models, text)
			continue
		}
		var obj struct {
			ID    string `json:"id"`
			Model string `json:"model"`
			Name  string `json:"name"`
		}
		if json.Unmarshal(item, &obj) == nil {
			for _, candidate := range []string{obj.ID, obj.Model, obj.Name} {
				if candidate != "" {
					models = append(models, candidate)
					break
				}
			}
		}
	}
	return uniqueStrings(models)
}

// GetWaveAIImportData reads a single provider for import. appType ("pi"/"hermes")
// disambiguates the vendor id when the same id exists under more than one app type
// (e.g. "deepseek" exists in both hermes and pi); an empty appType means any eligible type.
func GetWaveAIImportData(ctx context.Context, vendorID, appType string) (*WaveAIImportData, error) {
	path, err := DBPath()
	if err != nil {
		return nil, err
	}
	db, err := openReadOnly(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("cc-switch database unavailable")
	}
	defer db.Close()
	var row struct {
		ID           string         `db:"id"`
		Name         string         `db:"name"`
		AppType      string         `db:"app_type"`
		SettingsJSON string         `db:"settings_config"`
		Category     sql.NullString `db:"category"`
		IsCurrent    sql.NullBool   `db:"is_current"`
	}
	// Same eligibility set as ListWaveAIVendors: pi (camelCase) + hermes (snake_case).
	query := `SELECT id, name, app_type, settings_config, category, is_current FROM providers WHERE id = ? AND app_type IN (?, ?) LIMIT 1`
	args := []any{vendorID, CcSwitchProviderAppTypePi, CcSwitchProviderAppTypeHermes}
	if trimmed := strings.TrimSpace(appType); trimmed != "" {
		query = `SELECT id, name, app_type, settings_config, category, is_current FROM providers WHERE id = ? AND app_type = ? LIMIT 1`
		args = []any{vendorID, trimmed}
	}
	if err := db.GetContext(ctx, &row, query, args...); err != nil {
		return nil, fmt.Errorf("cc-switch provider not found")
	}
	settings, ok := parseWaveAISettings(row.AppType, row.SettingsJSON)
	if !ok {
		return nil, fmt.Errorf("cc-switch provider has no endpoint")
	}
	return &WaveAIImportData{
		Vendor: WaveAIVendor{
			ID:           row.ID,
			Name:         row.Name,
			AppType:      row.AppType,
			Category:     row.Category.String,
			Endpoint:     settings.Endpoint,
			APIType:      settings.APIType,
			Models:       settings.Models,
			DefaultModel: settings.DefaultModel,
			IsCurrent:    row.IsCurrent.Valid && row.IsCurrent.Bool,
		},
		Token: settings.APIKey,
	}, nil
}
