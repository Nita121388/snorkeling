// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

func newTestServer(t *testing.T) (*Server, *Tokens, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "sync.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	tokens, err := LoadTokens(dir)
	if err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	tok, err := tokens.Generate()
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return &Server{store: store, tokens: tokens}, tokens, tok
}

func muxFor(s *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(syncproto.HealthPath, s.handleHealth)
	mux.HandleFunc(syncproto.SnapshotPath, s.requireAuth(s.handleSnapshot))
	return mux
}

func TestHealthIsUnauthenticatedAndReportsProtocol(t *testing.T) {
	srv, _, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	muxFor(srv).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, syncproto.HealthPath, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("health must be reachable without a token, got %d", rec.Code)
	}
	var h syncproto.Health
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h.Service != syncproto.ServiceName || h.ProtocolVersion != syncproto.ProtocolVersion {
		t.Fatalf("unexpected health: %+v", h)
	}
	// The client uses this to say "reachable, needs a token" instead of a generic failure.
	if !h.RequiresAuth {
		t.Fatal("health must advertise that a token is required")
	}
}

func TestSnapshotRequiresToken(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath, nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token must be 401, got %d", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath, nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad token must be 401, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token must be 200, got %d", rec.Code)
	}
}

func push(t *testing.T, handler http.Handler, tok string, req syncproto.PushRequest) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPut, syncproto.SnapshotPath, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, r)
	return rec
}

