// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"reflect"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var (
	rtInfoStore = make(map[waveobj.ORef]*waveobj.ObjRTInfo)
	rtInfoMutex sync.RWMutex
)

// rtInfoTagMapCache caches the json-tag -> field-index map per reflect.Type.
// Each map is built once and never mutated afterwards, so sharing it across
// concurrent SetRTInfo callers is safe without extra locking (the cache
// itself is a sync.Map).
var rtInfoTagMapCache sync.Map // reflect.Type -> map[string]int

// getRTInfoTagMap returns the (cached) json tag -> field index map for rtype.
// It replaces the per-call map rebuild SetRTInfo used to do while holding the
// global rtInfo mutex.
func getRTInfoTagMap(rtype reflect.Type) map[string]int {
	if cached, ok := rtInfoTagMapCache.Load(rtype); ok {
		return cached.(map[string]int)
	}
	tagMap := make(map[string]int, rtype.NumField())
	for i := 0; i < rtype.NumField(); i++ {
		field := rtype.Field(i)
		jsonTag := field.Tag.Get("json")
		if jsonTag == "" {
			continue
		}
		// Remove omitempty and other options
		tagParts := strings.Split(jsonTag, ",")
		if len(tagParts) > 0 && tagParts[0] != "" {
			tagMap[tagParts[0]] = i
		}
	}
	actual, _ := rtInfoTagMapCache.LoadOrStore(rtype, tagMap)
	return actual.(map[string]int)
}

func setFieldValue(fieldValue reflect.Value, value any) {
	if value == nil {
		fieldValue.Set(reflect.Zero(fieldValue.Type()))
		return
	}

	if valueStr, ok := value.(string); ok && fieldValue.Kind() == reflect.String {
		fieldValue.SetString(valueStr)
		return
	}

	if valueBool, ok := value.(bool); ok && fieldValue.Kind() == reflect.Bool {
		fieldValue.SetBool(valueBool)
		return
	}

	if fieldValue.Kind() >= reflect.Int && fieldValue.Kind() <= reflect.Int64 {
		switch v := value.(type) {
		case int:
			fieldValue.SetInt(int64(v))
		case int64:
			fieldValue.SetInt(v)
		case int32:
			fieldValue.SetInt(int64(v))
		case float64:
			fieldValue.SetInt(int64(v))
		}
		return
	}

	if fieldValue.Kind() == reflect.Map {
		if fieldValue.Type().Key().Kind() == reflect.String && fieldValue.Type().Elem().Kind() == reflect.Float64 {
			if inputMap, ok := value.(map[string]any); ok {
				outputMap := make(map[string]float64)
				for k, v := range inputMap {
					if floatVal, ok := v.(float64); ok {
						outputMap[k] = floatVal
					}
				}
				fieldValue.Set(reflect.ValueOf(outputMap))
			}
			return
		}

		if fieldValue.Type().Key().Kind() == reflect.String && fieldValue.Type().Elem().Kind() == reflect.String {
			if inputMap, ok := value.(map[string]any); ok {
				outputMap := make(map[string]string)
				for k, v := range inputMap {
					if strVal, ok := v.(string); ok {
						outputMap[k] = strVal
					}
				}
				fieldValue.Set(reflect.ValueOf(outputMap))
			}
			return
		}
		return
	}

	if fieldValue.Kind() == reflect.Interface {
		fieldValue.Set(reflect.ValueOf(value))
	}
}

// SetRTInfo merges the provided info map into the ObjRTInfo for the given ORef.
// Only updates fields that exist in the ObjRTInfo struct.
// Removes fields that have nil values.
func SetRTInfo(oref waveobj.ORef, info map[string]any) {
	rtInfoMutex.Lock()
	defer rtInfoMutex.Unlock()

	rtInfo, exists := rtInfoStore[oref]
	if !exists {
		rtInfo = &waveobj.ObjRTInfo{}
		rtInfoStore[oref] = rtInfo
	}

	rtInfoValue := reflect.ValueOf(rtInfo).Elem()

	// Cached json tag -> field index lookup (per reflect.Type, built once)
	jsonTagToField := getRTInfoTagMap(rtInfoValue.Type())

	// Merge the info map into the struct
	for key, value := range info {
		fieldIndex, exists := jsonTagToField[key]
		if !exists {
			continue // Skip keys that don't exist in the struct
		}

		fieldValue := rtInfoValue.Field(fieldIndex)
		if !fieldValue.CanSet() {
			continue
		}

		setFieldValue(fieldValue, value)
	}
}

// GetRTInfo returns the ObjRTInfo for the given ORef, or nil if not found
func GetRTInfo(oref waveobj.ORef) *waveobj.ObjRTInfo {
	rtInfoMutex.RLock()
	defer rtInfoMutex.RUnlock()

	if rtInfo, exists := rtInfoStore[oref]; exists {
		// Return a copy to avoid external modification
		copy := *rtInfo
		return &copy
	}
	return nil
}

// DeleteRTInfo removes the ObjRTInfo for the given ORef
func DeleteRTInfo(oref waveobj.ORef) {
	rtInfoMutex.Lock()
	defer rtInfoMutex.Unlock()

	delete(rtInfoStore, oref)
}
