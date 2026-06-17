// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentcap"
	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var dataCmd = &cobra.Command{
	Use:   "data",
	Short: "Export and safely patch Snorkeling data",
}

var dataExportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export Snorkeling data",
	RunE:  dataExportRun,
}

var dataGuideCmd = &cobra.Command{
	Use:   "guide",
	Short: "Show agent-safe Snorkeling data editing guidance",
	RunE:  dataGuideRun,
}

var dataSchemaCmd = &cobra.Command{
	Use:   "schema",
	Short: "Show the agent data patch JSON schema",
	RunE:  dataSchemaRun,
}

var dataExamplesCmd = &cobra.Command{
	Use:   "examples",
	Short: "Show agent data patch examples",
	RunE:  dataExamplesRun,
}

var dataPromptCmd = &cobra.Command{
	Use:   "prompt",
	Short: "Show a compact prompt for external AI agents",
	RunE:  dataPromptRun,
}

var dataImportAICmd = &cobra.Command{
	Use:     "import-ai",
	Short:   "Append Snorkeling data guidance to the current Wave AI prompt",
	RunE:    dataImportAIRun,
	PreRunE: preRunSetupRpcClient,
}

var dataApplyCmd = &cobra.Command{
	Use:   "apply [patch.json]",
	Short: "Dry-run or apply an agent data patch",
	Args:  cobra.ExactArgs(1),
	RunE:  dataApplyRun,
}

var dataBackupCmd = &cobra.Command{
	Use:   "backup",
	Short: "Manage Snorkeling data backups",
}

var dataBackupListCmd = &cobra.Command{
	Use:   "list",
	Short: "List Snorkeling data backups",
	RunE:  dataBackupListRun,
}

var dataBackupPruneCmd = &cobra.Command{
	Use:   "prune",
	Short: "Prune Snorkeling data backups",
	RunE:  dataBackupPruneRun,
}

var dataExportDomain string
var dataExportOut string
var dataApplyDryRun bool
var dataApplyYes bool
var dataApplyFormat string
var dataBackupListFormat string
var dataBackupPruneDryRun bool
var dataBackupPruneYes bool
var dataBackupPruneKeep int
var dataBackupPruneDays int
var dataBackupPrunePermanent bool
var dataBackupPruneFormat string
var dataImportAISubmit bool
var dataImportAINew bool

func init() {
	rootCmd.AddCommand(dataCmd)
	dataCmd.AddCommand(dataExportCmd)
	dataCmd.AddCommand(dataGuideCmd)
	dataCmd.AddCommand(dataSchemaCmd)
	dataCmd.AddCommand(dataExamplesCmd)
	dataCmd.AddCommand(dataPromptCmd)
	dataCmd.AddCommand(dataImportAICmd)
	dataCmd.AddCommand(dataApplyCmd)
	dataCmd.AddCommand(dataBackupCmd)
	dataBackupCmd.AddCommand(dataBackupListCmd)
	dataBackupCmd.AddCommand(dataBackupPruneCmd)

	dataExportCmd.Flags().StringVar(&dataExportDomain, "domain", "all", "domain to export: sessions, commontext, or all")
	dataExportCmd.Flags().StringVar(&dataExportOut, "out", "", "write export JSON to file")
	dataApplyCmd.Flags().BoolVar(&dataApplyDryRun, "dry-run", false, "validate and preview without writing")
	dataApplyCmd.Flags().BoolVar(&dataApplyYes, "yes", false, "confirm real patch apply")
	dataApplyCmd.Flags().StringVar(&dataApplyFormat, "format", "json", "output format: json or summary")
	dataBackupListCmd.Flags().StringVar(&dataBackupListFormat, "format", "json", "output format: json or summary")
	dataBackupPruneCmd.Flags().BoolVar(&dataBackupPruneDryRun, "dry-run", false, "preview backup pruning without deleting")
	dataBackupPruneCmd.Flags().BoolVar(&dataBackupPruneYes, "yes", false, "confirm backup pruning")
	dataBackupPruneCmd.Flags().IntVar(&dataBackupPruneKeep, "keep", 10, "keep at least this many backups per type")
	dataBackupPruneCmd.Flags().IntVar(&dataBackupPruneDays, "days", 30, "keep backups newer than this many days")
	dataBackupPruneCmd.Flags().BoolVar(&dataBackupPrunePermanent, "permanent", false, "permanently delete instead of moving to Trash")
	dataBackupPruneCmd.Flags().StringVar(&dataBackupPruneFormat, "format", "json", "output format: json or summary")
	dataImportAICmd.Flags().BoolVar(&dataImportAISubmit, "submit", false, "submit the prompt immediately after importing")
	dataImportAICmd.Flags().BoolVar(&dataImportAINew, "new", false, "create a new AI chat before importing")
}

