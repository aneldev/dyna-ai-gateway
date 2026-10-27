#!/usr/bin/env sh
# AIGateway sandbox chat on the config of sandbox.config.ts. Usage: ./sandbox.cli.sh <ask|run>   (see README.md)
# Compiles and runs sandbox.cli.ts with the workspace-root ts-node (not npx: under `pnpm sandbox-cli` npm would warn about pnpm's npm_config_* env; not `pnpm exec`: it runs from the package root) from this folder (as CommonJS; the repo tsconfig emits ESM for webpack); the argument is validated by sandbox.cli.ts.
# Output mode "cli" (utils/devOutputMode.ts): a terminal, colours always.
cd "$(dirname "$0")" || exit 1
export AIGATEWAY_DEV_OUTPUT_MODE=CLI
export FORCE_COLOR=1
exec ../../../../node_modules/.bin/ts-node --transpile-only --compilerOptions '{"module":"commonjs"}' sandbox.cli.ts "$@"
