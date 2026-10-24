// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import "strings"

// ProjectFilterOther is the sentinel used by the path filter UI to select the
// "Other" bucket: sessions whose projectPath is empty or not an absolute path
// (the frontend cannot distinguish those from real roots, and with multi-select
// it can no longer post-filter the response). The frontend constant
// PathFilterOtherRoot must use the same value.
const ProjectFilterOther = "__other__"

// normalizeProjectPrefix canonicalizes one path filter into a stable prefix:
//   - "" (after trimming) is dropped by the caller
//   - the Other sentinel is preserved verbatim
//   - root forms keep their trailing separator ("/", "E:\", "~/") because
//     projectPathMatches relies on it to detect the component boundary
//   - everything else drops trailing separators so ".../foo/" and ".../foo"
//     dedupe, and case-insensitive comparison happens at match time
func normalizeProjectPrefix(raw string) string {
	p := strings.TrimSpace(raw)
	if p == "" || p == ProjectFilterOther {
		return p
	}
	if p == "/" {
		return "/"
	}
	if p == "~" || p == "~/" || p == `~\` {
		return "~/"
	}
	if len(p) == 2 && p[1] == ':' && isDriveLetterByte(p[0]) {
		return strings.ToUpper(p[:1]) + `:\`
	}
	if len(p) == 3 && p[1] == ':' && (p[2] == '/' || p[2] == '\\') && isDriveLetterByte(p[0]) {
		return strings.ToUpper(p[:1]) + `:\`
	}
	if trimmed := strings.TrimRight(p, `/\`); trimmed != "" {
		return trimmed
	}
	return p
}

func isDriveLetterByte(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// normalizeProjectFilters canonicalizes and dedupes (case-insensitively, keeping
// first occurrence order) a path filter list. Empty entries are dropped.
func normalizeProjectFilters(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, raw := range in {
		p := normalizeProjectPrefix(raw)
		if p == "" {
			continue
		}
		key := strings.ToLower(p)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return out
}

// projectPathIsOther mirrors the frontend extractRootOfPath() == "" check:
// empty or non-absolute projectPath belongs to the Other bucket.
func projectPathIsOther(projectPath string) bool {
	p := strings.TrimSpace(projectPath)
	if p == "" {
		return true
	}
	if strings.HasPrefix(p, "/") {
		return false
	}
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		return false
	}
	if len(p) >= 3 && p[1] == ':' && (p[2] == '/' || p[2] == '\\') && isDriveLetterByte(p[0]) {
		return false
	}
	return true
}

// effectiveProjects resolves the include-side path filter. Projects wins when
// present; Project remains as the single-value compatibility field for older
// callers.
func effectiveProjects(opts ListOptions) []string {
	if len(opts.Projects) > 0 {
		return normalizeProjectFilters(opts.Projects)
	}
	if strings.TrimSpace(opts.Project) != "" {
		return normalizeProjectFilters([]string{opts.Project})
	}
	return nil
}

// projectPathMatchesAny reports whether projectPath matches any selected prefix.
// An empty list means "no include constraint". Selecting a parent and one of its
// children is idempotent (both match the same sessions), so redundant selections
// never change the result.
func projectPathMatchesAny(projectPath string, projects []string) bool {
	if len(projects) == 0 {
		return true
	}
	for _, project := range projects {
		if project == ProjectFilterOther {
			if projectPathIsOther(projectPath) {
				return true
			}
			continue
		}
		if projectPathMatches(projectPath, project) {
			return true
		}
	}
	return false
}

// projectPathExcluded is the negation of the include match, used by the exclude
// filter. An empty exclude list excludes nothing.
func projectPathExcluded(projectPath string, excludes []string) bool {
	if len(excludes) == 0 {
		return false
	}
	for _, project := range excludes {
		if project == ProjectFilterOther {
			if projectPathIsOther(projectPath) {
				return true
			}
			continue
		}
		if projectPathMatches(projectPath, project) {
			return true
		}
	}
	return false
}
