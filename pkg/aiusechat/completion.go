// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// discardResponseWriter is a no-op http.ResponseWriter that lets the AI backends
// stream into a headless completion call. It implements Flusher and a write
// deadline so the shared SSE handler can set up without a real HTTP connection.
type discardResponseWriter struct {
	hdr http.Header
}

func (w *discardResponseWriter) Header() http.Header {
	if w.hdr == nil {
		w.hdr = make(http.Header)
	}
	return w.hdr
}

func (w *discardResponseWriter) Write(p []byte) (int, error) { return len(p), nil }
func (w *discardResponseWriter) WriteHeader(int)             {}
func (w *discardResponseWriter) Flush()                      {}
func (w *discardResponseWriter) SetWriteDeadline(time.Time) error {
	return nil
}

// RunCompletion performs a single-turn text completion using the supplied AI
// options. It reuses the streaming backend, so provider request/response parsing
// is shared with the interactive Wave AI chat. Returns the assistant's text.
//
// The completion is ephemeral: a scratch chat lives only in memory and is removed
// afterwards, so it never touches the user's chat history or disk. It has no tools,
// so the backend cannot run any local actions on our behalf.
func RunCompletion(ctx context.Context, opts uctypes.AIOptsType, systemPrompt string, userPrompt string) (string, error) {
	backend, err := GetBackendByAPIType(opts.APIType)
	if err != nil {
		return "", err
	}

	chatId := "completion-" + uuid.NewString()
	chatOpts := uctypes.WaveChatOpts{
		ChatId:       chatId,
		ClientId:     "completion",
		Config:       opts,
		SystemPrompt: []string{systemPrompt},
	}

	userMsg := uctypes.AIMessage{
		MessageId: uuid.NewString(),
		Parts:     []uctypes.AIMessagePart{{Type: uctypes.AIMessagePartTypeText, Text: userPrompt}},
	}
	nativeUser, err := backend.ConvertAIMessageToNativeChatMessage(userMsg)
	if err != nil {
		return "", fmt.Errorf("converting completion input: %w", err)
	}
	if err := chatstore.DefaultChatStore.PostMessage(chatId, &opts, nativeUser); err != nil {
		return "", fmt.Errorf("seeding completion chat: %w", err)
	}
	defer chatstore.DefaultChatStore.Delete(chatId)

	sseHandler := sse.MakeSSEHandlerCh(&discardResponseWriter{}, ctx)
	defer sseHandler.Close()

	if _, err := RunAIChat(ctx, sseHandler, backend, chatOpts); err != nil {
		return "", fmt.Errorf("ai completion failed: %w", err)
	}
	if sseErr := sseHandler.Err(); sseErr != nil {
		return "", fmt.Errorf("ai completion aborted: %w", sseErr)
	}

	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return "", fmt.Errorf("ai completion produced no chat")
	}
	uiChat, err := backend.ConvertAIChatToUIChat(*chat)
	if err != nil {
		return "", fmt.Errorf("reading completion output: %w", err)
	}
	for i := len(uiChat.Messages) - 1; i >= 0; i-- {
		if uiChat.Messages[i].Role == "assistant" {
			return strings.TrimSpace(uiChat.Messages[i].GetContent()), nil
		}
	}
	return "", nil
}

// GetAIOptsForMode resolves a Wave AI mode (e.g. "waveai@quick") into the
// concrete AI options used to talk to the provider, including the API token.
// It applies the same premium / defaulting rules as the interactive chat.
func GetAIOptsForMode(aiMode string, maxOutputTokens int) (*uctypes.AIOptsType, error) {
	return getWaveAISettings(shouldUsePremium(), false, waveobj.ObjRTInfo{WaveAIMaxOutputTokens: maxOutputTokens}, aiMode)
}

// DefaultMetadataAIMode picks the AI mode used for lightweight metadata
// generation (notes/tags). It prefers an explicit override, then the user's
// default Wave AI mode, then the fastest preset so a missing selection never
// blocks the feature.
func DefaultMetadataAIMode(explicit string) string {
	if strings.TrimSpace(explicit) != "" {
		return explicit
	}
	if mode := strings.TrimSpace(wconfig.GetWatcher().GetFullConfig().Settings.WaveAiDefaultMode); mode != "" {
		return mode
	}
	return uctypes.AIModeQuick
}
