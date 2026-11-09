// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentaccess"
	"github.com/wavetermdev/waveterm/pkg/agentmcphost"
	"github.com/wavetermdev/waveterm/pkg/agentscope"
	"github.com/wavetermdev/waveterm/pkg/agentskill"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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

	// The socket to embed is the *server's* own socket, not anything the caller
	// declares: SockName is a client-side dial hint and is not populated on the
	// server's link context. Taking it from the caller would also let a caller
	// point the token at a different app.
	if err := requireInApp(ctx); err != nil {
		return nil, err
	}
	if wshutil.GetWshRpcFromContext(ctx) == nil {
		return nil, fmt.Errorf("E_NO_ROUTE: no rpc context (run this inside a Snorkeling block)")
	}
	sockName := wavebase.GetMainRpcSocketName()
	if sockName == "" {
		return nil, fmt.Errorf("E_NO_ROUTE: the app has no socket name")
	}

	jti := uuid.New().String()
	now := time.Now()
	routeId := fmt.Sprintf("agent:%s:%s", sanitizeRouteSegment(name), jti[:8])
	claims := &wavejwt.WaveJwtClaims{
		AgentName: name,
		Scope:     scopes,
		Sock:      sockName,
		RouteId:   routeId,
	}
	claims.ID = jti
	claims.IssuedAt = jwt.NewNumericDate(now)
	claims.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))

	token, err := wavejwt.Sign(claims)
	if err != nil {
		return nil, fmt.Errorf("E_INTERNAL: failed to sign token: %w", err)
	}
	// Record the grant so it can be listed and revoked. The token itself is
	// never written anywhere but the caller's file.
	if err := agentaccess.Record(agentaccess.Entry{
		Jti:       jti,
		Name:      name,
		Scopes:    scopes,
		RouteId:   routeId,
		CreatedAt: now.UnixMilli(),
		ExpiresAt: now.Add(ttl).UnixMilli(),
	}); err != nil {
		return nil, fmt.Errorf("E_INTERNAL: failed to record grant: %w", err)
	}
	rtn := &wshrpc.AgentAuthGrantResult{
		Version:   wshrpc.AgentControlVersion,
		Name:      name,
		Token:     token,
		Socket:    sockName,
		RouteId:   routeId,
		Scopes:    scopes,
		ExpiresAt: now.Add(ttl).UnixMilli(),
		CreatedAt: now.UnixMilli(),
	}
	// Write the file here when asked, so the 0600 rule lives in exactly one
	// place (agentaccess.WriteTokenFile) for both the CLI and the panel.
	if out := strings.TrimSpace(data.Out); out != "" {
		writtenPath, writeErr := agentaccess.WriteTokenFile(out, agentaccess.TokenFile{
			Version:   wshrpc.AgentControlVersion,
			Name:      name,
			Token:     token,
			Socket:    sockName,
			Scopes:    scopes,
			ExpiresAt: rtn.ExpiresAt,
			CreatedAt: rtn.CreatedAt,
		})
		if writeErr != nil {
			// The grant is recorded and live; only the file failed. Say so
			// instead of pretending the grant did not happen.
			return nil, fmt.Errorf("%w (the grant is still valid: pass --out to a writable path)", writeErr)
		}
		rtn.OutPath = writtenPath
	}
	return rtn, nil
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

// callerIsAgent reports whether this request arrived on a link authenticated
// with an external agent token.
//
// The grant is bound to the connection at authenticate time, so this is a
// server-side fact; a client cannot make itself look non-agent. An in-app
// client (the renderer, or wsh inside a block) has no grant.
func callerIsAgent(ctx context.Context) bool {
	handler := wshutil.GetRpcResponseHandlerFromContext(ctx)
	if handler == nil {
		return false
	}
	return wshutil.GetLinkGrant(handler.GetIngressLinkId()).Jti != ""
}

