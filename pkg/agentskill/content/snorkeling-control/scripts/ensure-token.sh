#!/usr/bin/env sh
# Checks that an agent token exists and is readable. Prints the exact command the
# user must run when it is missing — it never creates one and never guesses a
# credential.
set -eu

TOKEN_FILE="${SNORKELING_AGENT_TOKEN_FILE:-$HOME/.config/snorkeling/agent-token.json}"

if [ ! -f "$TOKEN_FILE" ]; then
  cat >&2 <<MSG
No agent token at: $TOKEN_FILE

Ask the user to run this inside a Snorkeling block:

  wsh auth grant --name <agent-name> --scope observe --ttl 30m --out "$TOKEN_FILE"

Then export:
  export SNORKELING_AGENT_TOKEN_FILE="$TOKEN_FILE"
MSG
  exit 1
fi

# Never print the token: only check that the field is present.
if ! grep -q '"token"[[:space:]]*:[[:space:]]*"' "$TOKEN_FILE" 2>/dev/null; then
  echo "Token file exists but has no token field: $TOKEN_FILE" >&2
  exit 1
fi

echo "token file ok: $TOKEN_FILE"
