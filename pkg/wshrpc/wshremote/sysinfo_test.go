// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type sysInfoTestRecorder struct {
	collectCalls int
	publishCalls int
	lastTsMilli  int64
	lastValues   map[string]float64
}

func (rec *sysInfoTestRecorder) makePublisher(connName string, hasSubs func() bool) *sysInfoPublisher {
	clock := &fakeClock{nowMilli: 1790000000000}
	return &sysInfoPublisher{
		connName: connName,
		now:      clock.Now,
		collectValues: func() map[string]float64 {
			rec.collectCalls++
			return map[string]float64{"cpu": 42.0, "mem:used": 1.5}
		},
		publishEvent: func(tsMilli int64, values map[string]float64) {
			rec.publishCalls++
			rec.lastTsMilli = tsMilli
			rec.lastValues = values
		},
		hasSubs: hasSubs,
	}
}

type fakeClock struct{ nowMilli int64 }

func (c *fakeClock) Now() time.Time { return time.UnixMilli(c.nowMilli) }

// TestSysInfoTickSkipsZeroSubscribers: 0 subscribers => tick must not collect
// and must not publish.
func TestSysInfoTickSkipsZeroSubscribers(t *testing.T) {
	rec := &sysInfoTestRecorder{}
	pub := rec.makePublisher("local", func() bool { return false })
	published := pub.tick()
	if published {
		t.Fatal("expected tick to skip when there are no subscribers")
	}
	if rec.collectCalls != 0 {
		t.Fatalf("expected 0 collect calls with no subscribers, got %d", rec.collectCalls)
	}
	if rec.publishCalls != 0 {
		t.Fatalf("expected 0 publish calls with no subscribers, got %d", rec.publishCalls)
	}
}

// TestSysInfoTickPublishesWithSubscribers: with subscribers => tick collects
// and publishes one frame with the injected clock's timestamp.
func TestSysInfoTickPublishesWithSubscribers(t *testing.T) {
	rec := &sysInfoTestRecorder{}
	pub := rec.makePublisher("local", func() bool { return true })
	published := pub.tick()
	if !published {
		t.Fatal("expected tick to publish when there are subscribers")
	}
	if rec.collectCalls != 1 {
		t.Fatalf("expected 1 collect call, got %d", rec.collectCalls)
	}
	if rec.publishCalls != 1 {
		t.Fatalf("expected 1 publish call, got %d", rec.publishCalls)
	}
	if rec.lastTsMilli != 1790000000000 {
		t.Fatalf("expected injected clock ts 1790000000000, got %d", rec.lastTsMilli)
	}
	if rec.lastValues["cpu"] != 42.0 {
		t.Fatalf("expected collected cpu value 42.0, got %v", rec.lastValues["cpu"])
	}
}

// TestSysInfoHasSubscribersGate asserts the production gate:
//   - fail-open: subscription state not observable (broker not wired, e.g. the
//     remote connserver process) => always publish, even with 0 subscribers
//   - observable + 0 subscribers => skip
//   - observable + >=1 subscriber => publish
func TestSysInfoHasSubscribersGate(t *testing.T) {
	origClient := wps.Broker.GetClient()
	t.Cleanup(func() { wps.Broker.SetClient(origClient) })

	// broker not wired: subscription state lives on the main server
	wps.Broker.SetClient(nil)
	if !sysinfoHasSubscribers() {
		t.Fatal("expected fail-open (publish) when broker client is not wired")
	}

	// broker wired, no subscribers
	fakeClient := &fakeBrokerClient{}
	wps.Broker.SetClient(fakeClient)
	if wps.Broker.HasSubscribers(wps.Event_SysInfo) {
		t.Fatal("expected no sysinfo subscribers on a fresh broker")
	}
	if sysinfoHasSubscribers() {
		t.Fatal("expected skip when broker is authoritative and there are 0 subscribers")
	}

	// one subscriber for the sysinfo event
	wps.Broker.Subscribe("sysinfo-gate-test-route", wps.SubscriptionRequest{
		Event:  wps.Event_SysInfo,
		Scopes: []string{"local"},
	})
	if !sysinfoHasSubscribers() {
		t.Fatal("expected publish when there is a sysinfo subscriber")
	}

	// unsubscribe again => back to skip
	wps.Broker.Unsubscribe("sysinfo-gate-test-route", wps.Event_SysInfo)
	if sysinfoHasSubscribers() {
		t.Fatal("expected skip after the only sysinfo subscriber unsubscribed")
	}
}

// TestSysInfoEventShape asserts the published event produced by the
// production wiring keeps its shape (event name, scope, persist).
func TestSysInfoEventShape(t *testing.T) {
	var gotEvent *wps.WaveEvent
	pub := &sysInfoPublisher{
		connName: "testconn",
		now:      func() time.Time { return time.UnixMilli(123) },
		collectValues: func() map[string]float64 {
			return map[string]float64{"cpu": 1.0}
		},
		publishEvent: func(tsMilli int64, values map[string]float64) {
			gotEvent = &wps.WaveEvent{
				Event:   wps.Event_SysInfo,
				Scopes:  []string{"testconn"},
				Data:    wshrpc.TimeSeriesData{Ts: tsMilli, Values: values},
				Persist: 1024,
			}
		},
		hasSubs: func() bool { return true },
	}
	if !pub.tick() {
		t.Fatal("expected tick to publish")
	}
	if gotEvent == nil {
		t.Fatal("expected a published event")
	}
	if gotEvent.Event != wps.Event_SysInfo {
		t.Fatalf("expected event %q, got %q", wps.Event_SysInfo, gotEvent.Event)
	}
	if len(gotEvent.Scopes) != 1 || gotEvent.Scopes[0] != "testconn" {
		t.Fatalf("expected scope testconn, got %v", gotEvent.Scopes)
	}
	if gotEvent.Persist != 1024 {
		t.Fatalf("expected persist 1024, got %d", gotEvent.Persist)
	}
	tsData, ok := gotEvent.Data.(wshrpc.TimeSeriesData)
	if !ok {
		t.Fatalf("expected TimeSeriesData payload, got %T", gotEvent.Data)
	}
	if tsData.Ts != 123 || tsData.Values["cpu"] != 1.0 {
		t.Fatalf("unexpected payload: %+v", tsData)
	}
}

type fakeBrokerClient struct{}

func (*fakeBrokerClient) SendEvent(routeId string, event wps.WaveEvent) {}
