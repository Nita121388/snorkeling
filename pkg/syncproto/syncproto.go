// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package syncproto is the wire contract between a Snorkeling client and a sync server.
//
// It is a separate package on purpose: the server binary, the desktop client and the journal
// reader all need to agree on these shapes, and keeping them in one small package means a
// wire change cannot land in only one of them.
//
// Two version numbers, deliberately not one:
//
//   - ProtocolVersion is the wire/data format contract. A mismatch means the two sides cannot
//     understand each other and syncing MUST refuse — writing anyway would corrupt data.
//   - AppVersion is just the release a build came from. A mismatch is informational; a newer
//     patch release is not a reason to stop syncing.
//
// Collapsing these into a single "version" is the classic bug: it either blocks compatible
// pairs or lets incompatible ones write garbage.
package syncproto

import "fmt"

// ProtocolVersion is bumped only when the wire format changes incompatibly.
const ProtocolVersion = 1

// ServiceName identifies our server so a wrong URL fails with a clear message instead of a
// JSON decode error.
const ServiceName = "snorkeling-sync"

// HealthPath is unauthenticated on purpose. Probing must work before a token is configured,
// otherwise "tell me what's wrong with my server" is impossible for the exact case where the
// user has not configured a token yet.
const HealthPath = "/v1/health"

// SnapshotPath is the pull/push endpoint.
const SnapshotPath = "/v1/snapshot"

// Capability names advertised by a server.
const (
	CapSnapshot    = "snapshot"    // full snapshot pull
	CapIncremental = "incremental" // pull since a revision
	CapWebSocket   = "websocket"   // realtime push instead of polling
)

// Health is the response of GET /v1/health.
type Health struct {
	Service string `json:"service"`
	// ProtocolVersion is the hard compatibility gate (see the package doc).
	ProtocolVersion int `json:"protocolVersion"`
	// AppVersion is the server build's release version; informational only.
	AppVersion string `json:"appVersion"`
	// Items / Rev let the client show "server has N items at rev R" before authenticating.
	Items float64 `json:"items"`
	Rev   float64 `json:"rev"`
	// RequiresAuth tells the client whether a token is needed, so the UI can say
	// "reachable, needs a token" instead of a generic failure.
	RequiresAuth bool     `json:"requiresAuth"`
	Capabilities []string `json:"capabilities,omitempty"`
}

// Compatible reports whether this client can talk to a server advertising the given protocol
// version. Only an exact match is accepted: a newer protocol may carry fields this client would
// silently drop, and a silent drop is worse than a refusal.
func Compatible(serverProtocolVersion int) bool {
	return serverProtocolVersion == ProtocolVersion
}

// CheckHealth validates that a health response really came from a sync server and that we can
// talk to it. It returns a human-readable reason on failure — every caller surfaces that reason
// directly to the user, so it must read like a sentence.
func CheckHealth(h *Health) error {
	if h == nil {
		return fmt.Errorf("server returned an empty health response")
	}
	if h.Service != ServiceName {
		if h.Service == "" {
			return fmt.Errorf("not a %s server (no service field in %s)", ServiceName, HealthPath)
		}
		return fmt.Errorf("wrong service: expected %q, got %q", ServiceName, h.Service)
	}
	if !Compatible(h.ProtocolVersion) {
		return fmt.Errorf(
			"protocol mismatch: server speaks v%d, this build speaks v%d — upgrade whichever side is older",
			h.ProtocolVersion, ProtocolVersion,
		)
	}
	return nil
}

// Snapshot is the sync payload. It is self-contained so a single file (folder transport) and a
// single HTTP body (server transport) can both carry it.
type Snapshot struct {
	// DeviceId / DeviceName identify the writer, so the other side can show provenance.
	DeviceId   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	// Rev is the highest item revision contained in this snapshot.
	Rev float64 `json:"rev"`
	// Items carry their own rev/deletedat; deleted items stay as tombstones.
	Items []SnapshotItem `json:"items"`
}

