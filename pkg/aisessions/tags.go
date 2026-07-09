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
