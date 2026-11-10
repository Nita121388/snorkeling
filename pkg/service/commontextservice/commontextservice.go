// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextservice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/syncclient"
	"github.com/wavetermdev/waveterm/pkg/syncconflict"
	"github.com/wavetermdev/waveterm/pkg/syncjournal"
	"github.com/wavetermdev/waveterm/pkg/syncmanager"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type CommonTextService struct{}

type CommonTextListRequest struct {
	Query      string   `json:"query,omitempty"`
	TagFilters []string `json:"tagFilters,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Offset     int      `json:"offset,omitempty"`
}

type CommonTextListResponse struct {
	Items []wconfig.CommonTextItemType `json:"items"`
}

type CommonTextGetRequest struct {
	ID string `json:"id"`
}

type CommonTextGetResponse struct {
	Item  wconfig.CommonTextItemType `json:"item"`
	Found bool                       `json:"found"`
}

type CommonTextTagsResponse struct {
	Tags []commontextstore.TagSummary `json:"tags"`
}

type CommonTextUpdateRequest struct {
	ID      string   `json:"id"`
	Title   *string  `json:"title,omitempty"`
	Text    *string  `json:"text,omitempty"`
	Content *string  `json:"content,omitempty"`
	Tags    []string `json:"tags,omitempty"`
	SetTags bool     `json:"setTags,omitempty"`
}

type CommonTextRenameTagRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type CommonTextRenameTagResponse struct {
	Count int `json:"count"`
}

func (svc *CommonTextService) List_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list common text items",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text items",
	}
}

func (svc *CommonTextService) List(ctx context.Context, request *CommonTextListRequest) (*CommonTextListResponse, error) {
	if request == nil {
		request = &CommonTextListRequest{}
	}
	items, err := commontextstore.List(ctx, commontextstore.ListOptions{
		Query:      request.Query,
		TagFilters: request.TagFilters,
		Limit:      request.Limit,
		Offset:     request.Offset,
	})
	if err != nil {
		return nil, err
	}
	return &CommonTextListResponse{Items: items}, nil
}

func (svc *CommonTextService) Get_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "get a common text item by id",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text item",
	}
}

func (svc *CommonTextService) Get(ctx context.Context, request *CommonTextGetRequest) (*CommonTextGetResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("common text id is required")
	}
	item, found, err := commontextstore.Get(ctx, request.ID)
	if err != nil {
		return nil, err
	}
	return &CommonTextGetResponse{Item: item, Found: found}, nil
}

func (svc *CommonTextService) Tags_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list common text tags",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text tags",
	}
}

func (svc *CommonTextService) Tags(ctx context.Context, request *CommonTextListRequest) (*CommonTextTagsResponse, error) {
	if request == nil {
		request = &CommonTextListRequest{}
	}
	tags, err := commontextstore.ListTags(ctx, commontextstore.ListOptions{
		Query:      request.Query,
		TagFilters: request.TagFilters,
		Limit:      request.Limit,
	})
	if err != nil {
		return nil, err
	}
	return &CommonTextTagsResponse{Tags: tags}, nil
}

func (svc *CommonTextService) Update_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "update common text title, text, or tags",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "updated common text item",
	}
}

func (svc *CommonTextService) Update(ctx context.Context, request *CommonTextUpdateRequest) (*wconfig.CommonTextItemType, error) {
	if request == nil {
		return nil, fmt.Errorf("common text update request is required")
	}
	item, err := commontextstore.Update(ctx, commontextstore.UpdateRequest{
		ID:      request.ID,
		Title:   request.Title,
		Text:    request.Text,
		Content: request.Content,
		Tags:    request.Tags,
		SetTags: request.SetTags,
	})
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (svc *CommonTextService) RenameTag_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "rename a common text tag globally",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text tag rename result",
	}
}

func (svc *CommonTextService) RenameTag(ctx context.Context, request *CommonTextRenameTagRequest) (*CommonTextRenameTagResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("rename tag request is required")
	}
	count, err := commontextstore.RenameTag(ctx, request.From, request.To)
	if err != nil {
		return nil, err
	}
	return &CommonTextRenameTagResponse{Count: count}, nil
}

// ── sync (R2 GUI wiring) ────────────────────────────────────────────────────

type CommonTextSyncStatusResponse struct {
	Status syncmanager.Status `json:"status"`
}

type CommonTextSyncNowRequest struct {
	// Trigger names the cause so the journal can distinguish manual from timer.
	Trigger string `json:"trigger,omitempty"`
}

func (svc *CommonTextService) SyncStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "get common text sync status (transport, last run, unresolved conflicts)",
		ArgNames:   []string{"ctx"},
		ReturnDesc: "sync status",
	}
}

func (svc *CommonTextService) SyncStatus(ctx context.Context) (*CommonTextSyncStatusResponse, error) {
	return &CommonTextSyncStatusResponse{Status: syncmanager.GetStatus()}, nil
}

func (svc *CommonTextService) SyncNow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "run one common text sync now",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "sync status after the run",
	}
}

func (svc *CommonTextService) SyncNow(ctx context.Context, request *CommonTextSyncNowRequest) (*CommonTextSyncStatusResponse, error) {
	trigger := "manual"
	if request != nil && strings.TrimSpace(request.Trigger) != "" {
		trigger = request.Trigger
	}
	status, err := syncmanager.SyncNow(ctx, trigger)
	if err != nil && !errors.Is(err, syncmanager.ErrNotConfigured) {
		return &CommonTextSyncStatusResponse{Status: status}, err
	}
	// ErrNotConfigured is the default state, not a failure: return the status so the UI can render
	// "local only" instead of an error toast.
	return &CommonTextSyncStatusResponse{Status: status}, nil
}

type CommonTextSyncSwitchRequest struct {
	// Settings is the full pending transport configuration (transport id + backend fields), because
	// the backend must build the new transport before it can re-sync with a baseline.
	Settings map[string]any `json:"settings"`
	// Baseline is "local" or "remote"; anything else is rejected (no silent default).
	Baseline string `json:"baseline"`
}

func (svc *CommonTextService) SyncSwitchTransport_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "switch the sync transport after a full re-sync with an explicit baseline",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "sync status after the switch",
	}
}

func (svc *CommonTextService) SyncSwitchTransport(ctx context.Context, request *CommonTextSyncSwitchRequest) (*CommonTextSyncStatusResponse, error) {
	if request == nil {
		return nil, errors.New("switch request is required")
	}
	status, err := syncmanager.SwitchTransport(ctx, request.Settings, request.Baseline)
	if err != nil {
		return &CommonTextSyncStatusResponse{Status: status}, err
	}
	return &CommonTextSyncStatusResponse{Status: status}, nil
}

// ── sync conflicts (copy-for-agent + paste-back resolve) ─────────────────────

type CommonTextSyncConflictsResponse struct {
	Conflicts []syncconflict.Entry `json:"conflicts"`
}

func (svc *CommonTextService) SyncConflicts_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list unresolved common text sync conflicts (both versions included)",
		ArgNames:   []string{"ctx"},
		ReturnDesc: "unresolved conflicts",
	}
}

func (svc *CommonTextService) SyncConflicts(ctx context.Context) (*CommonTextSyncConflictsResponse, error) {
	entries, err := syncconflict.List()
	if err != nil {
		return nil, err
	}
	return &CommonTextSyncConflictsResponse{Conflicts: entries}, nil
}

type CommonTextSyncConflictsCopyResponse struct {
	Count int    `json:"count"`
	Text  string `json:"text"`
}

func (svc *CommonTextService) SyncConflictsCopy_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "render all unresolved conflicts as one self-contained AI-ready block (same source as `wsh commontext-sync conflicts --copy`)",
		ArgNames:   []string{"ctx"},
		ReturnDesc: "conflict count and the rendered copy text",
	}
}

// SyncConflictsCopy renders through syncconflict.RenderAll so the panel and the CLI are
// byte-identical by construction — the UI must not re-implement the format.
func (svc *CommonTextService) SyncConflictsCopy(ctx context.Context) (*CommonTextSyncConflictsCopyResponse, error) {
	entries, err := syncconflict.List()
	if err != nil {
		return nil, err
	}
	return &CommonTextSyncConflictsCopyResponse{Count: len(entries), Text: syncconflict.RenderAll(entries)}, nil
}

type CommonTextSyncConflictCopyRequest struct {
	Id string `json:"id"`
}

func (svc *CommonTextService) SyncConflictCopy_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "render one unresolved conflict as a self-contained AI-ready block",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "conflict count (0 or 1) and the rendered copy text",
	}
}

// SyncConflictCopy renders a single entry (the drawer's per-conflict copy button). Rendering
// stays in Go: the frontend never re-implements the format.
func (svc *CommonTextService) SyncConflictCopy(ctx context.Context, request *CommonTextSyncConflictCopyRequest) (*CommonTextSyncConflictsCopyResponse, error) {
	if request == nil || strings.TrimSpace(request.Id) == "" {
		return nil, errors.New("conflict id is required")
	}
	id := strings.TrimSpace(request.Id)
	entries, err := syncconflict.List()
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.Id == id {
			return &CommonTextSyncConflictsCopyResponse{Count: 1, Text: syncconflict.RenderMarkdown(e)}, nil
		}
	}
	return nil, fmt.Errorf("no unresolved conflict with id %q", id)
}

type CommonTextSyncResolveRequest struct {
	Id   string `json:"id"`
	Text string `json:"text"`
}

func (svc *CommonTextService) SyncResolve_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "resolve one sync conflict by writing the merged text (equivalent of `wsh commontext-sync resolve <id> --text-file`)",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "sync status after the resolve",
	}
}

// SyncResolve is the paste-back half of copy-for-agent: the AI merges, the user pastes the
// merged text back, and this applies it. It mirrors the CLI resolve path exactly — store write
// first (conflict stays visible if it fails), then MarkResolved, Rev bumped so the next push
// carries a newer version than the one the conflict was recorded for.
func (svc *CommonTextService) SyncResolve(ctx context.Context, request *CommonTextSyncResolveRequest) (*CommonTextSyncStatusResponse, error) {
	if request == nil {
		return nil, errors.New("resolve request is required")
	}
	id := strings.TrimSpace(request.Id)
	if id == "" {
		return nil, errors.New("conflict id is required")
	}
	if strings.TrimSpace(request.Text) == "" {
		return nil, fmt.Errorf("refusing to resolve %q with empty text — deletes go through the UI", id)
	}
	entries, err := syncconflict.List()
	if err != nil {
		return nil, err
	}
	var target *syncconflict.Entry
	for i := range entries {
		if entries[i].Id == id {
			target = &entries[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("no unresolved conflict with id %q", id)
	}

	// Read-modify-write through the store, same shape as the CLI path: replace the item's text,
	// bump Rev so the remote sees a newer version than the conflicted one.
	items, err := commontextstore.List(ctx, commontextstore.ListOptions{IncludeDeleted: true})
	if err != nil {
		return nil, fmt.Errorf("reading common text: %w", err)
	}
	updated := false
	for idx := range items {
		if items[idx].Id != id {
			continue
		}
		items[idx].Text = request.Text
		items[idx].UpdatedAt = float64(time.Now().UnixMilli())
		items[idx].Rev = items[idx].Rev + 1
		updated = true
		break
	}
	if !updated {
		return nil, fmt.Errorf("item %q not found in local Common Text — was it deleted?", id)
	}
	if err := commontextstore.SaveAll(ctx, items); err != nil {
		return nil, fmt.Errorf("writing resolved text: %w", err)
	}
	if err := syncconflict.MarkResolved(id); err != nil {
		return nil, err
	}
	return &CommonTextSyncStatusResponse{Status: syncmanager.GetStatus()}, nil
}

// ── sync diagnostics (failure / server unreachable / protocol mismatch) ────

type CommonTextSyncJournalTailRequest struct {
	// N limits how many events to return; <= 0 means 20, capped at 100 (JournalTail policy).
	N int `json:"n,omitempty"`
}

type CommonTextSyncJournalTailResponse struct {
	N      int                 `json:"n"`
	Events []syncjournal.Event `json:"events"`
	// Lines are the same events rendered exactly like `wsh commontext-sync log` prints them,
	// so a pasted self-diagnosis payload reads like CLI output.
	Lines []string `json:"lines"`
}

func (svc *CommonTextService) SyncJournalTail_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "recent common text sync journal events, rendered like `wsh commontext-sync log`",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "event count, raw events, and CLI-formatted lines",
	}
}

func (svc *CommonTextService) SyncJournalTail(ctx context.Context, request *CommonTextSyncJournalTailRequest) (*CommonTextSyncJournalTailResponse, error) {
	n := 0
	if request != nil {
		n = request.N
	}
	events, err := syncmanager.JournalTail(n)
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(events))
	for _, ev := range events {
		lines = append(lines, syncmanager.FormatEventLine(ev))
	}
	return &CommonTextSyncJournalTailResponse{N: len(events), Events: events, Lines: lines}, nil
}

type CommonTextSyncProbeResponse struct {
	// Transport is the currently configured transport id; Probe is only meaningful for "server".
	Transport string `json:"transport"`
	// Probe is the same diagnostics `wsh commontext-sync doctor` runs; omitted for non-server
	// transports where probing would be meaningless noise.
	Probe *syncclient.Probe `json:"probe,omitempty"`
	// ClientProtocolVersion is this build's sync protocol version, so the UI can compare without
	// hardcoding it twice.
	ClientProtocolVersion int `json:"clientProtocolVersion"`
}

func (svc *CommonTextService) SyncProbe_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "diagnose the configured sync server (same checks as `wsh commontext-sync doctor`); non-server transports return transport only",
		ArgNames:   []string{"ctx"},
		ReturnDesc: "transport id, probe result (server only), and client protocol version",
	}
}

func (svc *CommonTextService) SyncProbe(ctx context.Context) (*CommonTextSyncProbeResponse, error) {
	status := syncmanager.GetStatus()
	resp := &CommonTextSyncProbeResponse{
		Transport:             status.Transport,
		ClientProtocolVersion: syncproto.ProtocolVersion,
	}
	if status.Transport != "server" {
		// Probing a folder/git/none transport would be noise: those failures are local
		// configuration problems the status panel already reports.
		return resp, nil
	}
	probe, err := syncmanager.ProbeConfiguredServer(ctx)
	if err != nil {
		return resp, err
	}
	resp.Probe = probe
	return resp, nil
}