// SnapshotItem is one Common Text item on the wire. It mirrors wconfig.CommonTextItemType but is
// defined here so the server binary does not depend on the desktop settings package.
type SnapshotItem struct {
	Id         string   `json:"id"`
	Title      string   `json:"title,omitempty"`
	Text       string   `json:"text,omitempty"`
	Shortcut   string   `json:"shortcut,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	Pinned     bool     `json:"pinned,omitempty"`
	CreatedAt  float64  `json:"createdat,omitempty"`
	UpdatedAt  float64  `json:"updatedat,omitempty"`
	LastUsedAt float64  `json:"lastusedat,omitempty"`
	UsageCount float64  `json:"usagecount,omitempty"`
	Emoji      string   `json:"emoji,omitempty"`
	CreatedBy  *Author  `json:"createdby,omitempty"`
	Origin     *Origin  `json:"origin,omitempty"`
	Rev        float64  `json:"rev,omitempty"`
	// DeletedAt is a tombstone timestamp; zero means alive.
	DeletedAt float64 `json:"deletedat,omitempty"`
}

type Author struct {
	Kind string `json:"kind,omitempty"`
	Name string `json:"name,omitempty"`
}

type Origin struct {
	DeviceId   string `json:"deviceid,omitempty"`
	DeviceName string `json:"devicename,omitempty"`
	Platform   string `json:"platform,omitempty"`
}

// PullRequest is the query for GET /v1/snapshot.
type PullRequest struct {
	// SinceRev returns only items with Rev > SinceRev. Zero means "everything".
	SinceRev float64 `json:"sinceRev"`
}

// PushRequest is the body of PUT /v1/snapshot.
type PushRequest struct {
	// BaseRev is the revision the client last saw. The server compares it with its own head:
	// a mismatch means someone else wrote in between, and the server answers 409 with the
	// current snapshot instead of silently overwriting.
	BaseRev float64        `json:"baseRev"`
	Items   []SnapshotItem `json:"items"`
	// Base carries, per item id, the version the client last synced. Three-way merge needs it to
	// tell "only local changed" from "only remote changed"; without it every difference looks
	// like a conflict. An item with no base entry falls back to conservative behaviour: differing
	// content is reported as a conflict rather than silently overwritten.
	Base       []SnapshotItem `json:"base,omitempty"`
	DeviceId   string         `json:"deviceId"`
	DeviceName string         `json:"deviceName"`
}

// PushResponse is returned by a successful PUT /v1/snapshot.
type PushResponse struct {
	Rev       float64    `json:"rev"`
	Applied   int        `json:"applied"`
	Unchanged int        `json:"unchanged,omitempty"`
	Conflicts []Conflict `json:"conflicts,omitempty"`
	// Items reports the per-item outcome. Counters alone cannot answer "which item did not make
	// it", and the client needs the confirmed revision per item to record its sync watermark.
	Items []PushItemResult `json:"items,omitempty"`
}

// Per-item push outcomes. Strings (not a Go enum type) so an older reader can degrade gracefully
// on a value a newer build writes.
const (
	PushStatusApplied   = "applied"
	PushStatusUnchanged = "unchanged"
	PushStatusConflict  = "conflict"
)

// PushItemResult is one item's fate in a push. Rev is the remote revision the item ended up at
// (zero for conflicts, where the remote kept its own version).
type PushItemResult struct {
	Id     string  `json:"id"`
	Rev    float64 `json:"rev,omitempty"`
	Status string  `json:"status"`
}

// Conflict describes one item where both sides changed the same field, so the server refused to
// pick a winner. It carries BOTH versions: without them the user (or an agent) only sees "there is
// a conflict" with no way to resolve it, and "copy this conflict for an AI to merge" is impossible.
type Conflict struct {
	Id string `json:"id"`
	// Fields lists the field names that actually conflict (text / title / tags / shortcut).
	// A conflict where only one side changed a field must not be reported at all — those merge
	// automatically, and reporting them would train the user to ignore the list.
	Fields []string `json:"fields,omitempty"`
	// Local is the version the pushing client had; Remote is the version the server kept.
	Local  *SnapshotItem `json:"local,omitempty"`
	Remote *SnapshotItem `json:"remote,omitempty"`
	// Reason is a human-readable one-liner for the UI list.
	Reason string `json:"reason,omitempty"`
}

// ConflictField names. Kept as constants so the server and the UI agree on the spelling.
const (
	ConflictFieldText     = "text"
	ConflictFieldTitle    = "title"
	ConflictFieldTags     = "tags"
	ConflictFieldShortcut = "shortcut"
)

// DetectConflictFields returns the fields both sides changed relative to a common base.
//
// This is a true three-way comparison, which is the only thing that can answer "who changed
// this field?". A two-way comparison cannot: given local != remote you cannot tell whether only
// local changed or only remote did, so every edit would look like a conflict and the list would be
// useless.
//
// A field conflicts only when BOTH sides diverge from the base AND from each other. When they
// diverge but agree (both typed the same text), it is not a conflict. When only one side diverged,
// that side wins silently — that is the whole point of row-merge.
func DetectConflictFields(base, local, remote *SnapshotItem) []string {
	if local == nil || remote == nil {
		return nil
	}
	var fields []string
	if fieldConflicts(baseValue(base, ConflictFieldText), local.Text, remote.Text) {
		fields = append(fields, ConflictFieldText)
	}
	if fieldConflicts(baseValue(base, ConflictFieldTitle), local.Title, remote.Title) {
		fields = append(fields, ConflictFieldTitle)
	}
	if fieldConflicts(baseValue(base, ConflictFieldTags), JoinTags(local.Tags), JoinTags(remote.Tags)) {
		fields = append(fields, ConflictFieldTags)
	}
	if fieldConflicts(baseValue(base, ConflictFieldShortcut), local.Shortcut, remote.Shortcut) {
		fields = append(fields, ConflictFieldShortcut)
	}
	return fields
}

// fieldConflicts is the three-way rule for one field. `base` is the value the client last synced.
func fieldConflicts(base, local, remote string) bool {
	if local == remote {
		// Both sides agree, so there is nothing to resolve even if both edited.
		return false
	}
	// Exactly one side diverged from the base → that side wins, no conflict to report.
	if local == base {
		return false
	}
	if remote == base {
		return false
	}
	// Both diverged and they disagree: a real conflict.
	return true
}

func baseValue(base *SnapshotItem, field string) string {
	if base == nil {
		return ""
	}
	switch field {
	case ConflictFieldText:
		return base.Text
	case ConflictFieldTitle:
		return base.Title
	case ConflictFieldTags:
		return JoinTags(base.Tags)
	case ConflictFieldShortcut:
		return base.Shortcut
	}
	return ""
}

// JoinTags normalizes tags to one comparable string (a fresh slice would make == useless).
// Exported because the server needs it for its own field-level comparison.
func JoinTags(tags []string) string {
	if len(tags) == 0 {
		return ""
	}
	out := tags[0]
	for _, t := range tags[1:] {
		out += "\n" + t
	}
	return out
}

// ErrConflictCode is the HTTP status a server uses when BaseRev does not match its head.
const ConflictStatusCode = 409

// SplitTags is the inverse of JoinTags. It exists so a caller that received a joined
// representation can get the slice back without re-implementing the separator.
func SplitTags(raw string) []string {
	if raw == "" {
		return nil
	}
	out := make([]string, 0, 4)
	start := 0
	for i := 0; i <= len(raw); i++ {
		if i == len(raw) || raw[i] == '\n' {
			if i > start {
				out = append(out, raw[start:i])
			}
			start = i + 1
		}
	}
	return out
}