// requireInApp refuses scoped agent tokens. Issuing or revoking credentials is
// not something an agent may do on another agent's behalf: that is privilege
// escalation by definition.
func requireInApp(ctx context.Context) error {
	if callerIsAgent(ctx) {
		return fmt.Errorf("E_FORBIDDEN: agent tokens cannot manage credentials; run this inside the app")
	}
	return nil
}

// AgentAuthListCommand lists granted tokens for the Agent Access panel.
func (ws *WshServer) AgentAuthListCommand(ctx context.Context) (*wshrpc.AgentAuthListResult, error) {
	if err := requireInApp(ctx); err != nil {
		return nil, err
	}
	entries, err := agentaccess.List()
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	rtn := &wshrpc.AgentAuthListResult{
		Version: wshrpc.AgentControlVersion,
		Path:    agentaccess.RegistryPath(),
		Tokens:  make([]wshrpc.AgentAuthTokenInfo, 0, len(entries)),
	}
	for _, e := range entries {
		rtn.Tokens = append(rtn.Tokens, wshrpc.AgentAuthTokenInfo{
			Name:      e.Name,
			JtiPrefix: agentaccess.Describe(e.Jti),
			Scopes:    e.Scopes,
			CreatedAt: e.CreatedAt,
			ExpiresAt: e.ExpiresAt,
			Expired:   e.Expired(now),
			Revoked:   e.Revoked(),
		})
	}
	return rtn, nil
}

// AgentAuthRevokeCommand revokes by name, by jti prefix, or everything. The
// caller is expected to confirm with the user first; this function does not ask.
func (ws *WshServer) AgentAuthRevokeCommand(ctx context.Context, data wshrpc.AgentAuthRevokeRequest) (*wshrpc.AgentAuthRevokeResult, error) {
	if err := requireInApp(ctx); err != nil {
		return nil, err
	}
	var (
		n   int
		err error
	)
	switch {
	case data.All:
		n, err = agentaccess.RevokeAll()
	case strings.TrimSpace(data.Jti) != "":
		var jti string
		jti, err = agentaccess.LookupJti(data.Jti)
		if err != nil {
			return nil, err
		}
		n, err = agentaccess.RevokeByJti(jti)
	case strings.TrimSpace(data.Name) != "":
		n, err = agentaccess.RevokeByName(strings.TrimSpace(data.Name))
	default:
		return nil, fmt.Errorf("E_USAGE: pass name, jti, or all")
	}
	if err != nil {
		return nil, err
	}
	return &wshrpc.AgentAuthRevokeResult{Revoked: n}, nil
}

// AgentSkillInstallCommand writes the bundled skill into the agent skill
// directories that exist on this machine.
func (ws *WshServer) AgentSkillInstallCommand(ctx context.Context) (*wshrpc.AgentSkillInstallResult, error) {
	if err := requireInApp(ctx); err != nil {
		return nil, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.AgentSkillInstallResult{Skill: agentskill.SkillName}
	for _, root := range agentskill.DefaultRoots(home) {
		if _, statErr := os.Stat(filepath.Dir(root)); statErr != nil {
			// Do not create ~/.claude for someone who never used Claude Code.
			rtn.Skipped = append(rtn.Skipped, root)
			continue
		}
		if _, err := agentskill.Install(root); err != nil {
			return nil, fmt.Errorf("E_INTERNAL: install into %s: %w", root, err)
		}
		rtn.Installed = append(rtn.Installed, filepath.Join(root, agentskill.SkillName))
	}
	return rtn, nil
}

// AgentMCPConfigCommand returns the host config snippet for `wsh mcp serve`.
func (ws *WshServer) AgentMCPConfigCommand(ctx context.Context, host string) (*wshrpc.AgentMCPConfigResult, error) {
	if err := requireInApp(ctx); err != nil {
		return nil, err
	}
	cfg, err := agentmcphost.Config(host)
	if err != nil {
		return nil, err
	}
	return &wshrpc.AgentMCPConfigResult{Config: cfg}, nil
}