func TestPushThenPullRoundTrip(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items: []syncproto.SnapshotItem{
			{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push failed: %d %s", rec.Code, rec.Body.String())
	}

	r := httptest.NewRequest(http.MethodGet, syncproto.SnapshotPath+"?sinceRev=0", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, r)
	var snap syncproto.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if len(snap.Items) != 1 || snap.Items[0].Id != "a" {
		t.Fatalf("expected the pushed item, got %+v", snap.Items)
	}
	if snap.Rev < 1 {
		t.Fatalf("head rev must advance, got %v", snap.Rev)
	}
}

func TestStaleBaseRevIsRejectedWithCurrentSnapshot(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})

	// Reuse baseRev 0: the server head moved on, so this batch must not be applied.
	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "b", Title: "B", Text: "b", UpdatedAt: 2000, Rev: 2}},
	})
	if rec.Code != syncproto.ConflictStatusCode {
		t.Fatalf("stale baseRev must be 409, got %d", rec.Code)
	}
	var body struct {
		Current syncproto.Snapshot `json:"current"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode 409 body: %v", err)
	}
	// The client needs the current snapshot to reconcile without a second round trip.
	if len(body.Current.Items) != 1 || body.Current.Items[0].Id != "a" {
		t.Fatalf("409 must carry the current snapshot, got %+v", body.Current.Items)
	}
}

// First sync of an item that exists on both sides has no common ancestor, so field-level
// attribution is impossible. The server falls back to whole-item updatedat instead of reporting
// every difference as a conflict — otherwise day-one syncing would bury the user in noise.
func TestFirstSyncWithoutBaseUsesUpdatedAt(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "old", Text: "old", UpdatedAt: 2000, Rev: 1}},
	})
	head := srv.store.mustHeadRev(t)

	// No Base provided → newer updatedat wins outright, no conflict reported.
	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "new", Text: "new", UpdatedAt: 3000, Rev: 2}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push must succeed, got %d", rec.Code)
	}
	var resp syncproto.PushResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Conflicts) != 0 {
		t.Fatalf("first sync must not report conflicts, got %+v", resp.Conflicts)
	}
	snap, err := srv.store.SnapshotSince(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap.Items[0].Title != "new" {
		t.Fatalf("newer item must win, got %q", snap.Items[0].Title)
	}
}

// With a base, only fields BOTH sides changed differently conflict. This is the case that decides
// whether a real user ever sees a conflict dialog.
func TestThreeWayMergeOnlyConflictsOnSameField(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	base := syncproto.SnapshotItem{Id: "a", Title: "Orig", Text: "orig", UpdatedAt: 1000, Rev: 1}
	push(t, handler, tok, syncproto.PushRequest{BaseRev: 0, Items: []syncproto.SnapshotItem{base}})
	head := srv.store.mustHeadRev(t)

	// Local edited the body only; the server copy (base) is unchanged → merges silently.
	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Base:    []syncproto.SnapshotItem{base},
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "Orig", Text: "local edit", UpdatedAt: 2000, Rev: 2}},
	})
	var resp syncproto.PushResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Conflicts) != 0 {
		t.Fatalf("one-sided edit must merge, got %+v", resp.Conflicts)
	}

	// Now the server side also diverges on the SAME field → real conflict with both versions.
	head = srv.store.mustHeadRev(t)
	serverSide := syncproto.SnapshotItem{Id: "a", Title: "Orig", Text: "server edit", UpdatedAt: 2500, Rev: 3}
	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Base:    []syncproto.SnapshotItem{{Id: "a", Title: "Orig", Text: "local edit", UpdatedAt: 2000, Rev: 2}},
		Items:   []syncproto.SnapshotItem{serverSide},
	})
	head = srv.store.mustHeadRev(t)

	rec = push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Base:    []syncproto.SnapshotItem{{Id: "a", Title: "Orig", Text: "local edit", UpdatedAt: 2000, Rev: 2}},
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "Orig", Text: "local edit v2", UpdatedAt: 3000, Rev: 4}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("a conflict is reported, not fatal: got %d", rec.Code)
	}
	resp = syncproto.PushResponse{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Conflicts) != 1 {
		t.Fatalf("expected one conflict, got %+v", resp.Conflicts)
	}
	c := resp.Conflicts[0]
	if c.Id != "a" || len(c.Fields) != 1 || c.Fields[0] != syncproto.ConflictFieldText {
		t.Fatalf("conflict must name the field: %+v", c)
	}
	// Both versions must come back, otherwise the conflict cannot be resolved or handed to an AI.
	if c.Local == nil || c.Remote == nil {
		t.Fatalf("conflict must carry both versions: %+v", c)
	}
	if c.Local.Text != "local edit v2" || c.Remote.Text != "server edit" {
		t.Fatalf("unexpected versions: local=%q remote=%q", c.Local.Text, c.Remote.Text)
	}
}

func TestNewerItemWinsAndOlderItemConflicts(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "old", Text: "old", UpdatedAt: 2000, Rev: 1}},
	})
	head := srv.store.mustHeadRev(t)

	// Newer updatedat: overwrite.
	rec := push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "new", Text: "new", UpdatedAt: 3000, Rev: 2}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("newer push must succeed, got %d", rec.Code)
	}
	snap, err := srv.store.SnapshotSince(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap.Items[0].Title != "new" {
		t.Fatalf("newer item must win, got %q", snap.Items[0].Title)
	}

	// A stale push without a base is not a conflict any more: with no common ancestor the server
	// cannot attribute the change, so it keeps its newer copy and reports nothing. (Real conflicts
	// require a base; see TestThreeWayMergeOnlyConflictsOnSameField.)
	head = srv.store.mustHeadRev(t)
	rec = push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "stale", Text: "stale", UpdatedAt: 500, Rev: 3}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push must be accepted, got %d", rec.Code)
	}
	var resp syncproto.PushResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Conflicts) != 0 {
		t.Fatalf("no-base staleness is not a conflict, got %+v", resp.Conflicts)
	}
	if resp.Unchanged != 1 {
		t.Fatalf("expected the stale item to count as unchanged, got %+v", resp)
	}
	snap, _ = srv.store.SnapshotSince(0)
	if snap.Items[0].Title != "new" {
		t.Fatalf("stale push must not overwrite, got %q", snap.Items[0].Title)
	}
}

func TestTombstoneIsNotResurrected(t *testing.T) {
	srv, _, tok := newTestServer(t)
	handler := muxFor(srv)

	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})
	head := srv.store.mustHeadRev(t)

	// Delete with a higher rev: the tombstone must stick even though it is "older" by updatedat.
	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", DeletedAt: 2000, UpdatedAt: 2000, Rev: 5}},
	})
	head = srv.store.mustHeadRev(t)

	// A device that missed the delete tries to push the item back.
	push(t, handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 900, Rev: 6}},
	})

	snap, err := srv.store.SnapshotSince(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Items) != 1 {
		t.Fatalf("expected one row, got %d", len(snap.Items))
	}
	if snap.Items[0].DeletedAt == 0 {
		t.Fatalf("tombstone must survive a stale live push, got %+v", snap.Items[0])
	}
}

// mustHeadRev is a test helper so assertions read as "the head is X".
func (s *Store) mustHeadRev(t *testing.T) float64 {
	t.Helper()
	rev, err := s.headRev()
	if err != nil {
		t.Fatalf("head rev: %v", err)
	}
	return rev
}

// ── WebSocket broadcast tests ──────────────────────────────────────────────────────────────────

// newTestServerWithWS returns an httptest.Server whose mux includes the WS endpoint, the
// Server (with hub initialised), and the generated token.
func newTestServerWithWS(t *testing.T) (*httptest.Server, *Server, string) {
	t.Helper()
	srv, _, tok := newTestServer(t)
	srv.hub = NewHub()
	mux := http.NewServeMux()
	mux.HandleFunc(syncproto.HealthPath, srv.handleHealth)
	mux.HandleFunc(syncproto.SnapshotPath, srv.requireAuth(srv.handleSnapshot))
	mux.HandleFunc(syncproto.WSPath, srv.requireAuth(srv.handleWS))
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, srv, tok
}

// dialWS connects a gorilla websocket client to the test server's WS endpoint.
func dialWS(t *testing.T, ts *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + ts.URL[len("http"):] + syncproto.WSPath
	header := http.Header{}
	if token != "" {
		header.Set("Authorization", "Bearer "+token)
	}
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, resp, err := dialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("ws dial: %v (resp status: %d)", err, respStatusCode(resp))
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func respStatusCode(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}

// TestWSHealthAdvertisesWebSocketCapability pins that the health endpoint lists "websocket"
// so the client's status panel can show "实时推送: 支持".
func TestWSHealthAdvertisesWebSocketCapability(t *testing.T) {
	ts, _, _ := newTestServerWithWS(t)

	resp, err := http.Get(ts.URL + syncproto.HealthPath)
	if err != nil {
		t.Fatalf("health request: %v", err)
	}
	defer resp.Body.Close()
	var h syncproto.Health
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	found := false
	for _, cap := range h.Capabilities {
		if cap == syncproto.CapWebSocket {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("health capabilities must include %q, got %v", syncproto.CapWebSocket, h.Capabilities)
	}
}

// TestWSHandshakeWithoutTokenIsRejected verifies the auth gate fires before the upgrade.
func TestWSHandshakeWithoutTokenIsRejected(t *testing.T) {
	ts, _, _ := newTestServerWithWS(t)
	wsURL := "ws" + ts.URL[len("http"):] + syncproto.WSPath
	dialer := websocket.Dialer{HandshakeTimeout: 3 * time.Second}
	_, resp, err := dialer.Dial(wsURL, nil) // no Authorization header
	if err == nil {
		t.Fatal("WS dial without token must fail")
	}
	if respStatusCode(resp) != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", respStatusCode(resp))
	}
}

// TestWSBroadcastOnRevAdvance is the core acceptance test: a connected WS client must receive
// a rev notification within 2 seconds of a push that advances the head revision.
func TestWSBroadcastOnRevAdvance(t *testing.T) {
	ts, _, tok := newTestServerWithWS(t)

	conn := dialWS(t, ts, tok)
	// Give the server a moment to register the connection in the hub.
	time.Sleep(100 * time.Millisecond)

	// Push an item that must advance the head rev (prev=0, applied=1).
	rec := push(t, ts.Config.Handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push failed: %d %s", rec.Code, rec.Body.String())
	}

	// Read the broadcast — must arrive within 2 seconds.
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading WS message: %v", err)
	}
	var ev syncproto.WSEvent
	if err := json.Unmarshal(data, &ev); err != nil {
		t.Fatalf("decoding WSEvent: %v (raw: %s)", err, data)
	}
	if ev.Type != "rev" {
		t.Fatalf("expected type=rev, got %q", ev.Type)
	}
	if ev.Rev < 1 {
		t.Fatalf("notification rev must be ≥1 after first push, got %v", ev.Rev)
	}
}

// TestWSNoBroadcastOnUnchangedPush confirms that a push which does not advance the head rev
// does not generate a notification — otherwise every no-op sync would wake every client.
func TestWSNoBroadcastOnUnchangedPush(t *testing.T) {
	ts, _, tok := newTestServerWithWS(t)

	// First push advances rev to 1.
	push(t, ts.Config.Handler, tok, syncproto.PushRequest{
		BaseRev: 0,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})

	conn := dialWS(t, ts, tok)
	time.Sleep(100 * time.Millisecond)

	// Push the same item at the current head: nothing changes, no broadcast.
	head := srv_headForTest(t, ts)
	rec := push(t, ts.Config.Handler, tok, syncproto.PushRequest{
		BaseRev: head,
		Items:   []syncproto.SnapshotItem{{Id: "a", Title: "A", Text: "a", UpdatedAt: 1000, Rev: 1}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("unchanged push must succeed: %d", rec.Code)
	}

	// No message should arrive within 500ms — a read deadline is the expected outcome.
	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, data, err := conn.ReadMessage()
	if err == nil {
		t.Fatalf("unchanged push must not produce a WS broadcast, got: %s", data)
	}
	if !strings.Contains(err.Error(), "timeout") && !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("expected read deadline, got: %v", err)
	}
}

// srv_headForTest reads the store's head rev via the HTTP pull endpoint.
func srv_headForTest(t *testing.T, ts *httptest.Server) float64 {
	t.Helper()
	// We need a token; reuse the first bearer from the test context.
	// Simplification: query the health endpoint (unauthenticated) for the current rev.
	resp, err := http.Get(ts.URL + syncproto.HealthPath)
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	defer resp.Body.Close()
	var h syncproto.Health
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return h.Rev
}
