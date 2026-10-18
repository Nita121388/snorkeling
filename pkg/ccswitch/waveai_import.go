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

func GetWaveAIImportData(ctx context.Context, vendorID string) (*WaveAIImportData, error) {
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
		ID, Name, AppType, SettingsJSON, Category string
		IsCurrent                                 sql.NullBool
	}
	if err := db.GetContext(ctx, &row, `SELECT id, name, app_type, settings_config, category, is_current FROM providers WHERE id = ? AND app_type IN (?, ?, ?) LIMIT 1`, vendorID, CcSwitchProviderAppTypeOpenCode, "openclaw", "custom"); err != nil {
		return nil, fmt.Errorf("cc-switch provider not found")
	}
	var raw struct {
		BaseURL  string            `json:"baseUrl"`
		Endpoint string            `json:"endpoint"`
		APIType  string            `json:"api"`
		Model    string            `json:"model"`
		APIKey   string            `json:"apiKey"`
		Env      map[string]string `json:"env"`
		Models   []json.RawMessage `json:"models"`
	}
	if err := json.Unmarshal([]byte(row.SettingsJSON), &raw); err != nil {
		return nil, fmt.Errorf("invalid cc-switch provider configuration")
	}
	endpoint := raw.BaseURL
	if endpoint == "" {
		endpoint = raw.Endpoint
	}
	if strings.TrimSpace(endpoint) == "" {
		return nil, fmt.Errorf("cc-switch provider has no endpoint")
	}
	models := []string{}
	for _, item := range raw.Models {
		var s string
		if json.Unmarshal(item, &s) == nil && s != "" {
			models = append(models, s)
			continue
		}
		var obj struct {
			ID    string `json:"id"`
			Model string `json:"model"`
			Name  string `json:"name"`
		}
		if json.Unmarshal(item, &obj) == nil {
			for _, v := range []string{obj.ID, obj.Model, obj.Name} {
				if v != "" {
					models = append(models, v)
					break
				}
			}
		}
	}
	if raw.Model != "" {
		models = append([]string{raw.Model}, models...)
	}
	if raw.APIKey == "" {
		for _, key := range []string{"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "API_KEY"} {
			if value := strings.TrimSpace(raw.Env[key]); value != "" {
				raw.APIKey = value
				break
			}
		}
	}
	return &WaveAIImportData{Vendor: WaveAIVendor{ID: row.ID, Name: row.Name, AppType: row.AppType, Category: row.Category, Endpoint: endpoint, APIType: raw.APIType, Models: uniqueStrings(models), DefaultModel: raw.Model, IsCurrent: row.IsCurrent.Valid && row.IsCurrent.Bool}, Token: strings.TrimSpace(raw.APIKey)}, nil
}
