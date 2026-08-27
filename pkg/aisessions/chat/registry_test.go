// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import "testing"

func TestProviderRegistry(t *testing.T) {
	provider, err := ProviderForSource(SourcePi)
	if err != nil {
		t.Fatalf("ProviderForSource(%q): %v", SourcePi, err)
	}
	if provider.Source() != SourcePi {
		t.Fatalf("provider source = %q, want %q", provider.Source(), SourcePi)
	}

	providers := AvailableProviders()
	var pi *ProviderDescriptor
	for i := range providers {
		if providers[i].Source == SourcePi {
			pi = &providers[i]
			break
		}
	}
	if pi == nil {
		t.Fatalf("AvailableProviders() = %#v, want pi", providers)
	}
	if !pi.Capabilities.SupportsStreaming {
		t.Fatal("pi provider must advertise streaming support")
	}
}

func TestProviderForSourceRejectsUnknownSource(t *testing.T) {
	if _, err := ProviderForSource("unknown"); err == nil {
		t.Fatal("ProviderForSource accepted an unknown source")
	}
}
