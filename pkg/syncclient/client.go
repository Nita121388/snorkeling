// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package syncclient talks to a snorkeling-sync server.
//
// The design goal is that every failure mode is *nameable*: the caller (CLI doctor, settings
// panel) must be able to say "unreachable", "needs a token", "protocol mismatch" instead of a
// generic "sync failed". So the entry point returns a Probe struct with per-check results
// rather than a single error.
package syncclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// Secret names for sync tokens. The secretstore name pattern is ^[A-Za-z][A-Za-z0-9_]*$, so
// colons are not allowed here even though settings keys use them.
const (
	SecretServerToken = "commontext_sync_server_token"
	SecretGitToken    = "commontext_sync_git_token"
)

// CheckState is the outcome of one probe step.
type CheckState string

const (
	CheckOK      CheckState = "ok"
	CheckFailed  CheckState = "failed"
	CheckSkipped CheckState = "skipped"
)

// Check is one diagnostic step. Every Failed check must carry a Fix: a caller should never have
// to translate a failure into an action, and an agent should not have to guess.
type Check struct {
	Id     string     `json:"id"`
	State  CheckState `json:"state"`
	Detail string     `json:"detail,omitempty"`
	Fix    string     `json:"fix,omitempty"`
}

// Probe is the full diagnostic result.
type Probe struct {
	URL   string `json:"url"`
	Ready bool   `json:"ready"`
	// Health is nil when the server was unreachable.
	Health *syncproto.Health `json:"health,omitempty"`
	Checks []Check           `json:"checks"`
}

// Client is a minimal sync server client.
type Client struct {
	BaseURL string
	Token   string
	// HTTPClient is injectable so tests can use httptest without real sockets.
	HTTPClient *http.Client
	// AllowInsecure permits http:// URLs. Plaintext is refused by default because a sync token
	// travelling in the clear is a credential leak, not a style choice.
	AllowInsecure bool
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 10 * time.Second}
}

// ValidateURL checks scheme rules without any network access.
func ValidateURL(rawURL string, allowInsecure bool) (string, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return "", errors.New("server URL is empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("URL must include a scheme and host, e.g. https://sync.example.com (got %q)", rawURL)
	}
	switch parsed.Scheme {
	case "https":
	case "http":
		if !allowInsecure {
			return "", errors.New(
				"http:// is refused because the sync token would travel in the clear; " +
					"use https:// or enable Allow insecure for a trusted LAN",
			)
		}
	default:
		return "", fmt.Errorf("unsupported scheme %q (expected https or http)", parsed.Scheme)
	}
	return strings.TrimRight(trimmed, "/"), nil
}

// Health fetches /v1/health. It never sends the token: the endpoint is unauthenticated so a
// misconfigured token cannot mask "the server is fine, your token is not".
func (c *Client) Health(ctx context.Context) (*syncproto.Health, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+syncproto.HealthPath, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("health returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var h syncproto.Health
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return nil, fmt.Errorf("health response is not valid JSON: %w", err)
	}
	return &h, nil
}

// Pull fetches items changed since sinceRev.
func (c *Client) Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error) {
	u := fmt.Sprintf("%s%s?sinceRev=%v", c.BaseURL, syncproto.SnapshotPath, sinceRev)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("server rejected the token (401) — reconfigure it with --token")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("pull returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var snap syncproto.Snapshot
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		return nil, fmt.Errorf("pull response is not valid JSON: %w", err)
	}
	return &snap, nil
}

// PushResult distinguishes "applied" from "someone else wrote first".
type PushResult struct {
	Applied bool
	// Conflicts are items the server kept its own copy of.
	Conflicts []syncproto.Conflict
	// Current is set when the push was rejected because BaseRev was stale; the caller must
	// reconcile (pull, merge, retry) instead of retrying blindly.
	Current *syncproto.Snapshot
	Rev     float64
}

