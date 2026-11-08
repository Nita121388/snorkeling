-- Sync metadata for Common Text.
--
-- All columns are nullable on purpose: rows written before sync existed keep NULL and the
-- read path fills defaults (human / local device / rev 0) without rewriting them. Adding
-- NOT NULL DEFAULT would force a full table rewrite on every existing install.
--
-- deletedat: NULL means alive, non-NULL is a tombstone timestamp. Tombstones have to travel
-- with the payload, otherwise the other machine would push a deleted item back.
ALTER TABLE db_common_text ADD COLUMN createdby_kind text;
ALTER TABLE db_common_text ADD COLUMN createdby_name text;
ALTER TABLE db_common_text ADD COLUMN origin_deviceid text;
ALTER TABLE db_common_text ADD COLUMN origin_devicename text;
ALTER TABLE db_common_text ADD COLUMN origin_platform text;
ALTER TABLE db_common_text ADD COLUMN rev integer NOT NULL DEFAULT 0;
ALTER TABLE db_common_text ADD COLUMN deletedat real;
-- Notion-style page icon for the item (empty = no icon).
ALTER TABLE db_common_text ADD COLUMN emoji text;
