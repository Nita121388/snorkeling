// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// Declarative provider field roles. One role per SessionSummary field that can
// be mapped to a source column.
const (
	declarativeFieldID      = "id"
	declarativeFieldTitle   = "title"
	declarativeFieldUpdated = "updated"
	declarativeFieldCreated = "created"
	declarativeFieldProject = "project"
	declarativeFieldParent  = "parent"
)

// declarativeTimeLayouts are the accepted text timestamp shapes, most specific
// first. The first one is the observed Antigravity shape
// ("2026-11-26 03:21:47.2006764+00:00" — note 7 fractional digits, which the
// .999999999 layout accepts).
var declarativeTimeLayouts = []string{
	"2006-01-02 15:04:05.999999999-07:00",
	time.RFC3339Nano,
	"2006-01-02 15:04:05.999999999",
	"2006-01-02T15:04:05.999999999",
	"2006-01-02 15:04:05",
}

// DeclarativeSQLiteProvider lists sessions of an agent whose conversation index
// is a sqlite table (config-declared table + column mapping).
//
// It is deliberately list-only: the mapping mechanism covers rows/columns, not
// message bodies. Antigravity stores each conversation body as a protobuf blob
// with no public schema, so LoadMessages returns an empty list and the detail
// view degrades to header + placeholder instead of erroring.
//
// Read-only by contract: the foreign db is opened with mode=ro and is never
// modified (same rule as every other session provider).
type DeclarativeSQLiteProvider struct {
	source string
	cfg    wconfig.AgentSessionProviderConfigType
}

// declarativeSelectColumn is one "role → source column" pair actually selected.
type declarativeSelectColumn struct {
	field  string
	column string
}

func NewDeclarativeSQLiteProvider(source string, cfg wconfig.AgentSessionProviderConfigType) *DeclarativeSQLiteProvider {
	return &DeclarativeSQLiteProvider{source: source, cfg: cfg}
}

func (p *DeclarativeSQLiteProvider) Source() string {
	return p.source
}

// Label implements LabeledProvider; the source filter and source badge use it
// instead of showing the bare config key.
func (p *DeclarativeSQLiteProvider) Label() string {
	return p.cfg.Label
}

// Config returns the normalized declarative config (db is already "~"-expanded).
func (p *DeclarativeSQLiteProvider) Config() wconfig.AgentSessionProviderConfigType {
	return p.cfg
}

func (p *DeclarativeSQLiteProvider) listLimit() int {
	if p.cfg.ListLimit > 0 {
		return p.cfg.ListLimit
	}
	return declarativeDefaultListLimit
}

