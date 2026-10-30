// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// originCountLimit is the list limit used when computing a per-origin session
// count. Sessions are lightweight summaries; the cap only guards against absurd
// roots (100k+ files) making the count call heavy.
const originCountLimit = 100000

// AISessionsOrigin describes one selectable scan origin for the GUI switcher.
type AISessionsOrigin struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Path     string `json:"path,omitempty"`
	Kind     string `json:"kind"` // "local" | "dump"
	Source   string `json:"source,omitempty"`
	ReadOnly bool   `json:"readOnly"`
	Count    int    `json:"count"`
}

// AISessionsOriginsRequest controls the Origins response. Counts are opt-in because
// a cold origin needs a (budgeted) scan; the default keeps the call cheap.
type AISessionsOriginsRequest struct {
	IncludeCounts bool `json:"includeCounts,omitempty"`
}

type AISessionsOriginsResponse struct {
	Origins []AISessionsOrigin `json:"origins"`
}

// originSettings reads ai:sessions:externalorigins from the loaded settings file and
// adapts it to the neutral aisessions input shape.
func originSettings() []aisessions.ExternalOriginSetting {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	var settings []aisessions.ExternalOriginSetting
	for _, item := range fullConfig.Settings.AiSessionExternalOrigins {
		settings = append(settings, aisessions.ExternalOriginSetting{
			Label:    item.Label,
			Path:     item.Path,
			Source:   item.Source,
			ReadOnly: item.ReadOnly,
		})
	}
	return settings
}

// resolveOrigins validates the configured external origins (settings + env fallback).
func resolveOrigins() []aisessions.ExternalOrigin {
	return aisessions.ResolveExternalOrigins(originSettings())
}

func findOrigin(originID string) (aisessions.ExternalOrigin, bool) {
	for _, origin := range resolveOrigins() {
		if origin.ID == originID {
			return origin, true
		}
	}
	return aisessions.ExternalOrigin{}, false
}

// managerForOrigin routes an origin id to its manager. Empty / "local" returns the
// default local manager; an unknown id is an explicit error (never a silent fallback
// to local, which would show the wrong data).
func managerForOrigin(ctx context.Context, originID string) (*aisessions.Manager, aisessions.ExternalOrigin, error) {
	originID = strings.TrimSpace(originID)
	if originID == "" || originID == aisessions.OriginLocalID {
		return newLocalManager(), aisessions.ExternalOrigin{ID: aisessions.OriginLocalID}, nil
	}
	origin, ok := findOrigin(originID)
	if !ok {
		return nil, aisessions.ExternalOrigin{}, fmt.Errorf("unknown AI session origin %q", originID)
	}
	// External origins deliberately carry no scan-progress publisher in P1: the GUI
	// filters scan events by connection, so publishing origin scans as local would
	// make the local list look busy. The synchronous ScanListResult fields still
	// report Scanning/Scanned/Total for the caller.
	return aisessions.NewManagerWithOptions(aisessions.OriginManagerOptions(origin)), origin, nil
}

// managerForScope resolves a manager from an explicit origin when present, otherwise
// falls back to the existing connection/identifier routing (remote machine or local).
func (svc *AISessionsService) managerForScope(
	ctx context.Context,
	identifier string,
	connection string,
	origin string,
) (*aisessions.Manager, error) {
	if strings.TrimSpace(origin) != "" {
		manager, _, err := managerForOrigin(ctx, origin)
		return manager, err
	}
	return svc.managerForRequest(ctx, identifier, connection)
}

func (svc *AISessionsService) Origins_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list selectable AI session origins (local machine + external dumps)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "available AI session origins",
	}
}

// Origins returns every selectable scan origin. The local origin is always first;
// external dumps follow, sorted by label. Count is best-effort when requested: a
// slow/unreadable origin yields 0 rather than failing the whole response.
func (svc *AISessionsService) Origins(ctx context.Context, request *AISessionsOriginsRequest) (*AISessionsOriginsResponse, error) {
	if request == nil {
		request = &AISessionsOriginsRequest{}
	}
	var origins []AISessionsOrigin
	origins = append(origins, AISessionsOrigin{
		ID:       aisessions.OriginLocalID,
		Label:    "This Mac",
		Path:     "",
		Kind:     aisessions.OriginKindLocal,
		ReadOnly: false,
		Count:    svc.originCount(ctx, aisessions.OriginLocalID, request.IncludeCounts),
	})
	for _, ext := range resolveOrigins() {
		origins = append(origins, AISessionsOrigin{
			ID:       ext.ID,
			Label:    ext.Label,
			Path:     ext.Path,
			Kind:     aisessions.OriginKindDump,
			Source:   ext.Source,
			ReadOnly: ext.ReadOnly,
			Count:    svc.originCount(ctx, ext.ID, request.IncludeCounts),
		})
	}
	return &AISessionsOriginsResponse{Origins: origins}, nil
}

// originCount is best-effort: it lists the origin and returns the session count, or 0
// on any failure or when counts were not requested. It must never panic or block the
// whole Origins response.
func (svc *AISessionsService) originCount(ctx context.Context, originID string, include bool) int {
	if !include {
		return 0
	}
	manager, _, err := managerForOrigin(ctx, originID)
	if err != nil {
		return 0
	}
	result, err := manager.ScanListResult(ctx, aisessions.ListOptions{Limit: originCountLimit}, "")
	if err != nil {
		return 0
	}
	return len(result.Sessions)
}
