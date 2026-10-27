#!/usr/bin/env sh
# AIGateway debugger session on the config of sandbox.config.ts. Usage: ./sandbox.debug.sh   (see README.md, "Debugging")
# Runs sandbox.debug.ts under the Node inspector (ts-node, CommonJS, source maps): the gateway is the global `dynaEnv.aiGateway`;
# attach WebStorm ("Attach to Node.js/Chrome", port 9229) or Chrome (chrome://inspect) and call it from the console.
# Output mode "debug" (utils/devOutputMode.ts): the dev-tools console, objects printed as objects, no colours.
cd "$(dirname "$0")" || exit 1
export AIGATEWAY_DEV_OUTPUT_MODE=DEBUG
export NO_COLOR=1
export TS_NODE_TRANSPILE_ONLY=true
export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","sourceMap":true}'
exec node --inspect=9229 --enable-source-maps -r ts-node/register sandbox.debug.ts "$@"
