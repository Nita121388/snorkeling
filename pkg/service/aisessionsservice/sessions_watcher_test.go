// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wps"
)

type recordingClient struct {
	mu     sync.Mutex
	events []wps.WaveEvent
}

func (c *recordingClient) SendEvent(routeId string, event wps.WaveEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, event)
}

func (c *recordingClient) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.events)
}

// publishSessionsChangedThrottled must publish the first change immediately
// and drop publishes that follow within sessionsChangedPublishMinInterval;
// a dropped publish is not lost forever — the next watcher tick re-reports.
func TestPublishSessionsChangedThrottled(t *testing.T) {
	prevClient := wps.Broker.GetClient()
	client := &recordingClient{}
	wps.Broker.SetClient(client)
	defer wps.Broker.SetClient(prevClient)

	const route = "test-sessions-changed-route"
	wps.Broker.Subscribe(route, wps.SubscriptionRequest{
		Event:     wps.Event_AISessionsSessionsChanged,
		AllScopes: true,
	})
	defer wps.Broker.Unsubscribe(route, wps.Event_AISessionsSessionsChanged)

	prevLastPublish := sessionsChangedLastPublishAt
	sessionsChangedLastPublishAt = time.Time{}
	defer func() { sessionsChangedLastPublishAt = prevLastPublish }()

	publishSessionsChangedThrottled(1)
	if got := client.count(); got != 1 {
		t.Fatalf("expected 1 published event, got %d", got)
	}
	publishSessionsChangedThrottled(2)
	if got := client.count(); got != 1 {
		t.Fatalf("expected the second publish to be throttled (still 1 event), got %d", got)
	}
}
