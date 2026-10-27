# dyna-ai-gateway

Provider-agnostic AI gateway for Node.js (server-only): `ask` (grounded answers) and `run` (agent runs with tools, a human
approval gate and an optional review of the answer), knowledge base (RAG), thread and user memory, usage control by the application, guardrails, traces and streaming, on top of the
[Vercel AI SDK](https://ai-sdk.dev). Persistence is behind repository/adapter contracts; in-memory adapters are included.

```ts
import {AIGateway} from "dyna-ai-gateway";
import {AIGatewayVercelUi} from "dyna-ai-gateway/vercel-ui"; // the endpoints of a Vercel chat client (useChat)
```

- Documentation: `docs/README.md` (getting started, architecture, practices)
- Tests: `src/tests/README.md` · Sandbox for developers (chat and debugger on a test's config): `src/dev-sandbox/README.md`

## Requirements

- Node.js 24, pnpm 10
- Peer dependency: `zod` 4

## Development

```bash
pnpm install
pnpm test-no-coverage   # real-provider tests run only when their keys are in .env (see .env.sample)
pnpm lint
pnpm typecheck          # tsc over sources and tests (tsconfig.tests.json)
pnpm build              # lint + typecheck + dist/index.js (CJS) + dist/index.mjs (ESM) + .d.ts; dist/vercel-ui.js / .mjs for the subpath
```

Built from [dyna-ts-module-boilerplate](https://github.com/aneldev/dyna-ts-module-boilerplate); its guide is
`README.boilerplate.md`.
