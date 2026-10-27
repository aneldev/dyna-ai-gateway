# Workspace — building and testing the packages

The pnpm workspace of the AI gateway and its storage adapters. Each package under `packages/` is built from
[dyna-ts-module-boilerplate](https://github.com/aneldev/dyna-ts-module-boilerplate) and published on its own; the
tooling (TypeScript, ESLint, Jest, webpack) is installed and configured once, at the root, and every package extends it.

| Package                                                                      | What                                                                                                                               | Status    |
|------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|-----------|
| [`dyna-ai-gateway`](../packages/dyna-ai-gateway/README.md)                   | the gateway: `ask` / `run`, tools, human gate, KB, memory, usage control, traces, the Vercel UI entry; in-memory adapters included | published |
| [`dyna-ai-gateway-mongodb`](../packages/dyna-ai-gateway-mongodb/README.md)   | MongoDB repositories and the Atlas Vector Search index                                                                             | planned   |
| [`dyna-ai-gateway-postgres`](../packages/dyna-ai-gateway-postgres/README.md) | PostgreSQL repositories                                                                                                            | planned   |
| [`dyna-ai-gateway-s3`](../packages/dyna-ai-gateway-s3/README.md)             | S3 blob store for the files                                                                                                        | planned   |

Documentation of the gateway: [`README.md`](README.md).

## Requirements

- Node.js 24, pnpm 10

## Commands (repo root, every package)

```bash
pnpm install
pnpm test-no-coverage   # all packages; real-provider tests run only when their keys are in the repo-root .env (see .env.sample)
pnpm lint
pnpm typecheck          # tsc over sources and tests of every package
pnpm build              # every package: lint + typecheck + dist (CJS, ESM, .d.ts)
pnpm sandbox-cli <ask|run> / pnpm sandbox-debug   # the gateway's developer sandbox
```

One package: `pnpm --filter dyna-ai-gateway <script> [args]`, or run the script inside `packages/<name>/`.

## Shared configuration

| Root file                                                                 | Extended by every package as                                                        |
|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `tsconfig.base.json`                                                      | `tsconfig.json` (`extends`, adds `rootDir`, `outDir`, `include`, `exclude`)         |
| `.eslintrc.js` (+ `.eslintrc.base.js`)                                    | `.eslintrc.js` (`extends`, adds the package's own overrides)                        |
| `jest.config.base.js`, `jest.setup.ts`                                    | `jest.config.js` (one `require`)                                                    |
| `webpack.dist.config.base.js`, `webpack.loaders.js`, `webpack.plugins.js` | `webpack.dist.config.js` (one call with the package folder and its subpath entries) |
| `babel.config.json`                                                       | found by babel-loader (`rootMode: "upward"`)                                        |

A new package: copy the folder of an adapter package, rename it in its `package.json`, and it is in the workspace.
