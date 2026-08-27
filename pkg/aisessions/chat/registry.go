// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"fmt"
	"sort"
)

// ProviderDescriptor is the GUI-chat capability information for one source.
type ProviderDescriptor struct {
	Source       string       `json:"source"`
	Capabilities Capabilities `json:"capabilities"`
}

// ProviderFactory creates a fresh adapter for one live GUI chat session.
type ProviderFactory func() Provider

var providerFactories = map[string]ProviderFactory{
	SourcePi: NewPiAdapter,
}

// ProviderForSource resolves a GUI-chat source from the central registry.
func ProviderForSource(source string) (Provider, error) {
	factory, ok := providerFactories[source]
	if !ok {
		return nil, fmt.Errorf("chat not supported for source %q", source)
	}
	provider := factory()
	if provider == nil || provider.Source() != source {
		return nil, fmt.Errorf("invalid chat provider registration for source %q", source)
	}
	return provider, nil
}

// AvailableProviders lists the sources that can be driven through GUI chat.
func AvailableProviders() []ProviderDescriptor {
	sources := make([]string, 0, len(providerFactories))
	for source := range providerFactories {
		sources = append(sources, source)
	}
	sort.Strings(sources)

	providers := make([]ProviderDescriptor, 0, len(sources))
	for _, source := range sources {
		provider, err := ProviderForSource(source)
		if err == nil {
			providers = append(providers, ProviderDescriptor{
				Source:       source,
				Capabilities: provider.Capabilities(),
			})
		}
	}
	return providers
}
