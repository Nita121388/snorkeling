// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncconflict

import (
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// RenderMarkdown turns one conflict into a self-contained block that can be pasted straight into
// an AI conversation.
//
// Three things make it work without a follow-up explanation from the user:
//
//   - both versions are shown in full, with who/when for each side;
//   - only the conflicting fields are shown, so the reader is not asked to diff whole documents;
//   - it ends with an explicit task statement and an output contract.
//
// Without the task statement the user has to write "merge these for me" every time, which is
// exactly the friction this feature exists to remove.
func RenderMarkdown(e Entry) string {
	var b strings.Builder

	title := e.Title
	if title == "" && e.Local != nil && e.Local.Title != "" {
		title = e.Local.Title
	}
	if title == "" {
		title = "(untitled)"
	}
	fmt.Fprintf(&b, "## Sync conflict: %s\n\n", title)
	fmt.Fprintf(&b, "- id: `%s`\n", e.Id)
	if len(e.Fields) > 0 {
		fmt.Fprintf(&b, "- conflicting field(s): %s\n", strings.Join(e.Fields, ", "))
	}
	if e.Transport != "" {
		fmt.Fprintf(&b, "- transport: %s\n", e.Transport)
	}
	if e.DetectedAt != "" {
		fmt.Fprintf(&b, "- detected: %s\n", humanTime(e.DetectedAt))
	}
	b.WriteString("\nBoth sides changed the same content since the last successful sync. " +
		"Nothing was overwritten.\n\n")

	writeSide(&b, "This machine", e.Local, e.Fields)
	writeSide(&b, remoteLabel(e), e.Remote, e.Fields)

	b.WriteString("### Task\n\n")
	b.WriteString("Merge both versions into one, keeping every intentional change from each side. ")
	b.WriteString("If they contradict each other, prefer the more complete version and note what you chose.\n\n")
	b.WriteString("Reply with the merged content only — no explanation, no code fences around the whole answer.\n")

	return b.String()
}

func remoteLabel(e Entry) string {
	if e.DeviceName != "" {
		return e.DeviceName
	}
	return "Remote"
}

// writeSide emits one version. Only the conflicting fields are shown: dumping every field would
// bury the actual difference and make the block long enough to waste context.
func writeSide(b *strings.Builder, label string, it *syncproto.SnapshotItem, fields []string) {
	fmt.Fprintf(b, "### %s\n\n", label)
	if it == nil {
		b.WriteString("(not available)\n\n")
		return
	}
	if it.UpdatedAt > 0 {
		fmt.Fprintf(b, "_last modified %s_\n\n", humanMillis(it.UpdatedAt))
	}
	if len(fields) == 0 {
		fields = []string{syncproto.ConflictFieldText}
	}
	for _, field := range fields {
		switch field {
		case syncproto.ConflictFieldText:
			b.WriteString("```markdown\n")
			b.WriteString(strings.TrimRight(it.Text, "\n"))
			b.WriteString("\n```\n\n")
		case syncproto.ConflictFieldTitle:
			fmt.Fprintf(b, "title: `%s`\n\n", it.Title)
		case syncproto.ConflictFieldTags:
			fmt.Fprintf(b, "tags: `%s`\n\n", strings.Join(it.Tags, ", "))
		case syncproto.ConflictFieldShortcut:
			fmt.Fprintf(b, "shortcut: `%s`\n\n", it.Shortcut)
		}
	}
}

// RenderAll renders every conflict separated by a rule, for "copy all".
func RenderAll(entries []Entry) string {
	if len(entries) == 0 {
		return ""
	}
	var b strings.Builder
	if len(entries) > 1 {
		fmt.Fprintf(&b, "# Sync conflicts (%d)\n\n", len(entries))
		b.WriteString("Resolve each block independently.\n\n---\n\n")
	}
	for i, e := range entries {
		if i > 0 {
			b.WriteString("\n---\n\n")
		}
		b.WriteString(RenderMarkdown(e))
	}
	return b.String()
}

// humanMillis formats an item's epoch-millis updatedat.
func humanMillis(ms float64) string {
	ts := time.UnixMilli(int64(ms))
	return ts.Local().Format("2006-01-02 15:04:05")
}

func humanTime(rfc3339 string) string {
	ts, err := time.Parse(time.RFC3339, rfc3339)
	if err != nil {
		return rfc3339
	}
	return ts.Local().Format("2006-01-02 15:04:05")
}
