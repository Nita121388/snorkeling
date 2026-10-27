// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Annotation rules — the single implementation of "which annotation may be
// replaced by an AI regeneration pass", plus the pure anchor helpers (hash and
// drift re-anchoring).
//
// Everything that can overwrite annotations must call CanReplace instead of
// re-deriving the rule. The subtle case is source="ai" AND user_edited=true
// ("AI drafted, human edited"), which is protected even though the source is AI.

package aisessions

import (
	"fmt"
	"hash/fnv"
	"math"
	"strings"
)

// AnnotationRow mirrors one row of ai_session_annotations. It is the storage
// shape; AnnotationView is the RPC shape (adds Orphaned).
type AnnotationRow struct {
	ID            int64    `db:"id"`
	SessionKey    string   `db:"session_key"`
	AnchorKey     string   `db:"anchor_key"`
	Seq           int      `db:"seq"`
	Kind          string   `db:"kind"`
	Title         string   `db:"title"`
	Body          string   `db:"body"`
	Tags          []string `db:"-"`
	TagsJSON      string   `db:"tags_json"`
	Status        string   `db:"status"`
	Source        string   `db:"source"`
	UserEdited    bool     `db:"user_edited"`
	AIModel       string   `db:"ai_model"`
	AnchorHash    string   `db:"anchor_hash"`
	AnchorPreview string   `db:"anchor_preview"`
	NodeText      string   `db:"node_text"`
	CreatedAt     int64    `db:"created_at"`
	UpdatedAt     int64    `db:"updated_at"`
}

// CanReplace reports whether an AI regeneration pass may replace this row.
//
// Invariant (locked by the 8-combination unit test):
//
//	replaceable := status='draft' OR (source='ai' AND user_edited=0)
//	never       := source='user' OR user_edited=1
func CanReplace(row AnnotationRow) bool {
	if row.Source == AnnotationSourceUser || row.UserEdited {
		return false
	}
	return row.Status == AnnotationStatusDraft || row.Source == AnnotationSourceAI
}

// AnchorHash returns a stable FNV-1a 64-bit hash of the normalized node text as
// a decimal string. Whitespace-only differences do not change the value.
func AnchorHash(text string) string {
	normalized := strings.Join(strings.Fields(text), " ")
	if normalized == "" {
		return "0"
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(normalized))
	return fmt.Sprintf("%d", h.Sum64())
}

// AnchorPoint is the resolved position of one existing annotation on the
// current message list.
type AnchorPoint struct {
	AnchorKey string
	Seq       int
	Role      string
	Hash      string
}

// PickReanchor finds the best replacement anchor for an annotation whose
// anchor_key no longer exists. Candidates are limited to the same role and
// seq±3; an exact hash match wins, otherwise the nearest seq is used.
//
// Returns false when no candidate is close enough: the caller must mark the
// annotation orphaned and keep the data.
func PickReanchor(anchors []AnchorPoint, want AnchorPoint) (AnchorPoint, bool) {
	var exact *AnchorPoint
	var nearest *AnchorPoint
	nearestDistance := math.MaxInt
	for i := range anchors {
		candidate := anchors[i]
		if candidate.AnchorKey == want.AnchorKey {
			return candidate, true
		}
		if want.Role != "" && candidate.Role != want.Role {
			continue
		}
		distance := candidate.Seq - want.Seq
		if distance < 0 {
			distance = -distance
		}
		if distance > 3 {
			continue
		}
		if want.Hash != "" && candidate.Hash == want.Hash {
			if exact == nil || distance < absSeq(exact.Seq-want.Seq) {
				exact = &candidate
			}
			continue
		}
		if distance < nearestDistance {
			nearestDistance = distance
			nearest = &candidate
		}
	}
	if exact != nil {
		return *exact, true
	}
	if nearest != nil {
		return *nearest, true
	}
	return AnchorPoint{}, false
}

func absSeq(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// ToView converts the storage row into the RPC view. Orphaned is computed by
// the caller against the live message anchors.
func (row AnnotationRow) ToView(orphaned bool) AnnotationView {
	return row.view(orphaned)
}
