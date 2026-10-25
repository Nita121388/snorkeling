// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"strings"
	"testing"
)

func TestAutoGenerateRejectsInvalidKind(t *testing.T) {
	svc := &AISessionsService{}
	_, err := svc.AutoGenerate(context.Background(), &AISessionsAutoGenerateRequest{
		IDs:  []string{"s1"},
		Kind: "wrong",
	})
	if err == nil || !strings.Contains(err.Error(), "invalid generation kind") {
		t.Fatalf("expected invalid kind error, got %v", err)
	}
}

func TestAutoGenerateRejectsOversizedBatch(t *testing.T) {
	svc := &AISessionsService{}
	ids := make([]string, MaxAutoGenerateBatch+1)
	for i := range ids {
		ids[i] = "s"
	}
	_, err := svc.AutoGenerate(context.Background(), &AISessionsAutoGenerateRequest{
		IDs:  ids,
		Kind: "title",
	})
	if err == nil || !strings.Contains(err.Error(), "too many sessions") {
		t.Fatalf("expected batch limit error, got %v", err)
	}
}

func TestAutoGenerateRequiresRequest(t *testing.T) {
	svc := &AISessionsService{}
	if _, err := svc.AutoGenerate(context.Background(), nil); err == nil {
		t.Fatalf("expected error for nil request")
	}
}

func TestAutoGenerateEmptyIDsIsNoop(t *testing.T) {
	svc := &AISessionsService{}
	resp, err := svc.AutoGenerate(context.Background(), &AISessionsAutoGenerateRequest{Kind: "title"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || len(resp.Queued) != 0 {
		t.Fatalf("expected empty queued response, got %#v", resp)
	}
}