func (c *Client) Push(ctx context.Context, req syncproto.PushRequest) (*PushResult, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPut, c.BaseURL+syncproto.SnapshotPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient().Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var pr syncproto.PushResponse
		if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
			return nil, fmt.Errorf("push response is not valid JSON: %w", err)
		}
		return &PushResult{Applied: true, Conflicts: pr.Conflicts, Rev: pr.Rev}, nil
	case syncproto.ConflictStatusCode:
		var payload struct {
			Current syncproto.Snapshot `json:"current"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, fmt.Errorf("409 response is not valid JSON: %w", err)
		}
		return &PushResult{Applied: false, Current: &payload.Current}, nil
	case http.StatusUnauthorized:
		return nil, errors.New("server rejected the token (401) — reconfigure it with --token")
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("push returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
}

// Diagnose runs the full check sequence. It is intentionally ordered so the first failed check
// explains why the rest were skipped.
func Diagnose(ctx context.Context, rawURL, token string, allowInsecure bool) *Probe {
	probe := &Probe{URL: rawURL}

	normalized, err := ValidateURL(rawURL, allowInsecure)
	if err != nil {
		probe.Checks = append(probe.Checks, Check{
			Id:     "url",
			State:  CheckFailed,
			Detail: err.Error(),
			Fix:    "set the server URL: wsh commontext-sync set-server https://your-host:8787",
		})
		probe.Checks = appendSkipped(probe.Checks, "reach", "auth", "protocol")
		return probe
	}
	probe.URL = normalized
	probe.Checks = append(probe.Checks, Check{Id: "url", State: CheckOK, Detail: normalized})

	client := &Client{BaseURL: normalized, Token: token, AllowInsecure: allowInsecure}
	health, err := client.Health(ctx)
	if err != nil {
		probe.Checks = append(probe.Checks, Check{
			Id:     "reach",
			State:  CheckFailed,
			Detail: describeNetworkError(err),
			Fix:    "is the server running? start it with: snorkeling-sync serve --data <dir> --port 8787",
		})
		probe.Checks = appendSkipped(probe.Checks, "auth", "protocol")
		return probe
	}
	probe.Health = health
	probe.Checks = append(probe.Checks, Check{
		Id: "reach", State: CheckOK,
		Detail: fmt.Sprintf("server is up (app %s, protocol v%d)", health.AppVersion, health.ProtocolVersion),
	})

	// Protocol before auth: an incompatible server should be reported as such even when the
	// token is also missing — fixing the token would not make syncing work.
	if err := syncproto.CheckHealth(health); err != nil {
		probe.Checks = append(probe.Checks, Check{
			Id: "protocol", State: CheckFailed, Detail: err.Error(),
			Fix: "upgrade the older side: the server reports protocol v" + fmt.Sprint(health.ProtocolVersion),
		})
		probe.Checks = appendSkipped(probe.Checks, "auth")
		return probe
	}
	probe.Checks = append(probe.Checks, Check{
		Id: "protocol", State: CheckOK,
		Detail: fmt.Sprintf("protocol v%d matches this build", health.ProtocolVersion),
	})

	if !health.RequiresAuth {
		probe.Checks = append(probe.Checks, Check{Id: "auth", State: CheckOK, Detail: "server does not require a token"})
		probe.Ready = true
		return probe
	}
	if strings.TrimSpace(token) == "" {
		probe.Checks = append(probe.Checks, Check{
			Id: "auth", State: CheckFailed, Detail: "server requires a token but none is configured",
			Fix: "configure one: wsh commontext-sync set-server " + normalized + " --token <token>",
		})
		return probe
	}
	// Verify the token with a cheap authenticated read rather than trusting its presence.
	if _, err := client.Pull(ctx, health.Rev); err != nil {
		detail := err.Error()
		fix := "reconfigure the token: wsh commontext-sync set-server " + normalized + " --token <token>"
		if strings.Contains(detail, "401") {
			detail = "server rejected the token (401)"
		}
		probe.Checks = append(probe.Checks, Check{Id: "auth", State: CheckFailed, Detail: detail, Fix: fix})
		return probe
	}
	probe.Checks = append(probe.Checks, Check{Id: "auth", State: CheckOK, Detail: "token accepted"})
	probe.Ready = true
	return probe
}

func appendSkipped(checks []Check, ids ...string) []Check {
	for _, id := range ids {
		checks = append(checks, Check{Id: id, State: CheckSkipped, Detail: "skipped (earlier check failed)"})
	}
	return checks
}

// describeNetworkError turns transport errors into the sentence a user can act on.
func describeNetworkError(err error) string {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "connection timed out — wrong host/port, or a firewall is dropping packets"
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "connection refused"):
		return "connection refused — nothing is listening on that host/port"
	case strings.Contains(msg, "no such host"):
		return "host not found — check the hostname or DNS"
	case strings.Contains(msg, "certificate"):
		return "TLS certificate rejected — use a valid certificate, or Allow insecure for a self-signed LAN server"
	}
	return msg
}
