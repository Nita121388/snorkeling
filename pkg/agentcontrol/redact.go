// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"regexp"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// metaAllowlist is the only set of block meta keys the control surface exposes.
// Block meta can contain credentials (cmd:env, agency tokens, URLs with keys),
// so this is an allowlist rather than a denylist.
var metaAllowlist = map[string]bool{
	waveobj.MetaKey_View:       true,
	waveobj.MetaKey_Controller: true,
	waveobj.MetaKey_Connection: true,
	waveobj.MetaKey_CmdCwd:     true,
	waveobj.MetaKey_FrameTitle: true,
	waveobj.MetaKey_Icon:       true,
	waveobj.MetaKey_Url:        true,
	waveobj.MetaKey_File:       true,
	"agent:provider":           true,
	"agent:sessionid":          true,
	"agent:autoresume":         true,
	"aisessions:newchat":       true,
}

// secretValueRe matches values that look like credentials. Applied to the few
// free-form strings we do surface (message, reason, url).
var secretValueRe = regexp.MustCompile(`(?i)(token|secret|password|passwd|apikey|api_key|privatekey|credential)=([^&\s]+)`)

const redactedValue = "***"

// RedactMeta returns an allowlisted, redacted copy of block meta.
func RedactMeta(meta waveobj.MetaMapType) waveobj.MetaMapType {
	if meta == nil {
		return nil
	}
	rtn := make(waveobj.MetaMapType, len(meta))
	for key, value := range meta {
		if !metaAllowlist[key] {
			continue
		}
		if str, ok := value.(string); ok {
			rtn[key] = RedactString(str)
			continue
		}
		rtn[key] = value
	}
	return rtn
}

// RedactString masks credential-looking query parameters.
func RedactString(value string) string {
	if value == "" {
		return value
	}
	return secretValueRe.ReplaceAllString(value, "$1="+redactedValue)
}
