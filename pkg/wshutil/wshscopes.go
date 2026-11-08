// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// Grant is what a connection proved at authenticate time. It lives here rather
// than in the request context because the request context is supplied by the
// client: identity and permissions must come from the verified token.
type Grant struct {
	Scopes    []string
	AgentName string
	Jti       string
}

var (
	linkScopeLock sync.RWMutex
	linkGrants    = map[baseds.LinkId]Grant{}
)

// SetLinkGrant records what a link was granted. An empty grant means app-level
// (in-app token), which is not scope-limited.
func SetLinkGrant(linkId baseds.LinkId, grant Grant) {
	linkScopeLock.Lock()
	defer linkScopeLock.Unlock()
	if len(grant.Scopes) == 0 && grant.AgentName == "" && grant.Jti == "" {
		delete(linkGrants, linkId)
		return
	}
	copied := Grant{AgentName: grant.AgentName, Jti: grant.Jti}
	copied.Scopes = append([]string(nil), grant.Scopes...)
	linkGrants[linkId] = copied
}

// GetLinkGrant returns the grant bound to a link (zero value = app-level).
func GetLinkGrant(linkId baseds.LinkId) Grant {
	linkScopeLock.RLock()
	defer linkScopeLock.RUnlock()
	return linkGrants[linkId]
}

// GetLinkScopes is the scope-only view, kept for callers that only need that.
func GetLinkScopes(linkId baseds.LinkId) []string {
	return GetLinkGrant(linkId).Scopes
}

// ClearLinkGrant drops the grant when a link goes away.
func ClearLinkGrant(linkId baseds.LinkId) {
	linkScopeLock.Lock()
	defer linkScopeLock.Unlock()
	delete(linkGrants, linkId)
}
