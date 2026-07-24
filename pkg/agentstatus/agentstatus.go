// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	StateBlocked = "blocked"
	StateWorking = "working"
	StateIdle    = "idle"
	StateUnknown = "unknown"
	StateRelease = "release"
)

const (
	PhaseThinking     = "thinking"
	PhaseTool         = "tool"
	PhaseShellCommand = "shell-command"
	PhaseApproval     = "approval"
	PhaseNone         = "none"
	PhaseUnknown      = "unknown"
)

const (
	SourceHook             = "hook"
	SourceShellIntegration = "shell-integration"
	SourceManual           = "manual"
)

type AgentStatusReport struct {
	BlockId    string `json:"blockId"`
	Provider   string `json:"provider,omitempty"`
	SessionId  string `json:"sessionId,omitempty"`
	Source     string `json:"source,omitempty"`
	State      string `json:"state"`
	Phase      string `json:"phase,omitempty"`
	Message    string `json:"message,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	Seq        int64  `json:"seq,omitempty"`
	TtlMs      int64  `json:"ttlMs,omitempty"`
	ReportedAt int64  `json:"reportedAt,omitempty"`
}

type AgentStatus struct {
	BlockId     string `json:"blockId"`
	Provider    string `json:"provider,omitempty"`
	SessionId   string `json:"sessionId,omitempty"`
	State       string `json:"state"`
	PrevState   string `json:"prevState,omitempty"`
	Phase       string `json:"phase"`
	Source      string `json:"source"`
	Confidence  string `json:"confidence"`
	Reason      string `json:"reason,omitempty"`
	Message     string `json:"message,omitempty"`
	ToolName    string `json:"toolName,omitempty"`
	UpdatedAt   int64  `json:"updatedAt"`
	ActiveSince int64  `json:"activeSince,omitempty"`
	Seq         int64  `json:"seq,omitempty"`
	ExpiresAt   int64  `json:"expiresAt,omitempty"`
}

type sourceEntry struct {
	status AgentStatus
}

type blockState struct {
	sources map[string]sourceEntry
	seqs    map[string]int64
}

var manager = &statusManager{
	blocks: make(map[string]*blockState),
	nowFn:  func() time.Time { return time.Now() },
}

type statusManager struct {
	lock   sync.Mutex
	blocks map[string]*blockState
	nowFn  func() time.Time
}

func NormalizeState(state string) string {
	switch strings.TrimSpace(strings.ToLower(state)) {
	case StateBlocked:
		return StateBlocked
	case StateWorking:
		return StateWorking
	case StateIdle, "done":
		return StateIdle
	case StateRelease:
		return StateRelease
	case StateUnknown:
		return StateUnknown
	default:
		return ""
	}
}

func NormalizePhase(phase string, state string) string {
	switch strings.TrimSpace(strings.ToLower(phase)) {
	case PhaseThinking:
		return PhaseThinking
	case PhaseTool:
		return PhaseTool
	case PhaseShellCommand:
		return PhaseShellCommand
	case PhaseApproval:
		return PhaseApproval
	case PhaseNone:
		return PhaseNone
	case PhaseUnknown:
		return PhaseUnknown
	}
	if state == StateIdle {
		return PhaseNone
	}
	if state == StateUnknown {
		return PhaseUnknown
	}
	return PhaseUnknown
}

func NormalizeSource(source string) string {
	source = strings.TrimSpace(strings.ToLower(source))
	if source == "" {
		return SourceHook
	}
	return source
}

func confidenceForSource(source string) string {
	switch source {
	case SourceHook:
		return "high"
	case SourceShellIntegration, SourceManual:
		return "medium"
	default:
		return "medium"
	}
}

func stateRank(state string) int {
	switch state {
	case StateBlocked:
		return 4
	case StateWorking:
		return 3
	case StateIdle:
		return 2
	case StateUnknown:
		return 1
	default:
		return 0
	}
}

func sourceRank(source string) int {
	switch source {
	case SourceHook:
		return 3
	case SourceManual:
		return 2
	case SourceShellIntegration:
		return 1
	default:
		return 1
	}
}

func statusScore(status AgentStatus) int {
	return stateRank(status.State)*10 + sourceRank(status.Source)
}

func isExpired(status AgentStatus, nowMs int64) bool {
	return status.ExpiresAt > 0 && status.ExpiresAt <= nowMs
}

func SanitizeReport(report AgentStatusReport, fallbackBlockId string) (AgentStatusReport, error) {
	return sanitizeReport(report, fallbackBlockId, time.Now().UnixMilli())
}

func sanitizeReport(report AgentStatusReport, fallbackBlockId string, nowMs int64) (AgentStatusReport, error) {
	originalState := report.State
	report.BlockId = strings.TrimSpace(report.BlockId)
	if report.BlockId == "" {
		report.BlockId = strings.TrimSpace(fallbackBlockId)
	}
	if report.BlockId == "" {
		return report, fmt.Errorf("missing block id")
	}
	report.Source = NormalizeSource(report.Source)
	report.ToolName = strings.TrimSpace(report.ToolName)
	if report.ToolName != "" && report.Phase == "" {
		report.Phase = PhaseTool
	}
	report.State = NormalizeState(report.State)
	if report.State == "" {
		return report, fmt.Errorf("invalid agent state %q", originalState)
	}
	report.Provider = strings.TrimSpace(strings.ToLower(report.Provider))
	report.SessionId = strings.TrimSpace(report.SessionId)
	report.Phase = NormalizePhase(report.Phase, report.State)
	report.Message = strings.TrimSpace(report.Message)
	if report.ReportedAt <= 0 {
		report.ReportedAt = nowMs
	}
	if report.TtlMs < 0 {
		report.TtlMs = 0
	}
	return report, nil
}

func Report(report AgentStatusReport, fallbackBlockId string) (*AgentStatus, bool, error) {
	return manager.report(report, fallbackBlockId)
}

func Release(blockId string, source string, seq int64) (*AgentStatus, bool, error) {
	return manager.release(blockId, source, seq)
}

func ForceRelease(blockId string, source string) (*AgentStatus, bool, error) {
	return manager.forceRelease(blockId, source)
}

func LastSequenceForTesting(blockId string, source string) int64 {
	manager.lock.Lock()
	defer manager.lock.Unlock()
	bs := manager.blocks[strings.TrimSpace(blockId)]
	if bs == nil {
		return 0
	}
	return bs.seqs[NormalizeSource(source)]
}

func Get(blockId string) *AgentStatus {
	return manager.get(blockId)
}

func ResetForTesting() {
	manager.lock.Lock()
	defer manager.lock.Unlock()
	manager.blocks = make(map[string]*blockState)
	manager.nowFn = func() time.Time { return time.Now() }
}

func SetNowForTesting(nowFn func() time.Time) {
	manager.lock.Lock()
	defer manager.lock.Unlock()
	manager.nowFn = nowFn
}

func (m *statusManager) nowMs() int64 {
	return m.nowFn().UnixMilli()
}

func (m *statusManager) report(report AgentStatusReport, fallbackBlockId string) (*AgentStatus, bool, error) {
	m.lock.Lock()
	defer m.lock.Unlock()

	nowMs := m.nowMs()
	report, err := sanitizeReport(report, fallbackBlockId, nowMs)
	if err != nil {
		return nil, false, err
	}
	if report.State == StateRelease {
		return m.releaseLocked(report.BlockId, report.Source, report.Seq, nowMs)
	}

	bs := m.blocks[report.BlockId]
	var prevCanonical *AgentStatus
	if bs != nil {
		prevCanonical = m.canonicalLocked(report.BlockId, nowMs)
	}
	if bs == nil {
		bs = &blockState{sources: make(map[string]sourceEntry), seqs: make(map[string]int64)}
		m.blocks[report.BlockId] = bs
	}
	prevSource := bs.sources[report.Source].status
	prevSeq := bs.seqs[report.Source]
	if report.Seq == 0 && prevSeq > 0 {
		return prevCanonical, false, nil
	}
	if report.Seq > 0 && prevSeq > 0 && report.Seq <= prevSeq {
		return prevCanonical, false, nil
	}
	if report.Seq > 0 {
		bs.seqs[report.Source] = report.Seq
	}

	expiresAt := int64(0)
	if report.TtlMs > 0 {
		expiresAt = report.ReportedAt + report.TtlMs
	}
	activeSince := report.ReportedAt
	if prevSource.State == report.State && prevSource.ActiveSince > 0 {
		activeSince = prevSource.ActiveSince
	}
	status := AgentStatus{
		BlockId:     report.BlockId,
		Provider:    report.Provider,
		SessionId:   report.SessionId,
		State:       report.State,
		Phase:       report.Phase,
		Source:      report.Source,
		Confidence:  confidenceForSource(report.Source),
		Reason:      "explicit-report",
		Message:     report.Message,
		ToolName:    report.ToolName,
		UpdatedAt:   report.ReportedAt,
		ActiveSince: activeSince,
		Seq:         report.Seq,
		ExpiresAt:   expiresAt,
	}
	bs.sources[report.Source] = sourceEntry{status: status}
	nextCanonical := m.canonicalLocked(report.BlockId, nowMs)
	attachPrevState(nextCanonical, prevCanonical)
	return nextCanonical, !sameStatus(prevCanonical, nextCanonical), nil
}

func (m *statusManager) release(blockId string, source string, seq int64) (*AgentStatus, bool, error) {
	m.lock.Lock()
	defer m.lock.Unlock()
	blockId = strings.TrimSpace(blockId)
	if blockId == "" {
		return nil, false, fmt.Errorf("missing block id")
	}
	return m.releaseLocked(blockId, NormalizeSource(source), seq, m.nowMs())
}

func (m *statusManager) forceRelease(blockId string, source string) (*AgentStatus, bool, error) {
	m.lock.Lock()
	defer m.lock.Unlock()
	blockId = strings.TrimSpace(blockId)
	if blockId == "" {
		return nil, false, fmt.Errorf("missing block id")
	}
	return m.releaseLocked(blockId, NormalizeSource(source), -1, m.nowMs())
}

func (m *statusManager) releaseLocked(blockId string, source string, seq int64, nowMs int64) (*AgentStatus, bool, error) {
	bs := m.blocks[blockId]
	if bs == nil {
		return nil, false, nil
	}
	prevCanonical := m.canonicalLocked(blockId, nowMs)
	prevSeq := bs.seqs[source]
	if seq < 0 {
		// Force release bypasses the sequence check but keeps the guard so
		// delayed hook reports from the stopped process cannot revive status.
	} else if seq == 0 && prevSeq > 0 {
		return prevCanonical, false, nil
	} else if seq > 0 && prevSeq > 0 && seq <= prevSeq {
		return prevCanonical, false, nil
	} else if seq > 0 {
		bs.seqs[source] = seq
	}
	delete(bs.sources, source)
	if len(bs.sources) == 0 && len(bs.seqs) == 0 {
		delete(m.blocks, blockId)
	}
	nextCanonical := m.canonicalLocked(blockId, nowMs)
	attachPrevState(nextCanonical, prevCanonical)
	return nextCanonical, !sameStatus(prevCanonical, nextCanonical), nil
}

func (m *statusManager) get(blockId string) *AgentStatus {
	m.lock.Lock()
	defer m.lock.Unlock()
	return m.canonicalLocked(strings.TrimSpace(blockId), m.nowMs())
}

func (m *statusManager) canonicalLocked(blockId string, nowMs int64) *AgentStatus {
	bs := m.blocks[blockId]
	if bs == nil {
		return nil
	}
	var best *AgentStatus
	for source, entry := range bs.sources {
		status := entry.status
		if isExpired(status, nowMs) {
			delete(bs.sources, source)
			continue
		}
		if best == nil || statusScore(status) > statusScore(*best) ||
			(statusScore(status) == statusScore(*best) && status.UpdatedAt > best.UpdatedAt) {
			statusCopy := status
			best = &statusCopy
		}
	}
	if len(bs.sources) == 0 && len(bs.seqs) == 0 {
		delete(m.blocks, blockId)
	}
	return best
}

func attachPrevState(next *AgentStatus, prev *AgentStatus) {
	if next == nil {
		return
	}
	if prev == nil {
		next.PrevState = ""
		return
	}
	// canonicalLocked returns a defensive copy, so mutating next here is safe.
	next.PrevState = prev.State
}

func sameStatus(a *AgentStatus, b *AgentStatus) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	// UpdatedAt, ActiveSince are intentionally excluded from comparison.
	// Hook reports may carry a new timestamp on each invocation even when
	// the semantic state (state, phase, source) is unchanged. Including them
	// would suppress valid state-change events after the user acks the badge,
	// because the new UpdatedAt would always differ from the previous value.
	return a.BlockId == b.BlockId &&
		a.Provider == b.Provider &&
		a.SessionId == b.SessionId &&
		a.State == b.State &&
		a.Phase == b.Phase &&
		a.Source == b.Source &&
		a.Confidence == b.Confidence &&
		a.Reason == b.Reason &&
		a.Message == b.Message &&
		a.ToolName == b.ToolName &&
		a.Seq == b.Seq &&
		a.ExpiresAt == b.ExpiresAt
}
