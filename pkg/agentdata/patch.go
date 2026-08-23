// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentdata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const PatchVersion = 1

var commonTextDBPath string

type Patch struct {
	Version    int              `json:"version"`
	Source     string           `json:"source,omitempty"`
	Operations []PatchOperation `json:"operations"`
}

type PatchOperation struct {
	Type              string         `json:"type"`
	SessionKey        string         `json:"sessionKey,omitempty"`
	ID                string         `json:"id,omitempty"`
	Note              *string        `json:"note,omitempty"`
	Title             *string        `json:"title,omitempty"`
	Text              *string        `json:"text,omitempty"`
	Content           *string        `json:"content,omitempty"`
	Tags              *TagPatch      `json:"tags,omitempty"`
	Domain            string         `json:"domain,omitempty"`
	From              string         `json:"from,omitempty"`
	To                string         `json:"to,omitempty"`
	ExpectedHash      string         `json:"expectedHash,omitempty"`
	ExpectedUpdatedAt int64          `json:"expectedUpdatedAt,omitempty"`
	raw               map[string]any `json:"-"`
}

func (op *PatchOperation) UnmarshalJSON(data []byte) error {
	type patchOperationAlias PatchOperation
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	opType, _ := raw["type"].(string)
	allowed := allowedFieldsForOperation(opType)
	if len(allowed) == 1 && strings.TrimSpace(opType) == "" {
		return fmt.Errorf("operation type is required")
	}
	for key := range raw {
		if !allowed[key] {
			return fmt.Errorf("unknown field %q for operation %q", key, opType)
		}
	}
	var alias patchOperationAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	*op = PatchOperation(alias)
	op.raw = raw
	return nil
}

type TagPatch struct {
	Set       []string `json:"set,omitempty"`
	Add       []string `json:"add,omitempty"`
	Remove    []string `json:"remove,omitempty"`
	hasSet    bool
	hasAdd    bool
	hasRemove bool
}

func (patch *TagPatch) UnmarshalJSON(data []byte) error {
	type tagPatchAlias TagPatch
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for key := range raw {
		if key != "set" && key != "add" && key != "remove" {
			return fmt.Errorf("unknown tags field %q", key)
		}
	}
	var alias tagPatchAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	*patch = TagPatch(alias)
	_, patch.hasSet = raw["set"]
	_, patch.hasAdd = raw["add"]
	_, patch.hasRemove = raw["remove"]
	return nil
}

type ApplyOptions struct {
	DryRun bool
	Yes    bool
}

type PruneOptions struct {
	DryRun    bool
	Yes       bool
	Keep      int
	Days      int
	Permanent bool
}

type Report struct {
	DryRun     bool              `json:"dryRun"`
	Source     string            `json:"source,omitempty"`
	Operations []OperationReport `json:"operations"`
	Backups    []BackupManifest  `json:"backups,omitempty"`
}

type OperationReport struct {
	Index         int            `json:"index"`
	Type          string         `json:"type"`
	Domain        string         `json:"domain,omitempty"`
	Target        string         `json:"target,omitempty"`
	Changed       bool           `json:"changed"`
	AffectedCount int            `json:"affectedCount,omitempty"`
	Changes       []ChangeReport `json:"changes,omitempty"`
	Messages      []string       `json:"messages,omitempty"`
	Error         string         `json:"error,omitempty"`
}

type ChangeReport struct {
	Field  string `json:"field"`
	Before any    `json:"before"`
	After  any    `json:"after"`
}

type BackupManifest struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Reason     string `json:"reason"`
	Path       string `json:"path"`
	CreatedAt  int64  `json:"createdAt"`
	Size       int64  `json:"size"`
	Prunable   bool   `json:"prunable"`
	AppVersion string `json:"appVersion,omitempty"`
}

type PruneReport struct {
	DryRun    bool             `json:"dryRun"`
	Permanent bool             `json:"permanent"`
	Keep      int              `json:"keep"`
	Days      int              `json:"days"`
	Deleted   []BackupManifest `json:"deleted,omitempty"`
	Kept      []BackupManifest `json:"kept,omitempty"`
}

type AuditEntry struct {
	ID         string            `json:"id"`
	CreatedAt  int64             `json:"createdAt"`
	Source     string            `json:"source,omitempty"`
	DryRun     bool              `json:"dryRun"`
	Success    bool              `json:"success"`
	Error      string            `json:"error,omitempty"`
	Operations []OperationReport `json:"operations"`
	Backups    []BackupManifest  `json:"backups,omitempty"`
}

