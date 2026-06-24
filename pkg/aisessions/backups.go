// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const DefaultBackupKeepRecent = 3
const DefaultBackupMaxAgeDays = 7

type BackupRetentionOptions struct {
	KeepRecent int `json:"keepRecent,omitempty"`
	MaxAgeDays int `json:"maxAgeDays,omitempty"`
}

type BackupFileSummary struct {
	Path             string `json:"path"`
	Name             string `json:"name"`
	Kind             string `json:"kind"`
	Size             int64  `json:"size"`
	ModTime          int64  `json:"modtime"`
	CleanupCandidate bool   `json:"cleanupCandidate,omitempty"`
}

type BackupStats struct {
	Backups      []BackupFileSummary `json:"backups"`
	Count        int                 `json:"count"`
	Size         int64               `json:"size"`
	CleanupCount int                 `json:"cleanupCount"`
	CleanupSize  int64               `json:"cleanupSize"`
	KeepRecent   int                 `json:"keepRecent"`
	MaxAgeDays   int                 `json:"maxAgeDays"`
}

type BackupCleanupResult struct {
	Deleted []BackupFileSummary `json:"deleted"`
	Stats   BackupStats         `json:"stats"`
	Count   int                 `json:"count"`
	Size    int64               `json:"size"`
}

func BackupStatsForPaths(ctx context.Context, sqlitePath string, metaPath string, opts BackupRetentionOptions) (BackupStats, error) {
	opts = normalizeBackupRetentionOptions(opts)
	backups, err := scanKnownBackupFiles(ctx, sqlitePath, metaPath)
	if err != nil {
		return BackupStats{}, err
	}
	markBackupCleanupCandidates(backups, opts)
	return makeBackupStats(backups, opts), nil
}

func CleanupBackupsForPaths(ctx context.Context, sqlitePath string, metaPath string, opts BackupRetentionOptions) (BackupCleanupResult, error) {
	stats, err := BackupStatsForPaths(ctx, sqlitePath, metaPath, opts)
	if err != nil {
		return BackupCleanupResult{}, err
	}
	var deleted []BackupFileSummary
	var deletedSize int64
	for _, backup := range stats.Backups {
		if ctx.Err() != nil {
			return BackupCleanupResult{}, ctx.Err()
		}
		if !backup.CleanupCandidate {
			continue
		}
		if err := os.Remove(backup.Path); err != nil {
			return BackupCleanupResult{}, err
		}
		deleted = append(deleted, backup)
		deletedSize += backup.Size
	}
	after, err := BackupStatsForPaths(ctx, sqlitePath, metaPath, opts)
	if err != nil {
		return BackupCleanupResult{}, err
	}
	return BackupCleanupResult{
		Deleted: deleted,
		Stats:   after,
		Count:   len(deleted),
		Size:    deletedSize,
	}, nil
}

func normalizeBackupRetentionOptions(opts BackupRetentionOptions) BackupRetentionOptions {
	if opts.KeepRecent <= 0 {
		opts.KeepRecent = DefaultBackupKeepRecent
	}
	if opts.MaxAgeDays <= 0 {
		opts.MaxAgeDays = DefaultBackupMaxAgeDays
	}
	return opts
}

func scanKnownBackupFiles(ctx context.Context, sqlitePath string, metaPath string) ([]BackupFileSummary, error) {
	var backups []BackupFileSummary
	seen := make(map[string]bool)
	for _, spec := range backupScanSpecs(sqlitePath, metaPath) {
		if ctx.Err() != nil {
			return backups, ctx.Err()
		}
		matches, err := filepath.Glob(filepath.Join(spec.dir, spec.pattern))
		if err != nil {
			return backups, err
		}
		for _, path := range matches {
			if ctx.Err() != nil {
				return backups, ctx.Err()
			}
			cleanPath := filepath.Clean(path)
			if seen[cleanPath] {
				continue
			}
			info, err := os.Stat(cleanPath)
			if err != nil || info.IsDir() {
				continue
			}
			seen[cleanPath] = true
			backups = append(backups, BackupFileSummary{
				Path:    cleanPath,
				Name:    filepath.Base(cleanPath),
				Kind:    spec.kind,
				Size:    info.Size(),
				ModTime: info.ModTime().UnixMilli(),
			})
		}
	}
	sortBackupFiles(backups)
	return backups, nil
}

type backupScanSpec struct {
	dir     string
	pattern string
	kind    string
}

func backupScanSpecs(sqlitePath string, metaPath string) []backupScanSpec {
	var specs []backupScanSpec
	if strings.TrimSpace(sqlitePath) != "" {
		specs = append(specs, backupScanSpec{
			dir:     filepath.Dir(sqlitePath),
			pattern: filepath.Base(sqlitePath) + ".backup-before-tags-*",
			kind:    "session-tags",
		})
	}
	if strings.TrimSpace(metaPath) != "" {
		specs = append(specs, backupScanSpec{
			dir:     filepath.Dir(metaPath),
			pattern: filepath.Base(metaPath) + ".backup-before-sqlite-*",
			kind:    "meta-json",
		})
	}
	return specs
}

func markBackupCleanupCandidates(backups []BackupFileSummary, opts BackupRetentionOptions) {
	cutoff := time.Now().AddDate(0, 0, -opts.MaxAgeDays).UnixMilli()
	for idx := range backups {
		if idx < opts.KeepRecent {
			continue
		}
		backups[idx].CleanupCandidate = backups[idx].ModTime < cutoff
	}
}

func makeBackupStats(backups []BackupFileSummary, opts BackupRetentionOptions) BackupStats {
	stats := BackupStats{
		Backups:    backups,
		Count:      len(backups),
		KeepRecent: opts.KeepRecent,
		MaxAgeDays: opts.MaxAgeDays,
	}
	for _, backup := range backups {
		stats.Size += backup.Size
		if backup.CleanupCandidate {
			stats.CleanupCount++
			stats.CleanupSize += backup.Size
		}
	}
	return stats
}

func sortBackupFiles(backups []BackupFileSummary) {
	sort.SliceStable(backups, func(i int, j int) bool {
		if backups[i].ModTime != backups[j].ModTime {
			return backups[i].ModTime > backups[j].ModTime
		}
		return backups[i].Name > backups[j].Name
	})
}
