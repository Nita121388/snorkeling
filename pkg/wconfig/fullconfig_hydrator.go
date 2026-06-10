// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import "sync"

type FullConfigHydrator func(*FullConfigType)

var fullConfigHydratorLock sync.Mutex
var fullConfigHydrators []FullConfigHydrator

func RegisterFullConfigHydrator(hydrator FullConfigHydrator) {
	if hydrator == nil {
		return
	}
	fullConfigHydratorLock.Lock()
	defer fullConfigHydratorLock.Unlock()
	fullConfigHydrators = append(fullConfigHydrators, hydrator)
}

func applyFullConfigHydrators(fullConfig *FullConfigType) {
	fullConfigHydratorLock.Lock()
	hydrators := append([]FullConfigHydrator(nil), fullConfigHydrators...)
	fullConfigHydratorLock.Unlock()

	for _, hydrator := range hydrators {
		hydrator(fullConfig)
	}
}