func dataExportRun(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	export, err := buildDataExport(ctx, dataExportDomain)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(export, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if strings.TrimSpace(dataExportOut) != "" {
		return os.WriteFile(dataExportOut, data, 0o600)
	}
	_, err = WrappedStdout.Write(data)
	return err
}

func dataGuideRun(cmd *cobra.Command, args []string) error {
	_, err := WrappedStdout.Write([]byte(agentcap.GuideText()))
	return err
}

func dataSchemaRun(cmd *cobra.Command, args []string) error {
	_, err := WrappedStdout.Write([]byte(agentcap.SchemaText()))
	return err
}

func dataExamplesRun(cmd *cobra.Command, args []string) error {
	_, err := WrappedStdout.Write([]byte(agentcap.ExamplesText()))
	return err
}

func dataPromptRun(cmd *cobra.Command, args []string) error {
	_, err := WrappedStdout.Write([]byte(agentcap.ExternalAgentPrompt()))
	return err
}

func dataImportAIRun(cmd *cobra.Command, args []string) error {
	tabId := os.Getenv("WAVETERM_TABID")
	if tabId == "" {
		return fmt.Errorf("WAVETERM_TABID environment variable not set")
	}
	err := wshclient.WaveAIAddContextCommand(RpcClient, wshrpc.CommandWaveAIAddContextData{
		Text:    agentcap.ExternalAgentPrompt(),
		Submit:  dataImportAISubmit,
		NewChat: dataImportAINew,
	}, &wshrpc.RpcOpts{
		Route:   wshutil.MakeTabRouteId(tabId),
		Timeout: 30000,
	})
	if err != nil {
		return fmt.Errorf("importing Snorkeling data guidance into Wave AI: %w", err)
	}
	return nil
}

func dataApplyRun(cmd *cobra.Command, args []string) error {
	patch, err := agentdata.LoadPatchFile(args[0])
	if err != nil {
		return err
	}
	report, err := agentdata.ApplyPatch(context.Background(), patch, agentdata.ApplyOptions{
		DryRun: dataApplyDryRun,
		Yes:    dataApplyYes,
	})
	if writeErr := writeFormatted(dataApplyFormat, report, func() string {
		return formatApplySummary(report)
	}); writeErr != nil && err == nil {
		return writeErr
	}
	if err != nil {
		return err
	}
	return nil
}

func dataBackupListRun(cmd *cobra.Command, args []string) error {
	backups, err := agentdata.ListBackups()
	if err != nil {
		return err
	}
	return writeFormatted(dataBackupListFormat, map[string]any{"backups": backups}, func() string {
		return formatBackupListSummary(backups)
	})
}

func dataBackupPruneRun(cmd *cobra.Command, args []string) error {
	report, err := agentdata.PruneBackups(agentdata.PruneOptions{
		DryRun:    dataBackupPruneDryRun || !dataBackupPruneYes,
		Yes:       dataBackupPruneYes,
		Keep:      dataBackupPruneKeep,
		Days:      dataBackupPruneDays,
		Permanent: dataBackupPrunePermanent,
	})
	if writeErr := writeFormatted(dataBackupPruneFormat, report, func() string {
		return formatPruneSummary(report)
	}); writeErr != nil && err == nil {
		return writeErr
	}
	return err
}

func writeFormatted(format string, value any, summaryFn func() string) error {
	switch strings.TrimSpace(strings.ToLower(format)) {
	case "", "json":
		data, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		data = append(data, '\n')
		_, err = WrappedStdout.Write(data)
		return err
	case "summary", "text":
		_, err := WrappedStdout.Write([]byte(summaryFn()))
		return err
	default:
		return fmt.Errorf("format must be json or summary")
	}
}

func formatApplySummary(report agentdata.Report) string {
	var builder strings.Builder
	mode := "apply"
	if report.DryRun {
		mode = "dry-run"
	}
	fmt.Fprintf(&builder, "data apply %s: %d operations\n", mode, len(report.Operations))
	if report.Source != "" {
		fmt.Fprintf(&builder, "source: %s\n", report.Source)
	}
	if len(report.Backups) > 0 {
		fmt.Fprintf(&builder, "backups: %d\n", len(report.Backups))
		for _, backup := range report.Backups {
			fmt.Fprintf(&builder, "- %s %s %s\n", backup.Type, backup.ID, backup.Path)
		}
	}
	for _, operation := range report.Operations {
		status := "unchanged"
		if operation.Changed {
			status = "changed"
		}
		if operation.Error != "" {
			status = "error"
		}
		target := operation.Target
		if target == "" {
			target = operation.Domain
		}
		if target == "" {
			target = "-"
		}
		fmt.Fprintf(&builder, "- #%d %s %s target=%s affected=%d\n", operation.Index, operation.Type, status, target, operation.AffectedCount)
		for _, change := range operation.Changes {
			fmt.Fprintf(&builder, "  %s: %s -> %s\n", change.Field, formatChangeValue(change.Before), formatChangeValue(change.After))
		}
		for _, message := range operation.Messages {
			fmt.Fprintf(&builder, "  note: %s\n", message)
		}
		if operation.Error != "" {
			fmt.Fprintf(&builder, "  error: %s\n", operation.Error)
		}
	}
	return builder.String()
}

func formatBackupListSummary(backups []agentdata.BackupManifest) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "data backups: %d\n", len(backups))
	counts := make(map[string]int)
	for _, backup := range backups {
		counts[backup.Type]++
	}
	var types []string
	for backupType := range counts {
		types = append(types, backupType)
	}
	sort.Strings(types)
	for _, backupType := range types {
		fmt.Fprintf(&builder, "%s: %d\n", backupType, counts[backupType])
	}
	for _, backup := range backups {
		fmt.Fprintf(&builder, "- %s %s %s %s %s\n", backup.Type, backup.ID, formatUnixMillis(backup.CreatedAt), formatBytes(backup.Size), backup.Path)
	}
	return builder.String()
}