// openDB opens the foreign sqlite db read-only. Mirrors
// provider_opencode.go / ccswitch.openReadOnly: the DSN keeps the raw path
// (building a url.URL would emit file:C:/... where "C:" is parsed as the URI
// authority), and we never request a journal mode — under mode=ro SQLite must
// not rewrite the header, while WAL data written by the owning agent is still
// visible.
func (p *DeclarativeSQLiteProvider) openDB() (*sql.DB, error) {
	dbPath := strings.TrimSpace(p.cfg.DB)
	if dbPath == "" {
		return nil, fmt.Errorf("declarative provider %q: db path is empty", p.source)
	}
	if info, err := os.Stat(dbPath); err != nil {
		return nil, err
	} else if info.IsDir() {
		return nil, fmt.Errorf("declarative provider %q: db path %q is a directory", p.source, dbPath)
	}
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000", dbPath))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// selectColumns returns the mapped columns that are actually declared (missing
// columns are allowed and simply drop that field).
func (p *DeclarativeSQLiteProvider) selectColumns() []declarativeSelectColumn {
	columns := p.cfg.Columns
	out := make([]declarativeSelectColumn, 0, 6)
	add := func(field, column string) {
		column = strings.TrimSpace(column)
		if column == "" {
			return
		}
		out = append(out, declarativeSelectColumn{field: field, column: column})
	}
	add(declarativeFieldID, columns.ID)
	add(declarativeFieldTitle, columns.Title)
	add(declarativeFieldUpdated, columns.Updated)
	add(declarativeFieldCreated, columns.Created)
	add(declarativeFieldProject, columns.Project)
	add(declarativeFieldParent, columns.ParentID)
	return out
}

func (p *DeclarativeSQLiteProvider) selectClause(columns []declarativeSelectColumn) string {
	quoted := make([]string, len(columns))
	for i, column := range columns {
		quoted[i] = quoteSQLiteIdent(column.column)
	}
	return "SELECT " + strings.Join(quoted, ", ") + " FROM " + quoteSQLiteIdent(strings.TrimSpace(p.cfg.Table))
}

// listQuery is the bounded list query: only declared columns, newest first when
// an "updated" column is mapped, and always LIMIT-capped.
func (p *DeclarativeSQLiteProvider) listQuery(columns []declarativeSelectColumn) string {
	query := p.selectClause(columns)
	if updated := strings.TrimSpace(p.cfg.Columns.Updated); updated != "" {
		query += " ORDER BY " + quoteSQLiteIdent(updated) + " DESC"
	}
	return query + " LIMIT " + strconv.Itoa(p.listLimit())
}

func (p *DeclarativeSQLiteProvider) summaryByIDQuery(columns []declarativeSelectColumn) string {
	return p.selectClause(columns) + " WHERE " + quoteSQLiteIdent(strings.TrimSpace(p.cfg.Columns.ID)) + " = ?"
}

func (p *DeclarativeSQLiteProvider) List(ctx context.Context) ([]SessionSummary, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	db, err := p.openDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	columns := p.selectColumns()
	rows, err := db.QueryContext(ctx, p.listQuery(columns))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summaries := make([]SessionSummary, 0, 16)
	for rows.Next() {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		values, err := scanDeclarativeRow(rows, len(columns))
		if err != nil {
			return summaries, err
		}
		summary := p.rowToSummary(values, columns)
		if summary.ID == "" {
			continue
		}
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return summaries, err
	}
	return summaries, nil
}

// ListFiles implements SummaryFileProvider so the manager's incremental refresh
// path keeps working (a provider that does not expose files forces the whole
// scan back to the unbudgeted legacy path).
func (p *DeclarativeSQLiteProvider) ListFiles(ctx context.Context) ([]SessionFile, error) {
	summaries, err := p.List(ctx)
	if err != nil {
		return nil, err
	}
	files := make([]SessionFile, 0, len(summaries))
	for _, summary := range summaries {
		mtime, size := fileStatFields(p.statPath(summary.FilePath))
		files = append(files, SessionFile{
			Source: p.source,
			Path:   summary.FilePath,
			MTime:  mtime,
			Size:   size,
		})
	}
	return files, nil
}

func (p *DeclarativeSQLiteProvider) ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool) {
	if ctx.Err() != nil {
		return SessionSummary{}, false
	}
	id := p.sessionIDFromFilePath(file.Path)
	if id == "" {
		return SessionSummary{}, false
	}
	db, err := p.openDB()
	if err != nil {
		return SessionSummary{}, false
	}
	defer db.Close()

	columns := p.selectColumns()
	values, err := scanDeclarativeRow(db.QueryRowContext(ctx, p.summaryByIDQuery(columns), id), len(columns))
	if err != nil {
		return SessionSummary{}, false
	}
	summary := p.rowToSummary(values, columns)
	if summary.ID == "" {
		return SessionSummary{}, false
	}
	return summary, true
}

// LoadMessages always returns an empty list: the declarative backend parses a
// session LIST, not message bodies (Antigravity's body is an undocumented
// protobuf blob). Returning no error keeps the detail view on its existing
// empty/placeholder path instead of showing a load failure.
func (p *DeclarativeSQLiteProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return []Message{}, nil
}

// filePathForID derives the session's FilePath: the per-conversation db when it
// exists (that is the session's own file), else the summary db plus an "#<id>"
// suffix so distinct sessions never share one file path (the index keys change
// detection on it).
func (p *DeclarativeSQLiteProvider) filePathForID(id string) string {
	dbPath := strings.TrimSpace(p.cfg.DB)
	if dbPath == "" || id == "" {
		return dbPath
	}
	conversationDB := filepath.Join(filepath.Dir(dbPath), declarativeConvDir, id+".db")
	if info, err := os.Stat(conversationDB); err == nil && !info.IsDir() {
		return conversationDB
	}
	return dbPath + "#" + id
}

// statPath strips the "#<id>" suffix from a FilePath so change detection stats
// the real db file.
func (p *DeclarativeSQLiteProvider) statPath(filePath string) string {
	if idx := strings.LastIndex(filePath, "#"); idx >= 0 {
		return filePath[:idx]
	}
	return filePath
}

