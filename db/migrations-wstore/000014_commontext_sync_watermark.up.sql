-- Per-item sync watermark for Common Text.
--
-- Why a separate table and not a column on db_common_text: the renderer writes the whole
-- `commontext:items` array back on every save (pin toggle, rename, usage bump), and the array it
-- holds predates the last sync. A watermark column on that row would be reset to the renderer's
-- stale copy on every UI save, which reads as "synced items turn pending again by themselves".
-- A separate table is not touched by the full-table write path at all.
--
-- syncedupdatedat stores the item's OWN updatedat at the moment the remote confirmed it. It is
-- deliberately not "the local clock when sync ran": items created on another machine carry that
-- machine's clock, and comparing a foreign updatedat against a local now() is meaningless.
--
-- syncedrev / syncedat are informational: syncedrev drives the "remote was reset" self-heal,
-- syncedat is there for the status panel and for debugging a stuck item.
CREATE TABLE IF NOT EXISTS db_common_text_sync (
    id              text PRIMARY KEY,
    syncedrev       real NOT NULL DEFAULT 0,
    syncedupdatedat real NOT NULL DEFAULT 0,
    syncedat        real NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_common_text_sync_syncedat ON db_common_text_sync (syncedat);