func formatPruneSummary(report agentdata.PruneReport) string {
	var builder strings.Builder
	mode := "prune"
	if report.DryRun {
		mode = "prune dry-run"
	}
	fmt.Fprintf(&builder, "data backup %s: delete=%d keep=%d policy=keep:%d days:%d permanent:%v\n", mode, len(report.Deleted), len(report.Kept), report.Keep, report.Days, report.Permanent)
	if len(report.Deleted) > 0 {
		builder.WriteString("delete:\n")
		for _, backup := range report.Deleted {
			fmt.Fprintf(&builder, "- %s %s %s %s\n", backup.Type, backup.ID, formatUnixMillis(backup.CreatedAt), backup.Path)
		}
	}
	return builder.String()
}

func formatChangeValue(value any) string {
	switch typed := value.(type) {
	case string:
		return quoteCompact(typed)
	case []string:
		return "[" + strings.Join(typed, ", ") + "]"
	default:
		data, err := json.Marshal(typed)
		if err != nil {
			return fmt.Sprintf("%v", typed)
		}
		return string(data)
	}
}

func quoteCompact(value string) string {
	value = strings.ReplaceAll(value, "\n", "\\n")
	runes := []rune(value)
	if len(runes) > 80 {
		value = string(runes[:77]) + "..."
	}
	return fmt.Sprintf("%q", value)
}

func formatUnixMillis(value int64) string {
	if value <= 0 {
		return "-"
	}
	return time.UnixMilli(value).Format(time.RFC3339)
}

func formatBytes(value int64) string {
	if value < 1024 {
		return fmt.Sprintf("%dB", value)
	}
	if value < 1024*1024 {
		return fmt.Sprintf("%.1fKB", float64(value)/1024)
	}
	if value < 1024*1024*1024 {
		return fmt.Sprintf("%.1fMB", float64(value)/(1024*1024))
	}
	return fmt.Sprintf("%.1fGB", float64(value)/(1024*1024*1024))
}

func buildDataExport(ctx context.Context, domain string) (map[string]any, error) {
	normalizedDomain := normalizeDataDomain(domain)
	if normalizedDomain == "" {
		return nil, fmt.Errorf("domain must be sessions, commontext, or all")
	}
	export := map[string]any{
		"version": 1,
		"domain":  normalizedDomain,
	}
	if normalizedDomain == "sessions" || normalizedDomain == "all" {
		sessions, err := aisessions.NewManager("", nil).List(ctx, aisessions.ListOptions{Limit: 0})
		if err != nil {
			return nil, err
		}
		records := make([]agentdata.SessionExportRecord, 0, len(sessions))
		for _, session := range sessions {
			records = append(records, agentdata.ExportSession(session))
		}
		export["sessions"] = records
	}
	if normalizedDomain == "commontext" || normalizedDomain == "all" {
		if err := agentdata.EnsureCommonTextRuntime(); err != nil {
			return nil, err
		}
		items, err := commontextstore.List(ctx, commontextstore.ListOptions{})
		if err != nil {
			return nil, err
		}
		records := make([]agentdata.CommonTextExportRecord, 0, len(items))
		for _, item := range items {
			records = append(records, agentdata.ExportCommonText(item))
		}
		export["commonText"] = records
	}
	return export, nil
}

func normalizeDataDomain(domain string) string {
	switch strings.TrimSpace(strings.ToLower(domain)) {
	case "", "all":
		return "all"
	case "session", "sessions":
		return "sessions"
	case "commontext", "common_text", "common-text":
		return "commontext"
	default:
		return ""
	}
}