// sessionIDFromFilePath inverts filePathForID: "…/conversations/<id>.db" or
// "<summarydb>#<id>".
func (p *DeclarativeSQLiteProvider) sessionIDFromFilePath(filePath string) string {
	if idx := strings.LastIndex(filePath, "#"); idx >= 0 {
		return strings.TrimSpace(filePath[idx+1:])
	}
	base := filepath.Base(strings.TrimSpace(filePath))
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func (p *DeclarativeSQLiteProvider) rowToSummary(values []any, columns []declarativeSelectColumn) SessionSummary {
	var (
		id        string
		title     string
		project   string
		parentID  string
		updatedAt int64
		createdAt int64
	)
	for i, column := range columns {
		if i >= len(values) {
			break
		}
		switch column.field {
		case declarativeFieldID:
			id = declarativeCellString(values[i])
		case declarativeFieldTitle:
			title = declarativeCellString(values[i])
		case declarativeFieldUpdated:
			updatedAt = declarativeCellTime(values[i])
		case declarativeFieldCreated:
			createdAt = declarativeCellTime(values[i])
		case declarativeFieldProject:
			project = decodeWorkspaceURIs(declarativeCellString(values[i]))
		case declarativeFieldParent:
			parentID = declarativeCellString(values[i])
		}
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return SessionSummary{}
	}
	title = normalizeTitle(title)
	titleSource := "source_title"
	if title == "" {
		title = pathBase(project)
		titleSource = "project"
	}
	if title == "" {
		title = id
		titleSource = "id"
	}
	summary := SessionSummary{
		ID:          id,
		Source:      p.source,
		Title:       title,
		TitleSource: titleSource,
		ProjectPath: project,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
		FilePath:    p.filePathForID(id),
	}
	if parentID != "" && parentID != id {
		summary.Kind = SessionKindSubagent
		summary.ParentKey = StableKey(p.source, parentID, p.filePathForID(parentID))
	} else {
		summary.Kind = SessionKindSession
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary
}

// rowScanner is the shared scan surface of *sql.Rows and *sql.Row.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanDeclarativeRow(scanner rowScanner, count int) ([]any, error) {
	dest := make([]any, count)
	values := make([]any, count)
	for i := range dest {
		dest[i] = &values[i]
	}
	if err := scanner.Scan(dest...); err != nil {
		return nil, err
	}
	return values, nil
}

// quoteSQLiteIdent quotes one identifier of the fixed column mapping. The
// mapping is config-declared, so identifiers are quoted (never concatenated
// raw) — this is what keeps "column mapping" from becoming "arbitrary SQL".
func quoteSQLiteIdent(name string) string {
	name = strings.ReplaceAll(name, "\x00", "")
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func declarativeCellString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []byte:
		return string(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	default:
		return fmt.Sprintf("%v", v)
	}
}

// declarativeCellTime parses a timestamp cell into unix milliseconds. Values
// that cannot be parsed fall back to 0 (sorting is the only consumer) instead of
// failing the whole List.
func declarativeCellTime(value any) int64 {
	switch v := value.(type) {
	case nil:
		return 0
	case time.Time:
		return v.UnixMilli()
	case int64:
		return unixToMilli(v)
	case float64:
		return unixToMilli(int64(v))
	case []byte:
		return parseDeclarativeTimeString(string(v))
	case string:
		return parseDeclarativeTimeString(v)
	default:
		return 0
	}
}

func parseDeclarativeTimeString(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	for _, layout := range declarativeTimeLayouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UnixMilli()
		}
	}
	// Numeric text (a custom provider storing unix seconds/millis as TEXT).
	if numeric, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return unixToMilli(numeric)
	}
	return 0
}

// unixToMilli accepts seconds or milliseconds and always returns milliseconds.
// The 1e11 threshold puts the split far past any plausible second timestamp.
func unixToMilli(value int64) int64 {
	if value <= 0 {
		return 0
	}
	if value < 100_000_000_000 {
		return value * 1000
	}
	return value
}

// decodeWorkspaceURIs turns a workspace/URI column into one native project path.
// Antigravity stores a JSON array of file:// URIs (["file:///E:/code/snorkeling"]);
// a single URI or a plain path is accepted too. The first decodable candidate
// wins; anything undecodable yields "" so the session lands in the "Other"
// bucket rather than showing a broken path.
func decodeWorkspaceURIs(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	candidates := []string{raw}
	if strings.HasPrefix(raw, "[") {
		var items []string
		if err := json.Unmarshal([]byte(raw), &items); err != nil {
			return ""
		}
		candidates = items
	}
	for _, candidate := range candidates {
		if path := fileURIToNativePath(candidate); path != "" {
			return path
		}
	}
	return ""
}

// fileURIToNativePath decodes a file:// URI into an OS-native path. Non-URI
// values pass through only when they look like a path (a JSON/JSON-ish blob is
// not a project).
func fileURIToNativePath(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(strings.ToLower(value), "file:") {
		if strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[") || strings.HasPrefix(value, `"`) {
			return ""
		}
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	path := parsed.Path
	if path == "" && parsed.Opaque != "" {
		path = parsed.Opaque
	}
	if parsed.Host != "" && !strings.EqualFold(parsed.Host, "localhost") {
		// file://server/share → UNC share.
		path = "//" + parsed.Host + path
	}
	if path == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		// file:///E:/code/snorkeling → /E:/code/snorkeling → E:\code\snorkeling
		if len(path) >= 3 && path[0] == '/' && isDriveLetterByte(path[1]) && path[2] == ':' {
			path = path[1:]
		}
		return filepath.FromSlash(path)
	}
	return path
}