type SessionExportRecord struct {
	Key         string   `json:"key"`
	ID          string   `json:"id"`
	Source      string   `json:"source"`
	Title       string   `json:"title,omitempty"`
	ProjectPath string   `json:"projectPath,omitempty"`
	UpdatedAt   int64    `json:"updatedAt,omitempty"`
	FilePath    string   `json:"filePath,omitempty"`
	Marked      bool     `json:"marked,omitempty"`
	Note        string   `json:"note,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Hash        string   `json:"hash"`
}

type CommonTextExportRecord struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Text       string   `json:"text"`
	Tags       []string `json:"tags,omitempty"`
	UpdatedAt  int64    `json:"updatedAt,omitempty"`
	LastUsedAt int64    `json:"lastUsedAt,omitempty"`
	UsageCount int64    `json:"usageCount,omitempty"`
	Hash       string   `json:"hash"`
}

func LoadPatchFile(path string) (Patch, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Patch{}, err
	}
	var patch Patch
	if err := json.Unmarshal(data, &patch); err != nil {
		return Patch{}, err
	}
	var raw struct {
		Operations []map[string]any `json:"operations"`
	}
	if err := json.Unmarshal(data, &raw); err == nil {
		for idx := range patch.Operations {
			if idx < len(raw.Operations) {
				patch.Operations[idx].raw = raw.Operations[idx]
			}
		}
	}
	return patch, nil
}

func ApplyPatch(ctx context.Context, patch Patch, opts ApplyOptions) (Report, error) {
	var applyErr error
	if patch.Version != PatchVersion {
		return Report{}, fmt.Errorf("unsupported patch version %d", patch.Version)
	}
	if len(patch.Operations) == 0 {
		return Report{}, fmt.Errorf("patch operations are required")
	}
	report := Report{DryRun: opts.DryRun, Source: strings.TrimSpace(patch.Source)}
	if !opts.DryRun && !opts.Yes {
		return report, fmt.Errorf("apply requires explicit confirmation")
	}
	if err := validatePatch(patch, opts); err != nil {
		return report, err
	}
	if err := EnsureRuntimeForPatch(patch); err != nil {
		return report, err
	}
	if opts.DryRun {
		for idx, op := range patch.Operations {
			opReport, err := previewOperation(ctx, idx, op)
			if err != nil {
				opReport.Error = err.Error()
			}
			report.Operations = append(report.Operations, opReport)
		}
		return report, nil
	}
	defer func() {
		_ = appendAuditEntry(AuditEntry{
			ID:         fmt.Sprintf("patch-%s-%s", time.Now().Format("20060102-150405"), shortHash(fmt.Sprintf("%d", time.Now().UnixNano()))),
			CreatedAt:  time.Now().UnixMilli(),
			Source:     report.Source,
			DryRun:     false,
			Success:    applyErr == nil,
			Operations: report.Operations,
			Backups:    report.Backups,
			Error:      errorString(applyErr),
		})
	}()
	for idx, op := range patch.Operations {
		opReport, err := previewOperation(ctx, idx, op)
		if err != nil {
			opReport.Error = err.Error()
			report.Operations = append(report.Operations, opReport)
			applyErr = err
			return report, err
		}
	}
	report.Operations = nil
	backups, err := createBackupsForPatch(ctx, patch)
	if err != nil {
		applyErr = err
		return report, err
	}
	report.Backups = backups
	for idx, op := range patch.Operations {
		opReport, err := applyOperation(ctx, idx, op)
		if err != nil {
			opReport.Error = err.Error()
			report.Operations = append(report.Operations, opReport)
			if restoreErr := restoreFromBackups(ctx, report.Backups); restoreErr != nil {
				opReport.Messages = append(opReport.Messages, fmt.Sprintf("backup restore failed: %v", restoreErr))
				report.Operations[len(report.Operations)-1] = opReport
				err = fmt.Errorf("%w; backup restore failed: %v", err, restoreErr)
			} else {
				opReport.Messages = append(opReport.Messages, "backup restore completed")
				report.Operations[len(report.Operations)-1] = opReport
			}
			applyErr = err
			return report, err
		}
		report.Operations = append(report.Operations, opReport)
	}
	return report, nil
}

func validatePatch(patch Patch, opts ApplyOptions) error {
	for idx, op := range patch.Operations {
		if err := validateOperation(idx, op, opts); err != nil {
			return err
		}
	}
	return nil
}

func validateOperation(idx int, op PatchOperation, opts ApplyOptions) error {
	if len(op.raw) > 0 {
		allowed := allowedFieldsForOperation(op.Type)
		for key := range op.raw {
			if !allowed[key] {
				return fmt.Errorf("operation %d has unknown field %q", idx, key)
			}
		}
	}
	switch op.Type {
	case "session_note.update":
		if strings.TrimSpace(op.SessionKey) == "" {
			return fmt.Errorf("operation %d sessionKey is required", idx)
		}
		if !opts.DryRun && !operationHasPrecondition(op) {
			return fmt.Errorf("operation %d session_note.update requires expectedHash or expectedUpdatedAt for real apply", idx)
		}
	case "common_text.update":
		if strings.TrimSpace(op.ID) == "" {
			return fmt.Errorf("operation %d id is required", idx)
		}
		if !opts.DryRun && !operationHasPrecondition(op) {
			return fmt.Errorf("operation %d common_text.update requires expectedHash or expectedUpdatedAt for real apply", idx)
		}
	case "tag.rename":
		domain := normalizeDomain(op.Domain)
		if domain == "" {
			return fmt.Errorf("operation %d domain must be session, common_text, or all", idx)
		}
		if strings.TrimSpace(op.From) == "" || strings.TrimSpace(op.To) == "" {
			return fmt.Errorf("operation %d from and to are required", idx)
		}
	default:
		return fmt.Errorf("operation %d has unsupported type %q", idx, op.Type)
	}
	return nil
}

func operationHasPrecondition(op PatchOperation) bool {
	return strings.TrimSpace(op.ExpectedHash) != "" || op.ExpectedUpdatedAt != 0
}

func allowedFieldsForOperation(opType string) map[string]bool {
	base := map[string]bool{"type": true}
	switch opType {
	case "session_note.update":
		base["sessionKey"] = true
		base["note"] = true
		base["tags"] = true
		base["expectedHash"] = true
		base["expectedUpdatedAt"] = true
	case "common_text.update":
		base["id"] = true
		base["title"] = true
		base["text"] = true
		base["content"] = true
		base["tags"] = true
		base["expectedHash"] = true
		base["expectedUpdatedAt"] = true
	case "tag.rename":
		base["domain"] = true
		base["from"] = true
		base["to"] = true
	}
	return base
}

func normalizeDomain(domain string) string {
	switch strings.TrimSpace(strings.ToLower(domain)) {
	case "session", "sessions":
		return "session"
	case "common_text", "commontext", "common-text":
		return "common_text"
	case "all", "":
		return "all"
	default:
		return ""
	}
}

func previewOperation(ctx context.Context, idx int, op PatchOperation) (OperationReport, error) {
	report := operationReport(idx, op)
	switch op.Type {
	case "session_note.update":
		manager := aisessions.NewManager("", nil)
		summary, err := manager.Summary(ctx, op.SessionKey, false)
		if err != nil {
			return report, err
		}
		if err := validateSessionPrecondition(op, summary); err != nil {
			return report, err
		}
		if !operationHasPrecondition(op) {
			report.Messages = append(report.Messages, "warning: real apply requires expectedHash or expectedUpdatedAt")
		}
		nextNote, nextTags := nextSessionState(summary, op)
		report.Target = summary.Key
		report.Changes = buildChanges([]ChangeReport{
			{Field: "note", Before: summary.Note, After: nextNote},
			{Field: "tags", Before: aisessions.NormalizeSessionTags(summary.Tags), After: aisessions.NormalizeSessionTags(nextTags)},
		})
		report.Changed = len(report.Changes) > 0
		if report.Changed {
			report.AffectedCount = 1
		}
		report.Messages = append(report.Messages, "session note/tags validated")
		return report, nil
	case "common_text.update":
		item, found, err := commontextstore.Get(ctx, op.ID)
		if err != nil {
			return report, err
		}
		if !found {
			return report, fmt.Errorf("common text not found: %q", op.ID)
		}
		if err := validateCommonTextPrecondition(op, item); err != nil {
			return report, err
		}
		if !operationHasPrecondition(op) {
			report.Messages = append(report.Messages, "warning: real apply requires expectedHash or expectedUpdatedAt")
		}
		nextItem := nextCommonTextState(item, op)
		if err := validateCommonTextNextState(nextItem); err != nil {
			return report, err
		}
		report.Target = item.Id
		report.Changes = commonTextChanges(item, nextItem)
		report.Changed = len(report.Changes) > 0
		if report.Changed {
			report.AffectedCount = 1
		}
		report.Messages = append(report.Messages, "common text update validated")
		return report, nil
	case "tag.rename":
		return previewRenameTag(ctx, report, op)
	default:
		return report, fmt.Errorf("unsupported operation %q", op.Type)
	}
}

func previewRenameTag(ctx context.Context, report OperationReport, op PatchOperation) (OperationReport, error) {
	domain := normalizeDomain(op.Domain)
	report.Domain = domain
	count := 0
	if domain == "session" || domain == "all" {
		tags, err := aisessions.NewManager("", nil).ListTags(ctx, aisessions.ListOptions{})
		if err != nil {
			return report, err
		}
		from := aisessions.NormalizeSessionTags([]string{op.From})
		if len(from) == 0 {
			return report, fmt.Errorf("source tag is required")
		}
		for _, tag := range tags {
			if tag.Tag == from[0] {
				count += tag.Count
			}
		}
	}
	if domain == "common_text" || domain == "all" {
		tags, err := commontextstore.ListTags(ctx, commontextstore.ListOptions{})
		if err != nil {
			return report, err
		}
		for _, tag := range tags {
			if strings.EqualFold(tag.Tag, op.From) {
				count += tag.Count
			}
		}
	}
	report.Changed = count > 0
	report.AffectedCount = count
	report.Changes = buildChanges([]ChangeReport{
		{Field: "domain", Before: "", After: domain},
		{Field: "tag", Before: op.From, After: op.To},
	})
	report.Messages = append(report.Messages, "tag rename validated")
	return report, nil
}

func applyOperation(ctx context.Context, idx int, op PatchOperation) (OperationReport, error) {
	report := operationReport(idx, op)
	switch op.Type {
	case "session_note.update":
		manager := aisessions.NewManager("", nil)
		summary, err := manager.Summary(ctx, op.SessionKey, false)
		if err != nil {
			return report, err
		}
		if err := validateSessionPrecondition(op, summary); err != nil {
			return report, err
		}
		nextNote, nextTags := nextSessionState(summary, op)
		updated, err := manager.NoteAndTags(ctx, summary.Key, nextNote, nextTags)
		if err != nil {
			return report, err
		}
		report.Target = updated.Key
		report.Changes = buildChanges([]ChangeReport{
			{Field: "note", Before: summary.Note, After: updated.Note},
			{Field: "tags", Before: aisessions.NormalizeSessionTags(summary.Tags), After: aisessions.NormalizeSessionTags(updated.Tags)},
		})
		report.Changed = len(report.Changes) > 0
		if report.Changed {
			report.AffectedCount = 1
		}
		return report, nil
	case "common_text.update":
		setTags := op.Tags != nil
		var tags []string
		var current commontextstore.Item
		var haveCurrent bool
		if op.Tags != nil {
			item, found, err := commontextstore.Get(ctx, op.ID)
			if err != nil {
				return report, err
			}
			if !found {
				return report, fmt.Errorf("common text not found: %q", op.ID)
			}
			if err := validateCommonTextPrecondition(op, item); err != nil {
				return report, err
			}
			current = item
			haveCurrent = true
			tags = applyCommonTextTagPatch(current.Tags, op.Tags)
		} else if op.ExpectedHash != "" || op.ExpectedUpdatedAt != 0 {
			item, found, err := commontextstore.Get(ctx, op.ID)
			if err != nil {
				return report, err
			}
			if !found {
				return report, fmt.Errorf("common text not found: %q", op.ID)
			}
			if err := validateCommonTextPrecondition(op, item); err != nil {
				return report, err
			}
			current = item
			haveCurrent = true
		}
		if !haveCurrent {
			item, found, err := commontextstore.Get(ctx, op.ID)
			if err != nil {
				return report, err
			}
			if !found {
				return report, fmt.Errorf("common text not found: %q", op.ID)
			}
			current = item
		}
		item, err := commontextstore.Update(ctx, commontextstore.UpdateRequest{
			ID:      op.ID,
			Title:   op.Title,
			Text:    op.Text,
			Content: op.Content,
			Tags:    tags,
			SetTags: setTags,
		})
		if err != nil {
			return report, err
		}
		report.Target = item.Id
		report.Changes = commonTextChanges(current, item)
		report.Changed = len(report.Changes) > 0
		if report.Changed {
			report.AffectedCount = 1
		}
		return report, nil
	case "tag.rename":
		return applyRenameTag(ctx, report, op)
	default:
		return report, fmt.Errorf("unsupported operation %q", op.Type)
	}
}

func applyRenameTag(ctx context.Context, report OperationReport, op PatchOperation) (OperationReport, error) {
	domain := normalizeDomain(op.Domain)
	report.Domain = domain
	count := 0
	if domain == "session" || domain == "all" {
		sessionCount, err := aisessions.NewManager("", nil).RenameTag(ctx, op.From, op.To)
		if err != nil {
			return report, err
		}
		count += sessionCount
	}
	if domain == "common_text" || domain == "all" {
		commonTextCount, err := commontextstore.RenameTag(ctx, op.From, op.To)
		if err != nil {
			return report, err
		}
		count += commonTextCount
	}
	report.Changed = count > 0
	report.AffectedCount = count
	report.Changes = buildChanges([]ChangeReport{
		{Field: "domain", Before: "", After: domain},
		{Field: "tag", Before: op.From, After: op.To},
	})
	return report, nil
}

func validateSessionPrecondition(op PatchOperation, summary aisessions.SessionSummary) error {
	if op.ExpectedUpdatedAt != 0 && summary.UpdatedAt != 0 && summary.UpdatedAt != op.ExpectedUpdatedAt {
		return fmt.Errorf("session %q updatedAt mismatch: expected %d got %d", summary.Key, op.ExpectedUpdatedAt, summary.UpdatedAt)
	}
	if strings.TrimSpace(op.ExpectedHash) != "" {
		actual := HashSession(summary)
		if !strings.EqualFold(strings.TrimSpace(op.ExpectedHash), actual) {
			return fmt.Errorf("session %q hash mismatch: expected %s got %s", summary.Key, op.ExpectedHash, actual)
		}
	}
	return nil
}

func validateCommonTextPrecondition(op PatchOperation, item commontextstore.Item) error {
	if op.ExpectedUpdatedAt != 0 && int64(item.UpdatedAt) != op.ExpectedUpdatedAt {
		return fmt.Errorf("common text %q updatedAt mismatch: expected %d got %d", item.Id, op.ExpectedUpdatedAt, int64(item.UpdatedAt))
	}
	if strings.TrimSpace(op.ExpectedHash) != "" {
		actual := HashCommonText(item)
		if !strings.EqualFold(strings.TrimSpace(op.ExpectedHash), actual) {
			return fmt.Errorf("common text %q hash mismatch: expected %s got %s", item.Id, op.ExpectedHash, actual)
		}
	}
	return nil
}

func operationReport(idx int, op PatchOperation) OperationReport {
	return OperationReport{
		Index:  idx,
		Type:   op.Type,
		Domain: normalizeDomain(op.Domain),
	}
}

func nextSessionState(summary aisessions.SessionSummary, op PatchOperation) (string, []string) {
	nextNote := summary.Note
	if op.Note != nil {
		nextNote = *op.Note
	}
	cleanNote, extractedTags := aisessions.ExtractSessionTagsFromNote(nextNote)
	nextTags := applySessionTagPatch(summary.Tags, op.Tags)
	nextTags = aisessions.MergeSessionTags(nextTags, extractedTags)
	return cleanNote, nextTags
}

func nextCommonTextState(item commontextstore.Item, op PatchOperation) commontextstore.Item {
	next := item
	if op.Title != nil {
		next.Title = normalizeCommonTextTitleForPatch(*op.Title, next.Text)
	}
	if op.Text != nil {
		next.Text = *op.Text
		if op.Title == nil {
			next.Title = normalizeCommonTextTitleForPatch(next.Title, next.Text)
		}
	}
	if op.Content != nil {
		next.Text = *op.Content
		if op.Title == nil {
			next.Title = normalizeCommonTextTitleForPatch(next.Title, next.Text)
		}
	}
	if op.Tags != nil {
		next.Tags = applyCommonTextTagPatch(next.Tags, op.Tags)
	}
	return next
}

func commonTextChanges(before commontextstore.Item, after commontextstore.Item) []ChangeReport {
	return buildChanges([]ChangeReport{
		{Field: "title", Before: before.Title, After: after.Title},
		{Field: "text", Before: before.Text, After: after.Text},
		{Field: "tags", Before: normalizeCommonTextTagsForPatch(before.Tags), After: normalizeCommonTextTagsForPatch(after.Tags)},
	})
}

func buildChanges(candidates []ChangeReport) []ChangeReport {
	var changes []ChangeReport
	for _, change := range candidates {
		if reflect.DeepEqual(change.Before, change.After) {
			continue
		}
		changes = append(changes, change)
	}
	return changes
}

func applySessionTagPatch(existing []string, patch *TagPatch) []string {
	if patch == nil {
		return aisessions.NormalizeSessionTags(existing)
	}
	if patch.hasSet || len(patch.Set) > 0 {
		return aisessions.NormalizeSessionTags(patch.Set)
	}
	next := aisessions.MergeSessionTags(existing, patch.Add)
	if len(patch.Remove) == 0 {
		return next
	}
	remove := make(map[string]bool)
	for _, tag := range aisessions.NormalizeSessionTags(patch.Remove) {
		remove[tag] = true
	}
	var filtered []string
	for _, tag := range next {
		if !remove[tag] {
			filtered = append(filtered, tag)
		}
	}
	return filtered
}

func applyCommonTextTagPatch(existing []string, patch *TagPatch) []string {
	if patch == nil {
		return normalizeCommonTextTagsForPatch(existing)
	}
	if patch.hasSet || len(patch.Set) > 0 {
		return normalizeCommonTextTagsForPatch(patch.Set)
	}
	next := append([]string(nil), existing...)
	next = append(next, patch.Add...)
	if len(patch.Remove) == 0 {
		return next
	}
	remove := make(map[string]bool)
	for _, tag := range patch.Remove {
		remove[strings.ToLower(strings.TrimSpace(tag))] = true
	}
	var filtered []string
	for _, tag := range next {
		if !remove[strings.ToLower(strings.TrimSpace(tag))] {
			filtered = append(filtered, tag)
		}
	}
	return normalizeCommonTextTagsForPatch(filtered)
}

func normalizeCommonTextTitleForPatch(title string, text string) string {
	normalizedTitle := strings.TrimSpace(title)
	if normalizedTitle != "" {
		return normalizedTitle
	}
	for _, line := range strings.Split(text, "\n") {
		trimmedLine := strings.TrimSpace(line)
		if trimmedLine == "" {
			continue
		}
		runes := []rune(trimmedLine)
		if len(runes) <= 48 {
			return trimmedLine
		}
		return string(runes[:45]) + "..."
	}
	return "Untitled text"
}

func validateCommonTextNextState(item commontextstore.Item) error {
	if strings.TrimSpace(item.Text) == "" {
		return fmt.Errorf("common text content cannot be empty")
	}
	return nil
}

func normalizeCommonTextTagsForPatch(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	var normalized []string
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		key := strings.ToLower(tag)
		if _, found := seen[key]; found {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, tag)
	}
	return normalized
}

func createBackupsForPatch(ctx context.Context, patch Patch) ([]BackupManifest, error) {
	needsSession, needsCommonText := patchDomains(patch)
	var backups []BackupManifest
	if needsSession {
		backup, err := backupSQLite(ctx, "sessions", aisessions.DefaultSQLiteIndexPath(), "agent-data-patch")
		if err != nil {
			return backups, err
		}
		backups = append(backups, backup)
	}
	if needsCommonText {
		if err := EnsureCommonTextRuntime(); err != nil {
			return backups, err
		}
		backup, err := backupSQLite(ctx, "common_text", commonTextSQLitePath(), "agent-data-patch")
		if err != nil {
			return backups, err
		}
		backups = append(backups, backup)
	}
	return backups, nil
}

func patchDomains(patch Patch) (bool, bool) {
	var needsSession bool
	var needsCommonText bool
	for _, op := range patch.Operations {
		switch op.Type {
		case "session_note.update":
			needsSession = true
		case "common_text.update":
			needsCommonText = true
		case "tag.rename":
			switch normalizeDomain(op.Domain) {
			case "session":
				needsSession = true
			case "common_text":
				needsCommonText = true
			case "all":
				needsSession = true
				needsCommonText = true
			}
		}
	}
	return needsSession, needsCommonText
}

func backupSQLite(ctx context.Context, backupType string, dbPath string, reason string) (BackupManifest, error) {
	if strings.TrimSpace(dbPath) == "" {
		return BackupManifest{}, fmt.Errorf("%s sqlite path is empty", backupType)
	}
	if _, err := os.Stat(dbPath); err != nil {
		return BackupManifest{}, err
	}
	now := time.Now()
	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return BackupManifest{}, err
	}
	id := fmt.Sprintf("%s-%s-%s", backupType, now.Format("20060102-150405"), shortHash(fmt.Sprintf("%s:%d", dbPath, now.UnixNano())))
	backupPath := filepath.Join(backupDir, id+".sqlite")
	db, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000", dbPath))
	if err != nil {
		return BackupManifest{}, err
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, backupPath); err != nil {
		return BackupManifest{}, err
	}
	backupInfo, err := os.Stat(backupPath)
	if err != nil {
		return BackupManifest{}, err
	}
	backup := BackupManifest{
		ID:         id,
		Type:       backupType,
		Reason:     reason,
		Path:       backupPath,
		CreatedAt:  now.UnixMilli(),
		Size:       backupInfo.Size(),
		Prunable:   true,
		AppVersion: wavebase.WaveVersion,
	}
	if err := appendBackupManifest(backupDir, backup); err != nil {
		return BackupManifest{}, err
	}
	return backup, nil
}

func ListBackups() ([]BackupManifest, error) {
	var backups []BackupManifest
	candidates := []struct {
		typ  string
		path string
	}{
		{typ: "sessions", path: aisessions.DefaultSQLiteIndexPath()},
		{typ: "common_text", path: commonTextSQLitePath()},
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.path) == "" {
			continue
		}
		backupDir := filepath.Join(filepath.Dir(candidate.path), "backups")
		manifestBackups, err := readBackupManifest(backupDir)
		if err != nil {
			return nil, err
		}
		seen := make(map[string]bool, len(manifestBackups))
		for _, backup := range manifestBackups {
			if backup.Type == "" {
				backup.Type = candidate.typ
			}
			if _, err := os.Stat(backup.Path); err == nil {
				backups = append(backups, backup)
				seen[backup.Path] = true
			}
		}
		entries, err := os.ReadDir(backupDir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sqlite") {
				continue
			}
			path := filepath.Join(backupDir, entry.Name())
			if seen[path] {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".sqlite")
			backups = append(backups, BackupManifest{
				ID:        id,
				Type:      candidate.typ,
				Reason:    "unknown",
				Path:      path,
				CreatedAt: info.ModTime().UnixMilli(),
				Size:      info.Size(),
				Prunable:  true,
			})
		}
	}
	sort.SliceStable(backups, func(i, j int) bool {
		return backups[i].CreatedAt > backups[j].CreatedAt
	})
	return backups, nil
}

func PruneBackups(opts PruneOptions) (PruneReport, error) {
	if opts.Keep <= 0 {
		opts.Keep = 10
	}
	if opts.Days <= 0 {
		opts.Days = 30
	}
	report := PruneReport{
		DryRun:    opts.DryRun,
		Permanent: opts.Permanent,
		Keep:      opts.Keep,
		Days:      opts.Days,
	}
	backups, err := ListBackups()
	if err != nil {
		return report, err
	}
	cutoff := time.Now().AddDate(0, 0, -opts.Days).UnixMilli()
	byTypeKept := make(map[string]int)
	for _, backup := range backups {
		keep := !backup.Prunable || byTypeKept[backup.Type] < opts.Keep || backup.CreatedAt >= cutoff
		if keep {
			report.Kept = append(report.Kept, backup)
			byTypeKept[backup.Type]++
			continue
		}
		report.Deleted = append(report.Deleted, backup)
	}
	if opts.DryRun || len(report.Deleted) == 0 {
		return report, nil
	}
	if !opts.Yes {
		return report, fmt.Errorf("backup prune requires --yes")
	}
	for _, backup := range report.Deleted {
		if opts.Permanent {
			if err := os.Remove(backup.Path); err != nil && !os.IsNotExist(err) {
				return report, err
			}
			continue
		}
		if err := moveBackupToTrash(backup.Path); err != nil {
			return report, err
		}
	}
	return report, nil
}

func restoreFromBackups(ctx context.Context, backups []BackupManifest) error {
	for idx := len(backups) - 1; idx >= 0; idx-- {
		backup := backups[idx]
		if err := restoreBackup(ctx, backup); err != nil {
			return err
		}
	}
	return nil
}

func restoreBackup(ctx context.Context, backup BackupManifest) error {
	switch backup.Type {
	case "sessions":
		return restoreSessionBackup(ctx, aisessions.DefaultSQLiteIndexPath(), backup.Path)
	case "common_text":
		return restoreCommonTextBackup(ctx, commonTextSQLitePath(), backup.Path)
	default:
		return fmt.Errorf("unsupported backup type %q", backup.Type)
	}
}

func restoreSessionBackup(ctx context.Context, dbPath string, backupPath string) error {
	if strings.TrimSpace(dbPath) == "" || strings.TrimSpace(backupPath) == "" {
		return fmt.Errorf("session backup restore path is empty")
	}
	db, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=rwc&_busy_timeout=5000", dbPath))
	if err != nil {
		return err
	}
	defer db.Close()
	db.DB.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `ATTACH DATABASE ? AS backup`, backupPath); err != nil {
		return err
	}
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_tags`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_session_tags SELECT * FROM backup.ai_session_tags`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_meta`); err != nil {
		return err
	}
	// ponytail: 老备份库无 title 列，SELECT * 列数不匹配会整表失败；先给备份库补列再拷贝。
	var backupColumns []struct {
		Name string `db:"name"`
	}
	if err := tx.SelectContext(ctx, &backupColumns, `SELECT name FROM pragma_table_info('ai_session_meta', 'backup')`); err != nil {
		return err
	}
	hasTitle := false
	for _, column := range backupColumns {
		if column.Name == "title" {
			hasTitle = true
			break
		}
	}
	if !hasTitle {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE backup.ai_session_meta ADD COLUMN title TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_session_meta SELECT * FROM backup.ai_session_meta`); err != nil {
		return err
	}
	return tx.Commit()
}

func restoreCommonTextBackup(ctx context.Context, dbPath string, backupPath string) error {
	if strings.TrimSpace(dbPath) == "" || strings.TrimSpace(backupPath) == "" {
		return fmt.Errorf("common text backup restore path is empty")
	}
	db, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=rwc&_busy_timeout=5000", dbPath))
	if err != nil {
		return err
	}
	defer db.Close()
	db.DB.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `ATTACH DATABASE ? AS backup`, backupPath); err != nil {
		return err
	}
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM db_common_text`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO db_common_text SELECT * FROM backup.db_common_text`); err != nil {
		return err
	}
	return tx.Commit()
}

func ExportSession(summary aisessions.SessionSummary) SessionExportRecord {
	record := SessionExportRecord{
		Key:         summary.Key,
		ID:          summary.ID,
		Source:      summary.Source,
		Title:       summary.Title,
		ProjectPath: summary.ProjectPath,
		UpdatedAt:   summary.UpdatedAt,
		FilePath:    summary.FilePath,
		Marked:      summary.Marked,
		Note:        summary.Note,
		Tags:        aisessions.NormalizeSessionTags(summary.Tags),
	}
	record.Hash = HashSession(summary)
	return record
}

func ExportCommonText(item commontextstore.Item) CommonTextExportRecord {
	record := CommonTextExportRecord{
		ID:         item.Id,
		Title:      item.Title,
		Text:       item.Text,
		Tags:       append([]string(nil), item.Tags...),
		UpdatedAt:  int64(item.UpdatedAt),
		LastUsedAt: int64(item.LastUsedAt),
		UsageCount: int64(item.UsageCount),
	}
	record.Hash = HashCommonText(item)
	return record
}

func HashSession(summary aisessions.SessionSummary) string {
	payload := struct {
		Key    string   `json:"key"`
		Note   string   `json:"note"`
		Marked bool     `json:"marked"`
		Tags   []string `json:"tags"`
	}{
		Key:    summary.Key,
		Note:   summary.Note,
		Marked: summary.Marked,
		Tags:   aisessions.NormalizeSessionTags(summary.Tags),
	}
	return hashJSON(payload)
}

func HashCommonText(item commontextstore.Item) string {
	payload := struct {
		ID    string   `json:"id"`
		Title string   `json:"title"`
		Text  string   `json:"text"`
		Tags  []string `json:"tags"`
	}{
		ID:    item.Id,
		Title: item.Title,
		Text:  item.Text,
		Tags:  append([]string(nil), item.Tags...),
	}
	return hashJSON(payload)
}

func hashJSON(value any) string {
	data, _ := json.Marshal(value)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func appendBackupManifest(backupDir string, backup BackupManifest) error {
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return err
	}
	return appendJSONL(filepath.Join(backupDir, "manifest.jsonl"), backup)
}

func readBackupManifest(backupDir string) ([]BackupManifest, error) {
	data, err := os.ReadFile(filepath.Join(backupDir, "manifest.jsonl"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var backups []BackupManifest
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var backup BackupManifest
		if err := json.Unmarshal([]byte(line), &backup); err != nil {
			return nil, err
		}
		backups = append(backups, backup)
	}
	return backups, nil
}

func appendAuditEntry(entry AuditEntry) error {
	auditDir := filepath.Join(defaultAgentDataDir(), "audit")
	if err := os.MkdirAll(auditDir, 0o700); err != nil {
		return err
	}
	return appendJSONL(filepath.Join(auditDir, "patch-audit.jsonl"), entry)
}

func appendJSONL(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(data)
	return err
}

func defaultAgentDataDir() string {
	if wavebase.DataHome_VarCache != "" {
		return filepath.Join(wavebase.DataHome_VarCache, "agent-data")
	}
	if env := os.Getenv(wavebase.WaveDataHomeEnvVar); env != "" {
		return filepath.Join(env, "agent-data")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".snorkeling", "agent-data")
	}
	return filepath.Join(os.TempDir(), "snorkeling-agent-data")
}

func moveBackupToTrash(path string) error {
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("non-permanent prune is only implemented on macOS; use --permanent to delete")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	trashDir := filepath.Join(home, ".Trash")
	if err := os.MkdirAll(trashDir, 0o700); err != nil {
		return err
	}
	dest := filepath.Join(trashDir, filepath.Base(path))
	if _, err := os.Stat(dest); err == nil {
		dest = filepath.Join(trashDir, fmt.Sprintf("%s-%d", filepath.Base(path), time.Now().UnixNano()))
	}
	return os.Rename(path, dest)
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func EnsureRuntimeForPatch(patch Patch) error {
	_, needsCommonText := patchDomains(patch)
	if needsCommonText {
		return EnsureCommonTextRuntime()
	}
	return nil
}

func EnsureCommonTextRuntime() error {
	if wstore.IsInitialized() {
		if commonTextDBPath == "" {
			commonTextDBPath = wstore.GetDBName()
		}
		return nil
	}
	if wavebase.DataHome_VarCache == "" {
		if env := os.Getenv(wavebase.WaveDataHomeEnvVar); env != "" {
			wavebase.DataHome_VarCache = env
		}
	}
	if wavebase.ConfigHome_VarCache == "" {
		if env := os.Getenv(wavebase.WaveConfigHomeEnvVar); env != "" {
			wavebase.ConfigHome_VarCache = env
		}
	}
	if wavebase.DataHome_VarCache == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		wavebase.DataHome_VarCache = filepath.Join(home, ".snorkeling")
	}
	if wavebase.ConfigHome_VarCache == "" {
		wavebase.ConfigHome_VarCache = wavebase.DataHome_VarCache
	}
	if err := os.MkdirAll(filepath.Join(wavebase.DataHome_VarCache, wavebase.WaveDBDir), 0o700); err != nil {
		return err
	}
	if err := wstore.InitWStore(); err != nil {
		return err
	}
	commonTextDBPath = wstore.GetDBName()
	return nil
}

func commonTextSQLitePath() string {
	if commonTextDBPath != "" {
		return commonTextDBPath
	}
	if wstore.IsInitialized() {
		return wstore.GetDBName()
	}
	dataHome := wavebase.DataHome_VarCache
	if dataHome == "" {
		dataHome = os.Getenv(wavebase.WaveDataHomeEnvVar)
	}
	if dataHome == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dataHome = filepath.Join(home, ".snorkeling")
		}
	}
	if dataHome == "" {
		return ""
	}
	return filepath.Join(dataHome, wavebase.WaveDBDir, wstore.WStoreDBName)
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:10]
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for idx := range left {
		if left[idx] != right[idx] {
			return false
		}
	}
	return true
}
