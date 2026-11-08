package commontextstore

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// 迁移必须真的把列建出来，否则代码里 SELECT 写对了也读不到（PRAGMA 是唯一可信来源）。
func TestSyncColumnsExistAfterMigration(t *testing.T) {
	resetCommonTextTestState(t, nil)
	var cols []struct {
		Cid       int    `db:"cid"`
		Name      string `db:"name"`
		Type      string `db:"type"`
		Notnull   int    `db:"notnull"`
		DfltValue any    `db:"dflt_value"`
		Pk        int    `db:"pk"`
	}
	if err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Select(&cols, `PRAGMA table_info(db_common_text)`)
		return nil
	}); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	have := map[string]bool{}
	for _, c := range cols {
		have[c.Name] = true
	}
	for _, want := range []string{"createdby_kind", "createdby_name", "origin_deviceid", "origin_devicename", "origin_platform", "rev", "deletedat"} {
		if !have[want] {
			t.Fatalf("column %q missing after migration; have %v", want, have)
		}
	}
}
