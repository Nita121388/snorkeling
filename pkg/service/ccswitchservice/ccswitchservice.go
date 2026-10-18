// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package ccswitchservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

type CcSwitchService struct{}
type ImportWaveAIRequest struct {
	VendorID string `json:"vendorId"`
	Model    string `json:"model,omitempty"`
}
type ImportWaveAIResponse struct {
	ModeKey    string `json:"modeKey"`
	SecretName string `json:"secretName,omitempty"`
	Model      string `json:"model"`
}

func (s *CcSwitchService) ImportWaveAI_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{Desc: "import a redacted cc-switch provider into Wave AI", ArgNames: []string{"ctx", "request"}, ReturnDesc: "imported Wave AI mode"}
}
func (s *CcSwitchService) ImportWaveAI(ctx context.Context, req *ImportWaveAIRequest) (*ImportWaveAIResponse, error) {
	if req == nil || strings.TrimSpace(req.VendorID) == "" {
		return nil, fmt.Errorf("vendorId is required")
	}
	data, err := ccswitch.GetWaveAIImportData(ctx, strings.TrimSpace(req.VendorID))
	if err != nil {
		return nil, err
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = data.Vendor.DefaultModel
	}
	if model == "" && len(data.Vendor.Models) > 0 {
		model = data.Vendor.Models[0]
	}
	if model == "" {
		return nil, fmt.Errorf("provider has no model")
	}
	key := "ccswitch@" + sanitize(data.Vendor.ID) + "@" + sanitize(model)
	if key == "ccswitch@@" {
		return nil, fmt.Errorf("invalid provider id")
	}
	secretName := ""
	if data.Token != "" {
		secretName = "CCSWITCH_" + sanitizeSecret(data.Vendor.ID)
		if err := secretstore.SetSecret(secretName, data.Token); err != nil {
			return nil, err
		}
	}
	path := filepath.Join(wavebase.GetWaveConfigDir(), "waveai.json")
	raw := map[string]map[string]any{}
	if b, e := os.ReadFile(path); e == nil && len(b) > 0 {
		_ = json.Unmarshal(b, &raw)
	}
	config := map[string]any{"display:name": data.Vendor.Name + " · " + model, "ai:provider": "custom", "ai:apitype": data.Vendor.APIType, "ai:model": model, "ai:endpoint": data.Vendor.Endpoint, "ai:apitokensecretname": secretName}
	if config["ai:apitype"] == "" {
		config["ai:apitype"] = "openai-chat"
	}
	raw[key] = config
	b, _ := json.MarshalIndent(raw, "", "  ")
	if err := os.WriteFile(path, b, 0600); err != nil {
		return nil, err
	}
	return &ImportWaveAIResponse{ModeKey: key, SecretName: secretName, Model: model}, nil
}
func sanitize(s string) string {
	r := regexp.MustCompile(`[^A-Za-z0-9_-]+`)
	return strings.Trim(r.ReplaceAllString(s, "-"), "-")
}
func sanitizeSecret(s string) string {
	r := regexp.MustCompile(`[^A-Za-z0-9_]+`)
	v := strings.ToUpper(r.ReplaceAllString(s, "_"))
	if v == "" || v[0] < 'A' || v[0] > 'Z' {
		v = "PROVIDER_" + v
	}
	return v
}
