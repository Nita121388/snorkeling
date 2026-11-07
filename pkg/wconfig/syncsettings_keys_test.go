package wconfig

import "testing"

// 确认 agent 通道（wsh setconfig → SetBaseConfigValue）认这些同步键：
// 键名拼错会被 getConfigKeyType 静默跳过，那才是最难查的失败。
func TestSyncSettingKeysAreKnown(t *testing.T) {
	keys := []string{
		"commontext:sync:transport",
		"commontext:sync:conflictpolicy",
		"commontext:sync:devicename",
		"commontext:sync:deviceid",
		"commontext:sync:folder:path",
		"commontext:sync:folder:watch",
		"commontext:sync:git:remote",
		"commontext:sync:git:interval",
		"commontext:sync:git:hastoken",
		"commontext:sync:server:url",
		"commontext:sync:server:pushmode",
		"commontext:sync:server:hastoken",
		"commontext:sync:server:allowinsecure",
		"commontext:sync:synctombstones",
	}
	for _, key := range keys {
		if getConfigKeyType(key) == nil {
			t.Errorf("setting key %q is not in SettingsType (agent-written values would be dropped)", key)
		}
	}
}
