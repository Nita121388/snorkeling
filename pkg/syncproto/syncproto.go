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
	BaseRev    float64        `json:"baseRev"`
	Items      []SnapshotItem `json:"items"`
	DeviceId   string         `json:"deviceId"`
	DeviceName string         `json:"deviceName"`
}

// PushResponse is returned by a successful PUT /v1/snapshot.
type PushResponse struct {
	Rev       float64    `json:"rev"`
	Applied   int        `json:"applied"`
	Conflicts []Conflict `json:"conflicts,omitempty"`
}

// Conflict describes one item the server refused to overwrite because both sides changed it.
type Conflict struct {
	Id     string `json:"id"`
	Reason string `json:"reason"`
}

// ErrConflictCode is the HTTP status a server uses when BaseRev does not match its head.
const ConflictStatusCode = 409
