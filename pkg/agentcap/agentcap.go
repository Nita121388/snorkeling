// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcap

import "strings"

const DataGuideCommand = "wsh data guide"

const guideText = `
Snorkeling Agent Data Guide

Purpose
- Use wsh data as the supported write path for Snorkeling AI session notes, session tags, and Common Text.
- Do not write directly to Snorkeling SQLite databases.
- Prefer dry-run reports and explicit user confirmation over implicit edits.

Discovery
- This guidance is loaded on demand. It is not added to every AI chat or terminal agent by default.
- Start with: wsh data guide
- Get the patch JSON schema: wsh data schema
- Get copyable examples: wsh data examples
- Get a compact prompt for another AI/agent: wsh data prompt
- Import the compact prompt into the current Wave AI chat only when needed: wsh data import-ai

Workflow
1. Export current data:
   wsh data export --domain sessions --out sessions.json
   wsh data export --domain commontext --out commontext.json
   wsh data export --domain all --out snorkeling-data.json
2. Build a JSON patch with version 1 and an operations array.
3. Always preview first:
   wsh data apply --dry-run patch.json
   wsh data apply --dry-run patch.json --format summary
4. Apply only after explicit confirmation:
   wsh data apply patch.json --yes
   wsh data apply patch.json --yes --format summary

Supported Operations
- session_note.update: update a session note and/or tags.
- common_text.update: update Common Text title, text/content, and/or tags.
- tag.rename: rename a tag in sessions, common_text, or all.

Concurrency Safety
- Real session_note.update and common_text.update operations require expectedHash or expectedUpdatedAt from a fresh export.
- Dry-run may omit preconditions, but it will warn.
- tag.rename does not require per-record preconditions.

Tag Rules
- tags.set replaces tags; tags.set: [] explicitly clears tags.
- tags.add and tags.remove make incremental changes.
- Unknown operation fields and unknown tags fields are rejected.

Backups And Audit
- Real apply creates SQLite backups before writing.
- If a later operation fails, Snorkeling attempts a table-level restore from that apply's backups.
- Real apply writes an audit entry under agent-data/audit/patch-audit.jsonl.
- Use wsh data backup list and wsh data backup prune to inspect or prune patch backups.
`

const patchSchemaJSON = `
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://snorkeling.local/schemas/agent-data-patch-v1.json",
  "title": "Snorkeling Agent Data Patch",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "operations"],
  "properties": {
    "version": {
      "const": 1
    },
    "source": {
      "type": "string"
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "oneOf": [
          { "$ref": "#/$defs/sessionNoteUpdate" },
          { "$ref": "#/$defs/commonTextUpdate" },
          { "$ref": "#/$defs/tagRename" }
        ]
      }
    }
  },
  "$defs": {
    "tags": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "set": {
          "type": "array",
          "items": { "type": "string" }
        },
        "add": {
          "type": "array",
          "items": { "type": "string" }
        },
        "remove": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "sessionNoteUpdate": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "sessionKey"],
      "properties": {
        "type": {
          "const": "session_note.update"
        },
        "sessionKey": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "tags": {
          "$ref": "#/$defs/tags"
        },
        "expectedHash": {
          "type": "string"
        },
        "expectedUpdatedAt": {
          "type": "integer"
        }
      }
    },
    "commonTextUpdate": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "id"],
      "properties": {
        "type": {
          "const": "common_text.update"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "tags": {
          "$ref": "#/$defs/tags"
        },
        "expectedHash": {
          "type": "string"
        },
        "expectedUpdatedAt": {
          "type": "integer"
        }
      }
    },
    "tagRename": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "domain", "from", "to"],
      "properties": {
        "type": {
          "const": "tag.rename"
        },
        "domain": {
          "enum": ["session", "sessions", "common_text", "commontext", "all"]
        },
        "from": {
          "type": "string"
        },
        "to": {
          "type": "string"
        }
      }
    }
  }
}
`

const examplesText = `
Snorkeling Agent Data Patch Examples

Safety:
- Do not edit Snorkeling SQLite databases directly.
- Use these examples only with wsh data apply dry-run/apply.

Export data:

  wsh data export --domain sessions --out sessions.json
  wsh data export --domain commontext --out commontext.json
  wsh data export --domain all --out snorkeling-data.json

Update a session note and tags:

  {
    "version": 1,
    "source": "agent",
    "operations": [
      {
        "type": "session_note.update",
        "sessionKey": "codex:SESSION_ID:/path/to/session.jsonl",
        "note": "Reviewed and summarized.",
        "tags": { "add": ["reviewed"], "remove": ["todo"] },
        "expectedHash": "hash-from-export"
      }
    ]
  }

Update a Common Text item:

  {
    "version": 1,
    "source": "agent",
    "operations": [
      {
        "type": "common_text.update",
        "id": "88888888-8888-8888-8888-888888888888",
        "title": "Research prompt",
        "content": "New reusable prompt text.",
        "tags": { "set": ["prompt", "research"] },
        "expectedUpdatedAt": 1700000000000
      }
    ]
  }

Rename a tag everywhere:

  {
    "version": 1,
    "source": "agent",
    "operations": [
      {
        "type": "tag.rename",
        "domain": "all",
        "from": "todo",
        "to": "next"
      }
    ]
  }

Preview and apply:

  wsh data apply --dry-run patch.json --format summary
  wsh data apply patch.json --yes --format summary

Inspect backups:

  wsh data backup list --format summary
  wsh data backup prune --dry-run --format summary
`

const externalAgentPrompt = `
You are working with Snorkeling local data.

This guidance was loaded on demand for this task. Do not assume every task needs Snorkeling-specific context.

Rules:
- Do not edit Snorkeling SQLite databases directly.
- Use wsh data for AI session notes, session tags, and Common Text edits.
- Export current data before creating a patch.
- Run a dry-run before any real apply.
- Apply only after explicit user confirmation.
- For update operations, use expectedHash or expectedUpdatedAt from a fresh export.

Start here:
  wsh data guide
  wsh data schema
  wsh data examples

Recommended workflow:
  wsh data export --domain all --out snorkeling-data.json
  wsh data apply --dry-run patch.json --format summary
  wsh data apply patch.json --yes --format summary
`

func GuideText() string {
	return withTrailingNewline(guideText)
}

func SchemaText() string {
	return withTrailingNewline(patchSchemaJSON)
}

func ExamplesText() string {
	return withTrailingNewline(examplesText)
}

func ExternalAgentPrompt() string {
	return withTrailingNewline(externalAgentPrompt)
}

func withTrailingNewline(text string) string {
	return strings.TrimSpace(text) + "\n"
}
