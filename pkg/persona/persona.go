// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package persona is the data foundation of the Persona system
// (design/plans/persona-system.md §3.1): on-disk layout, scaffold and roster.
//
// Invariants (design §3.6):
//   - memory is plain Markdown: people can read, grep and git it; no DB, no RPC
//   - directory name == persona id; the display name lives in persona.json
//   - CHARTER.md + MEMORY/ are the single source of truth; agents/*.md and the
//     root AGENTS.md are generated and rebuilt idempotently
//
// The package deliberately imports only the standard library so the CLI and
// (later, A2.5) the MCP tools share one write path without dragging in the app.
package persona

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// SchemaVersion tracks the shape of persona.json / persona.local.json.
const SchemaVersion = 1

// Scope is the agent-scope class of the persona write surface. A1 only ships
// the local human CLI; A2.5 registers the external (MCP/RPC) surface under
// pkg/agentscope and pkg/agentguide and must enforce this same level.
const Scope = "data"

// EnvRoot lets tests and agents override the persona root directory.
const EnvRoot = "PERSONA_ROOT"

// defaultRootDirTemplate is design §3.5 L0: ~/.snorkeling/personas/.
const defaultRootDirTemplate = "~/.snorkeling/personas"

// ErrNotFound is returned by Get/Rename when the id does not exist.
var ErrNotFound = errors.New("persona not found")

// Persona is the identity card (persona.json). The id always equals the
// directory name; only Rename (the single legal id-change path) rewrites it.
type Persona struct {
	SchemaVersion int         `json:"schemaVersion"`
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	Emoji         string      `json:"emoji,omitempty"`
	Role          string      `json:"role,omitempty"`
	Provider      string      `json:"provider,omitempty"`
	Model         string      `json:"model,omitempty"`
	CreatedAt     string      `json:"createdAt"`
	CreatedBy     *Provenance `json:"createdBy,omitempty"`
	// ApprovedBy is stamped when a human approved an agent proposal (A2.5):
	// createdBy keeps the agent identity, approvedBy records the human.
	ApprovedBy *Provenance `json:"approvedBy,omitempty"`
	Origin     *Origin     `json:"origin,omitempty"`
}

// Provenance records who created the persona (human or agent), mirroring the
// CommonText metadata pattern (design §10).
type Provenance struct {
	Kind      string `json:"kind"` // "human" | "agent"
	Name      string `json:"name,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Ts        string `json:"ts,omitempty"`
}

// Origin records the device the persona was born on (machine fields never
// leave the machine; design §3.6 identity/machine decoupling).
type Origin struct {
	DeviceID   string `json:"deviceId,omitempty"`
	DeviceName string `json:"deviceName,omitempty"`
	Platform   string `json:"platform,omitempty"`
}

// PersonaLocal is persona.local.json: machine-specific, gitignored.
type PersonaLocal struct {
	SchemaVersion int         `json:"schemaVersion"`
	Generated     string      `json:"_generated"`
	Workdir       string      `json:"workdir,omitempty"`
	Sync          *SyncConfig `json:"sync,omitempty"`
}

// SyncConfig holds the rootdir-repo escape hatch (design §3.3): a persona can
// leave the shared root repo and sync as its own repository.
type SyncConfig struct {
	Mode string `json:"mode,omitempty"` // "shared" (default) | "own"
}

// DefaultRootDir returns the expanded default persona root.
func DefaultRootDir() (string, error) {
	return expandHome(defaultRootDirTemplate)
}

// ResolveRoot resolves the persona root: explicit argument wins, then the
// PERSONA_ROOT environment variable, then the design §3.5 L0 default.
// A5.5 adds the settings entry ("persona:rootdir") between env and default.
func ResolveRoot(explicit string) (string, error) {
	if p := strings.TrimSpace(explicit); p != "" {
		return expandHome(p)
	}
	if p := strings.TrimSpace(os.Getenv(EnvRoot)); p != "" {
		return expandHome(p)
	}
	return DefaultRootDir()
}

func expandHome(pathStr string) (string, error) {
	if strings.HasPrefix(pathStr, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolving home dir: %w", err)
		}
		return filepath.Join(home, strings.TrimPrefix(pathStr, "~")), nil
	}
	return filepath.Clean(pathStr), nil
}

// Slugify derives the directory name (== id) from a display name.
// Lowercase; characters outside [a-z0-9_-] fold to '-'; edges trimmed.
// Deterministic (no randomness, so Create stays idempotent); names that
// contain non-ASCII letters get an 8-hex sha1 suffix so "备份guard" and
// "归档guard" cannot silently collapse onto the same slug.
func Slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	prevDash := false
	hasNonASCII := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_':
			b.WriteRune(r)
			prevDash = false
		default:
			if r >= 0x80 {
				hasNonASCII = true
			}
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	base := strings.Trim(b.String(), "-_")
	if base == "" {
		return "persona-" + shortHash(name)
	}
	if hasNonASCII {
		return base + "-" + shortHash(name)
	}
	return base
}

func hostPlatform() string {
	return runtime.GOOS + "/" + runtime.GOARCH
}

func shortHash(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:])[:8]
}

// personaDir is <root>/<id>. The id must already be a slug (ValidateID).
func personaDir(root, id string) string {
	return filepath.Join(root, id)
}

// ValidateID rejects ids that would escape the root or break the
// "directory name == id" invariant (no separators, no dot-walking).
func ValidateID(id string) error {
	if id == "" {
		return errors.New("persona id must not be empty")
	}
	if id != Slugify(id) {
		return fmt.Errorf("invalid persona id %q: use the slug form %q (rename is the only legal id-change path)", id, Slugify(id))
	}
	if strings.ContainsAny(id, `/\`) {
		return errors.New("persona id must not contain path separators")
	}
	return nil
}
