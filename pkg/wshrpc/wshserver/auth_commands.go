// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentscope"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	defaultAgentTokenTTL = 30 * time.Minute
	maxAgentTokenTTL     = 24 * time.Hour
)

// AgentAuthGrantCommand mints a scoped token for a process outside the app.
//
// It only works from inside a block: the socket name is taken from the caller's
// own authenticated context, so the token can only point back at the app that
// issued it. Design §10.5.3 — the app signs, the caller never mints for itself.
func (ws *WshServer) AgentAuthGrantCommand(ctx context.Context, data wshrpc.AgentAuthGrantRequest) (*wshrpc.AgentAuthGrantResult, error) {
	name := strings.TrimSpace(data.Name)
	if name == "" {
		return nil, fmt.Errorf("E_USAGE: --name is required")
	}
	scopes, err := normalizeScopes(data.Scope)
	if err != nil {
		return nil, err
	}
	ttl := defaultAgentTokenTTL
	if data.TTLSeconds > 0 {
		ttl = time.Duration(data.TTLSeconds) * time.Second
	}
	if ttl > maxAgentTokenTTL {
		return nil, fmt.Errorf("E_USAGE: --ttl must be <= 24h (got %s)", ttl)
	}

	// The caller's context tells us which socket to embed.
	rpc := wshutil.GetWshRpcFromContext(ctx)
	if rpc == nil {
		return nil, fmt.Errorf("E_NO_ROUTE: no rpc context (run this inside a Snorkeling block)")
	}
	callerCtx := rpc.GetRpcContext()
	if callerCtx.SockName == "" {
		return nil, fmt.Errorf("E_NO_ROUTE: caller has no socket name")
	}

	jti := uuid.New().String()
	now := time.Now()
	routeId := fmt.Sprintf("agent:%s:%s", sanitizeRouteSegment(name), jti[:8])
	claims := &wavejwt.WaveJwtClaims{
		AgentName: name,
		Scope:     scopes,
		Sock:      callerCtx.SockName,
		RouteId:   routeId,
	}
	claims.ID = jti
	claims.IssuedAt = jwt.NewNumericDate(now)
	claims.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))

	token, err := wavejwt.Sign(claims)
	if err != nil {
		return nil, fmt.Errorf("E_INTERNAL: failed to sign token: %w", err)
	}
	return &wshrpc.AgentAuthGrantResult{
		Version:   wshrpc.AgentControlVersion,
		Name:      name,
		Token:     token,
		Socket:    callerCtx.SockName,
		RouteId:   routeId,
		Scopes:    scopes,
		ExpiresAt: now.Add(ttl).UnixMilli(),
		CreatedAt: now.UnixMilli(),
	}, nil
}

// normalizeScopes validates requested scopes. Unknown names are refused rather
// than ignored: a typo must not silently produce a token with fewer rights than
// the user asked for (or, worse, be treated as a wildcard).
func normalizeScopes(scopes []string) ([]string, error) {
	if len(scopes) == 0 {
		return []string{agentscope.Observe}, nil
	}
	out := make([]string, 0, len(scopes))
	seen := map[string]bool{}
	for _, raw := range scopes {
		for _, part := range strings.Split(raw, ",") {
			scope := strings.ToLower(strings.TrimSpace(part))
			if scope == "" {
				continue
			}
			if !agentscope.Known(scope) {
				return nil, fmt.Errorf("E_USAGE: unknown scope %q (observe|navigate|data)", scope)
			}
			if scope == agentscope.Destructive {
				// Design §10.5.9: destructive is never granted by default and is
				// not a token scope until delete operations exist.
				return nil, fmt.Errorf("E_FORBIDDEN: scope %q cannot be granted", scope)
			}
			if !seen[scope] {
				seen[scope] = true
				out = append(out, scope)
			}
		}
	}
	if len(out) == 0 {
		return []string{agentscope.Observe}, nil
	}
	return out, nil
}

func sanitizeRouteSegment(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "agent"
	}
	return out
}
