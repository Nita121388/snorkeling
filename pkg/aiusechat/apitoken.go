// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
)

// APITokenResult describes the outcome of resolving an AI endpoint's API token.
type APITokenResult struct {
	Token       string // resolved token, empty when no usable token was found
	SecretName  string // the secret that was consulted, empty when none was named
	SecretFound bool   // whether the named secret exists in the local secret store
}

// ResolveAPIToken resolves the API token for an AI endpoint.
// Priority (single definition for the whole repo): an explicitly supplied token wins;
// otherwise the named secret is read from the local secret store.
func ResolveAPIToken(apiToken string, secretName string) (APITokenResult, error) {
	trimmedToken := strings.TrimSpace(apiToken)
	if trimmedToken != "" {
		// An explicit token always wins and the secret store is never touched.
		return APITokenResult{Token: trimmedToken, SecretFound: true}, nil
	}
	trimmedName := strings.TrimSpace(secretName)
	if trimmedName == "" {
		// Nothing configured: the caller decides how to report it.
		return APITokenResult{}, nil
	}
	value, exists, err := secretstore.GetSecret(trimmedName)
	if err != nil {
		return APITokenResult{SecretName: trimmedName}, err
	}
	if !exists {
		return APITokenResult{SecretName: trimmedName}, nil
	}
	return APITokenResult{Token: strings.TrimSpace(value), SecretName: trimmedName, SecretFound: true}, nil
}

// MissingReason explains why no token could be resolved.
// It returns an empty string when a token was resolved.
func (r APITokenResult) MissingReason() string {
	if r.Token != "" {
		return ""
	}
	if r.SecretName != "" {
		if !r.SecretFound {
			return fmt.Sprintf("secret %q is not in the Settings > Secrets store", r.SecretName)
		}
		return fmt.Sprintf("secret %q is empty in the Settings > Secrets store", r.SecretName)
	}
	return "no API key configured"
}
