// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const redactedValue = "[REDACTED]"

type VendorIsolationFileStatus struct {
	Name         string `json:"name"`
	Exists       bool   `json:"exists"`
	Size         int64  `json:"size,omitempty"`
	LastModified int64  `json:"lastmodified,omitempty"`
}

type VendorIsolationStatus struct {
	AppType           string                      `json:"apptype"`
	VendorID          string                      `json:"vendorid"`
	VendorName        string                      `json:"vendorname"`
	State             string                      `json:"state"`
	ConfigDir         string                      `json:"configdir,omitempty"`
	Files             []VendorIsolationFileStatus `json:"files"`
	TopLevelKeys      []string                    `json:"toplevelkeys,omitempty"`
	EnvCount          int                         `json:"envcount,omitempty"`
	HookEventCount    int                         `json:"hookeventcount,omitempty"`
	InheritanceSource string                      `json:"inheritancesource"`
	RedactedJSON      string                      `json:"redactedjson,omitempty"`
	Warning           string                      `json:"warning,omitempty"`
}

func GetVendorIsolationStatus(ctx context.Context, appType string, vendorID string) (*VendorIsolationStatus, error) {
	appType = strings.TrimSpace(strings.ToLower(appType))
	vendorID = strings.TrimSpace(vendorID)
	if appType != CcSwitchProviderAppType && appType != CcSwitchProviderAppTypeCodex {
		return nil, fmt.Errorf("unsupported app type %q", appType)
	}
	if !validVendorID(vendorID) {
		return nil, fmt.Errorf("invalid vendor id")
	}
	var list *VendorList
	var err error
	if appType == CcSwitchProviderAppTypeCodex {
		list, err = ListCodexVendors(ctx)
	} else {
		list, err = ListClaudeVendors(ctx)
	}
	if err != nil || list == nil || !list.Detected {
		return nil, fmt.Errorf("cc-switch vendor data is unavailable")
	}
	for _, vendor := range list.Vendors {
		if vendor.ID == vendorID {
			status := readVendorIsolationStatus(appType, vendor)
			log.Printf("[ccswitch-diagnostic] apptype=%q vendor=%q state=%q configdir=%q", appType, vendorID, status.State, status.ConfigDir)
			return status, nil
		}
	}
	return nil, fmt.Errorf("vendor not found")
}

func readVendorIsolationStatus(appType string, vendor Vendor) *VendorIsolationStatus {
	status := &VendorIsolationStatus{
		AppType:    appType,
		VendorID:   vendor.ID,
		VendorName: vendor.Name,
		State:      "global",
		Files:      []VendorIsolationFileStatus{},
	}
	var fileNames []string
	if appType == CcSwitchProviderAppTypeCodex {
		status.ConfigDir = vendor.CodexConfigDir
		status.InheritanceSource = "Global ~/.codex/hooks.json"
		fileNames = vendorOwnedConfigFiles(appType)
	} else {
		status.ConfigDir = vendor.ClaudeConfigDir
		status.InheritanceSource = "Global ~/.claude/settings.json hooks"
		fileNames = vendorOwnedConfigFiles(appType)
	}
	if status.ConfigDir == "" {
		status.Warning = "This vendor uses the global agent configuration."
		return status
	}
	dirInfo, err := os.Lstat(status.ConfigDir)
	if err != nil || !dirInfo.IsDir() || dirInfo.Mode()&os.ModeSymlink != 0 {
		status.State = "missing"
		status.Warning = "The isolation directory is missing or invalid."
		return status
	}
	status.State = "ready"
	preview := make(map[string]any)
	for _, name := range fileNames {
		fileStatus, document := inspectVendorIsolationFile(filepath.Join(status.ConfigDir, name), name)
		status.Files = append(status.Files, fileStatus)
		if document != nil {
			preview[name] = redactJSONValue(document, "")
		}
	}
	if appType == CcSwitchProviderAppTypeCodex {
		if fileStatusExists(status.Files, "config.toml") {
			preview["config.toml"] = "[CONTENT HIDDEN]"
		}
		status.TopLevelKeys = existingFileNames(status.Files)
		if hooks, ok := preview["hooks.json"].(map[string]any); ok {
			status.HookEventCount = len(hooks)
		}
	} else if settings, ok := preview["settings.json"].(map[string]any); ok {
		status.TopLevelKeys = sortedMapKeys(settings)
		if env, ok := settings["env"].(map[string]any); ok {
			status.EnvCount = len(env)
		}
		if hooks, ok := settings["hooks"].(map[string]any); ok {
			status.HookEventCount = len(hooks)
		}
	}
	if len(preview) > 0 {
		if data, err := json.MarshalIndent(preview, "", "  "); err == nil {
			status.RedactedJSON = string(data)
		}
	}
	return status
}

func inspectVendorIsolationFile(path string, name string) (VendorIsolationFileStatus, any) {
	status := VendorIsolationFileStatus{Name: name}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return status, nil
	}
	status.Exists = true
	status.Size = info.Size()
	status.LastModified = info.ModTime().UnixMilli()
	if !strings.HasSuffix(strings.ToLower(name), ".json") {
		return status, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return status, nil
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return status, nil
	}
	var document any
	if json.Unmarshal(data, &document) != nil {
		return status, nil
	}
	return status, document
}

func redactJSONValue(value any, key string) any {
	if sensitiveDiagnosticKey(key) {
		return redactedValue
	}
	switch typed := value.(type) {
	case map[string]any:
		redacted := make(map[string]any, len(typed))
		for childKey, childValue := range typed {
			redacted[childKey] = redactJSONValue(childValue, childKey)
		}
		return redacted
	case []any:
		redacted := make([]any, len(typed))
		for index, item := range typed {
			redacted[index] = redactJSONValue(item, key)
		}
		return redacted
	default:
		return value
	}
}

func sensitiveDiagnosticKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	for _, marker := range []string{"token", "secret", "password", "key", "auth", "cookie", "credential"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func sortedMapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func existingFileNames(files []VendorIsolationFileStatus) []string {
	var names []string
	for _, file := range files {
		if file.Exists {
			names = append(names, file.Name)
		}
	}
	sort.Strings(names)
	return names
}

func fileStatusExists(files []VendorIsolationFileStatus, name string) bool {
	for _, file := range files {
		if file.Name == name {
			return file.Exists
		}
	}
	return false
}
