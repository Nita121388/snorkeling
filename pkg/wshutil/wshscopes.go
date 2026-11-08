// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// Link scopes are the scopes a connection proved at authenticate time. They are
// keyed by ingress link id rather than by anything the client sends, so a client
// cannot widen its own permissions by declaring scopes in a request context.
var (
	linkScopeLock sync.RWMutex
	linkScopes    = map[baseds.LinkId][]string{}
)

// SetLinkScopes records what a link was granted. An empty/nil slice means
// app-level (in-app token), which is not scope-limited.
func SetLinkScopes(linkId baseds.LinkId, scopes []string) {
	linkScopeLock.Lock()
	defer linkScopeLock.Unlock()
	if len(scopes) == 0 {
		delete(linkScopes, linkId)
		return
	}
	copied := make([]string, len(scopes))
	copy(copied, scopes)
	linkScopes[linkId] = copied
}

// GetLinkScopes returns the scopes granted to a link (nil = app-level).
func GetLinkScopes(linkId baseds.LinkId) []string {
	linkScopeLock.RLock()
	defer linkScopeLock.RUnlock()
	return linkScopes[linkId]
}

// ClearLinkScopes drops the grant when a link goes away.
func ClearLinkScopes(linkId baseds.LinkId) {
	linkScopeLock.Lock()
	defer linkScopeLock.Unlock()
	delete(linkScopes, linkId)
}
