-- Rolling back the watermark only loses sync bookkeeping: every item becomes "pending" again and
-- the next run re-pushes the full set (which is what the engine did before watermarks existed).
-- The items themselves live in db_common_text and are untouched here.
DROP INDEX IF EXISTS idx_common_text_sync_syncedat;
DROP TABLE IF EXISTS db_common_text_sync;
