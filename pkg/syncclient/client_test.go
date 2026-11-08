// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// healthServer returns a test server whose /v1/health reports the given health struct, and whose
// /v1/snapshot requires the given token ("" = no auth check).
func healthServer(t *testing.T, health syncproto.Health, token string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(syncproto.HealthPath, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(health)
	})
	mux.HandleFunc(syncproto.SnapshotPath, func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(syncproto.Snapshot{})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func healthy() syncproto.Health {
	return syncproto.Health{
		Service:         syncproto.ServiceName,
		ProtocolVersion: syncproto.ProtocolVersion,
		AppVersion:      "0.1.0",
		RequiresAuth:    true,
	}
}

func checkByID(p *Probe, id string) *Check {
	for i := range p.Checks {
		if p.Checks[i].Id == id {
			return &p.Checks[i]
		}
	}
	return nil
}

func TestValidateURLRefusesPlainHTTPByDefault(t *testing.T) {
	// A token over http:// is a credential leak, so it must be an explicit opt-in.
	if _, err := ValidateURL("http://192.168.1.10:8787", false); err == nil {
		t.Fatal("http:// must be refused without allowInsecure")
	}
	if _, err := ValidateURL("http://192.168.1.10:8787", true); err != nil {
		t.Fatalf("http:// must be allowed with allowInsecure: %v", err)
	}
	if got, err := ValidateURL("https://sync.example.com/", false); err != nil || got != "https://sync.example.com" {
		t.Fatalf("trailing slash must be trimmed, got %q err %v", got, err)
	}
	if _, err := ValidateURL("sync.example.com", false); err == nil {
		t.Fatal("a URL without a scheme must be rejected")
	}
}

func TestDiagnoseHappyPath(t *testing.T) {
	srv := healthServer(t, healthy(), "tok")
	probe := Diagnose(context.Background(), srv.URL, "tok", true)

	if !probe.Ready {
		t.Fatalf("expected ready, got checks %+v", probe.Checks)
	}
	for _, id := range []string{"url", "reach", "protocol", "auth"} {
		c := checkByID(probe, id)
		if c == nil || c.State != CheckOK {
			t.Fatalf("check %q should be ok, got %+v", id, c)
		}
	}
	if probe.Health == nil || probe.Health.AppVersion != "0.1.0" {
		t.Fatalf("health must be surfaced to the caller: %+v", probe.Health)
	}
}

func TestDiagnoseUnreachableCarriesFix(t *testing.T) {
	// Port 1 on loopback is reliably closed, so this exercises the network-error path.
	probe := Diagnose(context.Background(), "http://127.0.0.1:1", "", true)

	if probe.Ready {
		t.Fatal("must not be ready")
	}
	reach := checkByID(probe, "reach")
	if reach == nil || reach.State != CheckFailed {
		t.Fatalf("reach should fail, got %+v", reach)
	}
	// An agent must be able to act on the failure without translating it.
	if reach.Fix == "" {
		t.Fatal("a failed check must carry a fix")
	}
	if auth := checkByID(probe, "auth"); auth == nil || auth.State != CheckSkipped {
		t.Fatalf("auth must be skipped when unreachable, got %+v", auth)
	}
}

func TestDiagnoseProtocolMismatchIsReportedBeforeAuth(t *testing.T) {
	h := healthy()
	h.ProtocolVersion = 99
	srv := healthServer(t, h, "tok")
	probe := Diagnose(context.Background(), srv.URL, "", true)

	if probe.Ready {
		t.Fatal("protocol mismatch must not be ready")
	}
	proto := checkByID(probe, "protocol")
	if proto == nil || proto.State != CheckFailed {
		t.Fatalf("protocol should fail, got %+v", proto)
	}
	if !strings.Contains(proto.Detail, "protocol mismatch") {
		t.Fatalf("detail should name the problem, got %q", proto.Detail)
	}
	// Fixing the token would not help, so auth must not be the reported blocker.
	if auth := checkByID(probe, "auth"); auth == nil || auth.State != CheckSkipped {
		t.Fatalf("auth must be skipped on protocol mismatch, got %+v", auth)
	}
}

func TestDiagnoseMissingTokenSaysHowToFixIt(t *testing.T) {
	srv := healthServer(t, healthy(), "tok")
	probe := Diagnose(context.Background(), srv.URL, "", true)

	if probe.Ready {
		t.Fatal("must not be ready without a token")
	}
	auth := checkByID(probe, "auth")
	if auth == nil || auth.State != CheckFailed {
		t.Fatalf("auth should fail, got %+v", auth)
	}
	if !strings.Contains(auth.Fix, "--token") {
		t.Fatalf("fix must show the exact command, got %q", auth.Fix)
	}
}

func TestDiagnoseRejectedTokenIsDistinguishedFromMissing(t *testing.T) {
	srv := healthServer(t, healthy(), "right-token")
	probe := Diagnose(context.Background(), srv.URL, "wrong-token", true)

	if probe.Ready {
		t.Fatal("must not be ready with a rejected token")
	}
	auth := checkByID(probe, "auth")
	if auth == nil || auth.State != CheckFailed {
		t.Fatalf("auth should fail, got %+v", auth)
	}
	// "token rejected" and "no token configured" are different actions for the user.
	if !strings.Contains(auth.Detail, "401") {
		t.Fatalf("rejected token must be distinguishable, got %q", auth.Detail)
	}
}

func TestDiagnoseWrongServiceIsCaught(t *testing.T) {
	h := healthy()
	h.Service = "something-else"
	srv := healthServer(t, h, "")
	probe := Diagnose(context.Background(), srv.URL, "", true)

	if probe.Ready {
		t.Fatal("a wrong service must not be ready")
	}
	proto := checkByID(probe, "protocol")
	if proto == nil || proto.State != CheckFailed || !strings.Contains(proto.Detail, "wrong service") {
		t.Fatalf("expected wrong-service failure, got %+v", proto)
	}
}

func TestPullSurfacesUnauthorized(t *testing.T) {
	srv := healthServer(t, healthy(), "right-token")
	client := &Client{BaseURL: srv.URL, Token: "wrong-token"}
	_, err := client.Pull(context.Background(), 0)
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected a 401 message, got %v", err)
	}
}

func TestPushReportsStaleBaseRevWithCurrentSnapshot(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc(syncproto.SnapshotPath, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(syncproto.ConflictStatusCode)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":   "baseRev mismatch",
			"current": syncproto.Snapshot{Rev: 7, Items: []syncproto.SnapshotItem{{Id: "a"}}},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := &Client{BaseURL: srv.URL, Token: "tok"}
	res, err := client.Push(context.Background(), syncproto.PushRequest{BaseRev: 0})
	if err != nil {
		t.Fatalf("a 409 is a recoverable result, not an error: %v", err)
	}
	if res.Applied {
		t.Fatal("stale push must not be reported as applied")
	}
	if res.Current == nil || res.Current.Rev != 7 {
		t.Fatalf("the current snapshot must come back for reconciliation: %+v", res.Current)
	}
}
