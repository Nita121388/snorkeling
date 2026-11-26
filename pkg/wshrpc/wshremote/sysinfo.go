// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"log"
	"strconv"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const BYTES_PER_GB = 1073741824

// sysinfoPersistCount is the number of sysinfo frames kept in broker history
// for late subscribers (EventReadHistoryCommand backfill).
const sysinfoPersistCount = 1024

func getCpuData(values map[string]float64) {
	percentArr, err := cpu.Percent(0, false)
	if err != nil {
		return
	}
	if len(percentArr) > 0 {
		values[wshrpc.TimeSeries_Cpu] = percentArr[0]
	}
	percentArr, err = cpu.Percent(0, true)
	if err != nil {
		return
	}
	for idx, percent := range percentArr {
		values[wshrpc.TimeSeries_Cpu+":"+strconv.Itoa(idx)] = percent
	}
}

func getMemData(values map[string]float64) {
	memData, err := mem.VirtualMemory()
	if err != nil {
		return
	}
	values["mem:total"] = float64(memData.Total) / BYTES_PER_GB
	values["mem:available"] = float64(memData.Available) / BYTES_PER_GB
	values["mem:used"] = float64(memData.Used) / BYTES_PER_GB
	values["mem:free"] = float64(memData.Free) / BYTES_PER_GB
}

// sysInfoPublisher produces one sysinfo frame per tick for connName.
// Every dependency is injectable so the gate/collection/publish behavior can
// be asserted deterministically in tests (fake clock, collector, publish sink).
type sysInfoPublisher struct {
	connName      string
	now           func() time.Time
	collectValues func() map[string]float64
	publishEvent  func(tsMilli int64, values map[string]float64)
	hasSubs       func() bool
}

// tick publishes one frame and reports whether it did. When the subscription
// gate says nobody is listening, CPU/Mem are *not* collected and nothing is
// published; the loop itself keeps running so a late subscriber resumes within
// one second.
func (p *sysInfoPublisher) tick() bool {
	if p.hasSubs != nil && !p.hasSubs() {
		return false
	}
	values := p.collectValues()
	p.publishEvent(p.now().UnixMilli(), values)
	return true
}

// sysinfoHasSubscribers reports whether any route currently listens for
// sysinfo events.
//
// Fail-open contract (hard requirement): when subscription state is not
// observable from this process we MUST publish. That is the remote connserver
// case — RunSysInfoLoop runs on the remote host, but all EventSub/EventUnsub
// bookkeeping happens on the main server's wps.Broker, and a connserver never
// wires a broker client. Treating "no local broker client" as "no subscribers"
// would starve every remote sysinfo block, so the gate only applies when this
// process owns the authoritative broker (the main server wires
// wps.Broker.SetClient(DefaultRouter) in createMainWshClient).
//
// The broker exposes an event-level check (not per-scope), which is the safe
// direction: a subscriber for any sysinfo scope keeps every loop publishing,
// so the gate can only ever over-publish, never under-publish.
func sysinfoHasSubscribers() bool {
	if wps.Broker.GetClient() == nil {
		return true
	}
	return wps.Broker.HasSubscribers(wps.Event_SysInfo)
}

// makeSysInfoPublisher wires the production collector/publisher for one
// connection (local or remote).
func makeSysInfoPublisher(client *wshutil.WshRpc, connName string) *sysInfoPublisher {
	return &sysInfoPublisher{
		connName: connName,
		now:      time.Now,
		collectValues: func() map[string]float64 {
			values := make(map[string]float64)
			getCpuData(values)
			getMemData(values)
			return values
		},
		publishEvent: func(tsMilli int64, values map[string]float64) {
			event := wps.WaveEvent{
				Event:   wps.Event_SysInfo,
				Scopes:  []string{connName},
				Data:    wshrpc.TimeSeriesData{Ts: tsMilli, Values: values},
				Persist: sysinfoPersistCount,
			}
			wshclient.EventPublishCommand(client, event, &wshrpc.RpcOpts{NoResponse: true})
		},
		hasSubs: sysinfoHasSubscribers,
	}
}

func RunSysInfoLoop(client *wshutil.WshRpc, connName string) {
	defer func() {
		log.Printf("sysinfo loop ended conn:%s\n", connName)
	}()
	publisher := makeSysInfoPublisher(client, connName)
	for {
		publisher.tick()
		time.Sleep(1 * time.Second)
	}
}
