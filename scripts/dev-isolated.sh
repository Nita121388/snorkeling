#!/usr/bin/env bash
# Run the snorkeling dev build fully sandboxed away from any other snorkeling/waveterm install.
# All user data (config/data/home) goes into <repo>/.runcfg, never into ~/.config/snorkeling* or
# ~/Library/Application Support/snorkeling*. Drop the .runcfg directory to fully reset dev state.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

RUNCFG="$PWD/.runcfg"
export WAVETERM_CONFIG_HOME="$RUNCFG/config"
export WAVETERM_DATA_HOME="$RUNCFG/data"
export WAVETERM_HOME="$RUNCFG/home"
mkdir -p "$WAVETERM_CONFIG_HOME" "$WAVETERM_DATA_HOME" "$WAVETERM_HOME"

# task electron:dev sets WAVETERM_ENVFILE={{.ROOT_DIR}}/.env, which wavesrv loads via godotenv.
# Mirror the three home overrides into .env so the Go backend sees the same roots as Electron.
cat > "$PWD/.env" <<EOF
WAVETERM_CONFIG_HOME=$WAVETERM_CONFIG_HOME
WAVETERM_DATA_HOME=$WAVETERM_DATA_HOME
WAVETERM_HOME=$WAVETERM_HOME
EOF

echo ">> isolated dev run"
echo ">> config: $WAVETERM_CONFIG_HOME"
echo ">> data:   $WAVETERM_DATA_HOME"
echo ">> home:   $WAVETERM_HOME"
echo ">> reset:  rm -rf $RUNCFG"
echo

exec task electron:dev "$@"
