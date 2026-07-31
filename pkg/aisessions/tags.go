// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

func NormalizeSessionTags(tags []string) []string {
	seen := make(map[string]bool, len(tags))
	normalized := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(strings.ToLower(tag))
		tag = strings.Trim(tag, "#")
		if tag == "" || seen[tag] || !isValidSessionTag(tag) {
			continue
		}
		seen[tag] = true
		normalized = append(normalized, tag)
	}
	return normalized
}

func MergeSessionTags(existing []string, next []string) []string {
	return NormalizeSessionTags(append(append([]string(nil), existing...), next...))
}

func ExtractSessionTagsFromNote(note string) (string, []string) {
	note = strings.TrimSpace(note)
	if !strings.Contains(note, "#") {
		return note, nil
	}
	var tags []string
	for i := 0; i < len(note); {
		if note[i] != '#' || i+1 >= len(note) || !tagBoundaryBefore(note, i) {
			_, size := utf8.DecodeRuneInString(note[i:])
			i += size
			continue
		}
		tagStart := i + 1
		tagEnd := tagStart
		for tagEnd < len(note) {
			r, size := utf8.DecodeRuneInString(note[tagEnd:])
			if !isSessionTagRune(r) {
				break
			}
			tagEnd += size
		}
		if tagEnd == tagStart {
			i++
			continue
		}
		tags = append(tags, note[tagStart:tagEnd])
		i = tagEnd
	}
	return note, NormalizeSessionTags(tags)
}

func tagBoundaryBefore(text string, idx int) bool {
	if idx == 0 {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(text[:idx])
	return unicode.IsSpace(r)
}

func isSessionTagRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-'
}

func isValidSessionTag(tag string) bool {
	for _, r := range tag {
		if !isSessionTagRune(r) {
			return false
		}
	}
	return true
}

// TagPresence values for ListOptions.TagPresence / SearchOptions.TagPresence.
// Empty string and TagPresenceAny mean "no presence constraint".
// TagPresenceUntagged means "session has no tags after normalization".
// See docs/CLAUDE.md "session.note 语义 — tags live inside the note string":
// "no tags" is defined by NormalizeSessionTags(summary.Tags) being empty,
// NOT by Boolean(note) — a pure "#fix" note still counts as tagged.
const (
	TagPresenceAny      = ""
	TagPresenceUntagged = "untagged"
)

// SessionHasTags reports whether summary has at least one normalized tag.
// Centralized so List/Search filter logic and tests share one definition.
func SessionHasTags(summary SessionSummary) bool {
	return len(NormalizeSessionTags(summary.Tags)) > 0
}

// sessionMatchesTagPresence returns true when summary satisfies the requested
// tag-presence constraint. Defensive: when both TagPresence and TagFilters are
// set, the two are mutually exclusive at the UI layer (an "untagged AND has #x"
// query is logically empty); we returns false here so a misuse can never produce
// a confusing partial result instead of an obvious empty one.
func sessionMatchesTagPresence(summary SessionSummary, tagPresence string, tagFilters []string) bool {
	switch tagPresence {
	case TagPresenceUntagged:
		if len(tagFilters) > 0 {
			return false
		}
		return !SessionHasTags(summary)
	default:
		// TagPresenceAny or any unrecognized value: no constraint.
		return true
	}
}

func sessionTagsContainAll(tags []string, filters []string) bool {
	filters = NormalizeSessionTags(filters)
	if len(filters) == 0 {
		return true
	}
	if len(tags) == 0 {
		return false
	}
	tagSet := make(map[string]bool, len(tags))
	for _, tag := range NormalizeSessionTags(tags) {
		tagSet[tag] = true
	}
	for _, filter := range filters {
		if !tagSet[filter] {
			return false
		}
	}
	return true
}

func sortSessionTagSummaries(tags []SessionTagSummary) {
	sort.SliceStable(tags, func(i, j int) bool {
		if tags[i].Count != tags[j].Count {
			return tags[i].Count > tags[j].Count
		}
		return tags[i].Tag < tags[j].Tag
	})
}
