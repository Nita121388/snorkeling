-- SQLite cannot drop columns before 3.35, and the app's migration runner only needs the
-- table to keep working. Rebuild the table without the sync columns instead.
CREATE TABLE db_common_text_old (
    id varchar(36) PRIMARY KEY,
    title text NOT NULL,
    text text NOT NULL,
    shortcut text,
    tags json NOT NULL DEFAULT '[]',
    pinned boolean NOT NULL DEFAULT 0,
    createdat int NOT NULL,
    updatedat int NOT NULL,
    lastusedat int,
    usagecount int NOT NULL DEFAULT 0
);

INSERT INTO db_common_text_old (id, title, text, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount)
SELECT id, title, text, shortcut, tags, pinned, createdat, updatedat, lastusedat, usagecount FROM db_common_text;

DROP TABLE db_common_text;

ALTER TABLE db_common_text_old RENAME TO db_common_text;
