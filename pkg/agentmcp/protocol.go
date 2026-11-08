// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentmcp exposes the Agent Control Surface as an MCP server over
// stdio. It is a thin facade: every tool maps onto an existing wsh RPC, so
// there is exactly one implementation of each capability and the CLI and the
// MCP server can never drift apart.
//
// Transport is stdio only. Design §10.5.5: opening a TCP listener here would
// enlarge the threat model by an order of magnitude.
package agentmcp

import (
	"encoding/json"
	"fmt"
)

// JSON-RPC 2.0 error codes used by the MCP transport.
const (
	ErrCodeParse          = -32700
	ErrCodeInvalidRequest = -32600
	ErrCodeMethodNotFound = -32601
	ErrCodeInvalidParams  = -32602
	ErrCodeInternal       = -32603
)

// ProtocolVersion is the MCP revision this server speaks.
const ProtocolVersion = "2024-11-05"

// ServerName / ServerVersion identify this server in `initialize`.
const (
	ServerName    = "snorkeling"
	ServerVersion = "1"
)

// Request is an incoming JSON-RPC 2.0 request (or notification when ID is
// absent — notifications get no response).
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// IsNotification reports whether the request expects no response.
func (r *Request) IsNotification() bool {
	return len(r.ID) == 0
}

// Response is an outgoing JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *RpcError       `json:"error,omitempty"`
}

// RpcError is a JSON-RPC 2.0 error object.
type RpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *RpcError) Error() string {
	return fmt.Sprintf("%s (code %d)", e.Message, e.Code)
}

func errorResponse(id json.RawMessage, code int, message string) *Response {
	return &Response{JSONRPC: "2.0", ID: id, Error: &RpcError{Code: code, Message: message}}
}

func okResponse(id json.RawMessage, result any) *Response {
	return &Response{JSONRPC: "2.0", ID: id, Result: result}
}

// ---- MCP payload shapes ----

// InitializeResult answers `initialize`.
type InitializeResult struct {
	ProtocolVersion string         `json:"protocolVersion"`
	ServerInfo      ServerInfo     `json:"serverInfo"`
	Capabilities    ServerCapability `json:"capabilities"`
}

type ServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// ServerCapability advertises what this server supports. Tools are always on;
// resources are advertised because snorkeling://state and session summaries
// are read-only snapshots.
type ServerCapability struct {
	Tools     map[string]any `json:"tools,omitempty"`
	Resources map[string]any `json:"resources,omitempty"`
}

// Tool is one callable tool in `tools/list`.
type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations *Annotations   `json:"annotations,omitempty"`
}

// Annotations let the host decide whether to ask the user for approval,
// instead of relying on our own --yes flags.
type Annotations struct {
	Title           string `json:"title,omitempty"`
	ReadOnlyHint    bool   `json:"readOnlyHint,omitempty"`
	DestructiveHint bool   `json:"destructiveHint,omitempty"`
	IdempotentHint  bool   `json:"idempotentHint,omitempty"`
}

// ToolCallResult is the `tools/call` payload.
type ToolCallResult struct {
	Content []Content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
}

// Content is a single MCP content block. We always return JSON text so the
// model gets structured data without a second parse step.
type Content struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func textContent(text string) []Content {
	return []Content{{Type: "text", Text: text}}
}

// Resource describes one readable MCP resource.
type Resource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// ResourceContent is the `resources/read` payload item.
type ResourceContent struct {
	URI      string `json:"uri"`
	MimeType string `json:"mimeType,omitempty"`
	Text     string `json:"text,omitempty"`
}
