// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"crypto/sha1"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

const (
	// OriginLocalID is the reserved id for the current machine's default roots.
	OriginLocalID = "local"
	// OriginKindLocal marks the local origin; OriginKindDump marks an external scan root.
	OriginKindLocal = "local"
	OriginKindDump  = "dump"

	// EnvExtraSessionRoots is the env fallback for external origins. The value is
	// a platform path-list separator ('/' style ":" on unix). Each entry becomes a
	// read-only pi origin labelled with its basename.
	EnvExtraSessionRoots = "WAVETERM_AI_SESSIONS_EXTRA_ROOTS"

	defaultOriginSource = SourcePi
)

// ExternalOrigin is a resolved, validated external scan root ("dump").
type ExternalOrigin struct {
	ID       string
	Label    string
	Path     string
	Source   string
	ReadOnly bool
}

// ExternalOriginSetting is the un-resolved input shape (from settings.json or env).
// ReadOnly is a pointer so an explicit false is distinguishable from unset.
type ExternalOriginSetting struct {
	Label    string
	Path     string
	Source   string
	ReadOnly *bool
}

// ExpandOriginPath expands a leading "~" and normalizes to an absolute clean path.
func ExpandOriginPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		home := homeDir()
		if home != "" {
			if path == "~" {
				path = home
			} else {
				path = filepath.Join(home, path[2:])
			}
		}
	}
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return ""
	}
	return abs
}

// OriginIDForPath derives a stable id for an external root from its absolute path.
func OriginIDForPath(absPath string) string {
	sum := sha1.Sum([]byte(absPath))
	return "dump-" + hex.EncodeToString(sum[:])[:12]
}

// SafeOriginID makes an origin id usable as a filename component.
func SafeOriginID(id string) string {
	return strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_").Replace(id)
}

// SQLitePath returns the per-origin sqlite index path (isolates scanKey from local
// and from other origins).
func (o ExternalOrigin) SQLitePath() string {
	return filepath.Join(filepath.Dir(DefaultIndexPath()), "origins", SafeOriginID(o.ID)+"-index-v2.sqlite")
}

// MetaPath returns the per-origin meta store path.
func (o ExternalOrigin) MetaPath() string {
	return filepath.Join(filepath.Dir(DefaultIndexPath()), "origins", SafeOriginID(o.ID)+"-meta.json")
}

// ResolveExternalOrigins validates and dedups raw settings plus the env fallback.
// Entries with a missing path, a non-existent dir, or a non-dir path are skipped
// (never fatal), so one bad entry cannot block other origins or the local origin.
func ResolveExternalOrigins(settings []ExternalOriginSetting) []ExternalOrigin {
	seen := make(map[string]bool)
	var out []ExternalOrigin
	add := func(setting ExternalOriginSetting) {
		absPath := ExpandOriginPath(setting.Path)
		if absPath == "" {
			return
		}
		info, err := os.Stat(absPath)
		if err != nil || !info.IsDir() {
			return
		}
		id := OriginIDForPath(absPath)
		if seen[id] {
			return
		}
		seen[id] = true
		source := strings.TrimSpace(setting.Source)
		if source == "" {
			source = defaultOriginSource
		}
		label := strings.TrimSpace(setting.Label)
		if label == "" {
			label = filepath.Base(absPath)
		}
		readOnly := true
		if setting.ReadOnly != nil {
			readOnly = *setting.ReadOnly
		}
		out = append(out, ExternalOrigin{
			ID:       id,
			Label:    label,
			Path:     absPath,
			Source:   source,
			ReadOnly: readOnly,
		})
	}
	for _, setting := range settings {
		add(setting)
	}
	for _, root := range parseEnvOriginRoots(os.Getenv(EnvExtraSessionRoots)) {
		add(ExternalOriginSetting{Path: root})
	}
	return out
}

func parseEnvOriginRoots(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return strings.Split(value, string(os.PathListSeparator))
}

// ExternalOriginProviders builds one provider per external origin. Unknown source
// values are skipped for now (P1 only supports pi); the caller keeps the origin
// out of the list when this returns no provider.
func ExternalOriginProviders(origins []ExternalOrigin) []Provider {
	var providers []Provider
	for _, origin := range origins {
		if origin.Source != SourcePi {
			continue
		}
		providers = append(providers, NewPiProvider(origin.Path))
	}
	return providers
}

// OriginManagerOptions builds the manager options for a single external origin.
func OriginManagerOptions(origin ExternalOrigin) ManagerOptions {
	return ManagerOptions{
		Providers:  ExternalOriginProviders([]ExternalOrigin{origin}),
		SQLitePath: origin.SQLitePath(),
		MetaPath:   origin.MetaPath(),
	}
}

// KnownSessionRoots returns every directory a session file may legitimately live
// under: the default codex/claude/pi roots plus all configured external origins.
func KnownSessionRoots() []string {
	var roots []string
	if dir := DefaultCodexSessionsDir(); dir != "" {
		roots = append(roots, dir)
	}
	roots = append(roots, DefaultClaudeProjectDirs()...)
	if dir := DefaultPiSessionsDir(); dir != "" {
		roots = append(roots, dir)
	}
	for _, origin := range ResolveExternalOrigins(nil) {
		roots = append(roots, origin.Path)
	}
	return uniqueStrings(roots)
}
