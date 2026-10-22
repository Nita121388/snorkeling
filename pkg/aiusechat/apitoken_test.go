// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// useEmptySecretStore points the secret store at an empty temp dir so the tests
// never read (or depend on) the developer's real secret store.
func useEmptySecretStore(t *testing.T) {
	t.Helper()
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = t.TempDir()
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = prev
	})
}

func TestResolveAPIToken(t *testing.T) {
	useEmptySecretStore(t)

	tests := []struct {
		name         string
		apiToken     string
		secretName   string
		wantToken    string
		wantSecret   string
		wantFound    bool
		wantErr      bool
		wantNoReason bool
	}{
		{
			name:         "explicit token wins over secret name",
			apiToken:     "  direct-token  ",
			secretName:   "TRELlIS_MISSING_SECRET_XYZ",
			wantToken:    "direct-token",
			wantSecret:   "",
			wantFound:    true,
			wantNoReason: true,
		},
		{
			name:       "nothing configured",
			apiToken:   "   ",
			secretName: "",
			wantToken:  "",
			wantSecret: "",
			wantFound:  false,
		},
		{
			name:       "missing secret",
			apiToken:   "",
			secretName: "TRELlIS_MISSING_SECRET_XYZ",
			wantToken:  "",
			wantSecret: "TRELlIS_MISSING_SECRET_XYZ",
			wantFound:  false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result, err := ResolveAPIToken(tc.apiToken, tc.secretName)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got result %+v", result)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Token != tc.wantToken {
				t.Fatalf("token = %q, want %q", result.Token, tc.wantToken)
			}
			if result.SecretName != tc.wantSecret {
				t.Fatalf("secret name = %q, want %q", result.SecretName, tc.wantSecret)
			}
			if result.SecretFound != tc.wantFound {
				t.Fatalf("secret found = %v, want %v", result.SecretFound, tc.wantFound)
			}
			if tc.wantNoReason && result.MissingReason() != "" {
				t.Fatalf("expected no missing reason, got %q", result.MissingReason())
			}
			if !tc.wantNoReason && result.MissingReason() == "" {
				t.Fatal("expected a missing reason")
			}
		})
	}
}

func TestAPITokenResultMissingReason(t *testing.T) {
	tests := []struct {
		name   string
		result APITokenResult
		want   string
	}{
		{
			name:   "token resolved",
			result: APITokenResult{Token: "tok", SecretName: "SOME_SECRET", SecretFound: true},
			want:   "",
		},
		{
			name:   "secret not in store",
			result: APITokenResult{SecretName: "OPENAI_KEY"},
			want:   `secret "OPENAI_KEY" is not in the Settings > Secrets store`,
		},
		{
			name:   "secret present but empty",
			result: APITokenResult{SecretName: "OPENAI_KEY", SecretFound: true},
			want:   `secret "OPENAI_KEY" is empty in the Settings > Secrets store`,
		},
		{
			name:   "nothing configured",
			result: APITokenResult{},
			want:   "no API key configured",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.result.MissingReason()
			if got != tc.want {
				t.Fatalf("missing reason = %q, want %q", got, tc.want)
			}
			for _, r := range got {
				if r > 127 {
					t.Fatalf("missing reason must be ASCII, got %q", got)
				}
			}
		})
	}
}

func TestResolveAPITokenMissingSecretIsReported(t *testing.T) {
	useEmptySecretStore(t)

	const secretName = "TRELlIS_MISSING_SECRET_XYZ"
	result, err := ResolveAPIToken("", secretName)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Token != "" {
		t.Fatalf("expected no token, got %q", result.Token)
	}
	reason := result.MissingReason()
	if !strings.Contains(reason, secretName) {
		t.Fatalf("expected secret name %q in reason, got %q", secretName, reason)
	}
	if !strings.Contains(reason, "not in the Settings > Secrets store") {
		t.Fatalf("expected a missing-secret reason, got %q", reason)
	}
}
