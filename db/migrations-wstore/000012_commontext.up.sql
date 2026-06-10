CREATE TABLE IF NOT EXISTS db_common_text (
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
