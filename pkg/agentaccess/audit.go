// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentaccess

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// AuditEntry is one line of control-audit.jsonl (design §10.6).
//
// We deliberately do NOT record the full token or the full jti: an audit file
// that leaks the credential it audits is worse than no audit.
type AuditEntry struct {
	TS         int64  `json:"ts"`
	Command    string `json:"command"`
	AgentName  string `json:"agentname,omitempty"`
	JtiPrefix  string `json:"jtiprefix,omitempty"`
	Result     string `json:"result"` // ok | denied
	Reason     string `json:"reason,omitempty"`
}

// auditDir is separate from the registry so retention policies can differ.
func auditDir() string {
	return filepath.Join(filepath.Dir(dataDir()), "audit")
}

func auditPath() string { return filepath.Join(auditDir(), "control-audit.jsonl") }

var auditLock sync.Mutex

// AppendAudit appends one audit line. Failures are returned so the caller can
// decide, but the transport gate treats audit failure as non-fatal: refusing a
// command because the audit disk is full would be a worse failure mode.
func AppendAudit(entry AuditEntry) error {
	auditLock.Lock()
	defer auditLock.Unlock()
	if entry.TS == 0 {
		entry.TS = time.Now().UnixMilli()
	}
	if err := os.MkdirAll(auditDir(), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	f, err := os.OpenFile(auditPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}

// AuditPath is exported for tests and for `wsh auth` diagnostics.
func AuditPath() string { return auditPath() }
