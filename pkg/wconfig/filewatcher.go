// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const defaultConfigDebounceDelay = 150 * time.Millisecond

var instance *Watcher
var once sync.Once

type ConfigUpdateHandler func(FullConfigType)

type Watcher struct {
	initialized   bool
	watcher       *fsnotify.Watcher
	mutex         sync.Mutex
	fullConfig    FullConfigType
	handlers      []ConfigUpdateHandler
	debounceTimer *time.Timer
	debounceDelay time.Duration
}

type WatcherUpdate struct {
	FullConfig FullConfigType `json:"fullconfig"`
}

// GetWatcher returns the singleton instance of the Watcher
func GetWatcher() *Watcher {
	once.Do(func() {
		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			log.Printf("failed to create file watcher: %v", err)
			return
		}
		configDirAbsPath := wavebase.GetWaveConfigDir()
		log.Printf("create config watcher, configdir=%q", configDirAbsPath)
		instance = &Watcher{watcher: watcher}
		err = instance.watcher.Add(configDirAbsPath)
		const failedStr = "failed to add path %s to watcher: %v"
		if err != nil {
			log.Printf(failedStr, configDirAbsPath, err)
		}

		subdirs := GetConfigSubdirs()
		for _, dir := range subdirs {
			err = instance.watcher.Add(dir)
			if err != nil && !os.IsNotExist(err) {
				log.Printf(failedStr, dir, err)
			}
		}
	})
	return instance
}

func (w *Watcher) Start() {
	w.mutex.Lock()
	log.Printf("starting file watcher\n")
	w.initialized = true
	w.mutex.Unlock()

	w.reloadAndBroadcast()

	go func() {
		defer func() {
			panichandler.PanicHandler("filewatcher:Start", recover())
		}()
		for {
			select {
			case event, ok := <-w.watcher.Events:
				if !ok {
					return
				}
				w.handleEvent(event)
			case err, ok := <-w.watcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()
}

func (w *Watcher) Close() {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	if w.debounceTimer != nil {
		w.debounceTimer.Stop()
		w.debounceTimer = nil
	}
	if w.watcher != nil {
		w.watcher.Close()
		w.watcher = nil
		log.Println("file watcher closed")
	}
}

func (w *Watcher) broadcast(message WatcherUpdate) {
	w.mutex.Lock()
	handlers := append([]ConfigUpdateHandler(nil), w.handlers...)
	w.mutex.Unlock()
	w.broadcastWithHandlers(message, handlers)
}

func (w *Watcher) broadcastWithHandlers(message WatcherUpdate, handlers []ConfigUpdateHandler) {
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_Config,
		Data:  message,
	})
	for _, handler := range handlers {
		go func(h ConfigUpdateHandler) {
			defer func() {
				panichandler.PanicHandler("filewatcher:notifyHandlers", recover())
			}()
			h(message.FullConfig)
		}(handler)
	}
}

func (w *Watcher) RegisterUpdateHandler(handler ConfigUpdateHandler) {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	w.handlers = append(w.handlers, handler)
}

func (w *Watcher) GetFullConfig() FullConfigType {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	return w.fullConfig
}

func (w *Watcher) reloadAndBroadcast() {
	// ReadFullConfig hits disk + SQLite; run outside w.mutex so GetFullConfig() never stalls.
	fullConfig := ReadFullConfig()
	w.mutex.Lock()
	if !w.initialized {
		w.mutex.Unlock()
		return
	}
	w.fullConfig = fullConfig
	handlers := append([]ConfigUpdateHandler(nil), w.handlers...)
	w.mutex.Unlock()
	w.broadcastWithHandlers(WatcherUpdate{FullConfig: fullConfig}, handlers)
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	fileName := filepath.ToSlash(event.Name)
	if event.Op == fsnotify.Chmod {
		return
	}
	if !isValidSubSettingsFileName(fileName) {
		return
	}
	w.scheduleReload()
}

func (w *Watcher) scheduleReload() {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	delay := w.debounceDelay
	if delay <= 0 {
		delay = defaultConfigDebounceDelay
	}
	if w.debounceTimer != nil {
		w.debounceTimer.Reset(delay)
		return
	}
	w.debounceTimer = time.AfterFunc(delay, func() {
		defer func() {
			panichandler.PanicHandler("filewatcher:debouncedReload", recover())
		}()
		w.mutex.Lock()
		w.debounceTimer = nil
		w.mutex.Unlock()
		w.reloadAndBroadcast()
	})
}

var validFileRe = regexp.MustCompile(`^[a-zA-Z0-9_@.-]+\.json$`)

func isValidSubSettingsFileName(fileName string) bool {
	if filepath.Ext(fileName) != ".json" {
		return false
	}
	baseName := filepath.Base(fileName)
	return validFileRe.MatchString(baseName)
}

func BroadcastConfigUpdate() {
	if instance == nil {
		return
	}
	instance.reloadAndBroadcast()
}
