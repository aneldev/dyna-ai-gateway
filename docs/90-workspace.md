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

- Node.js 24 or newer, pnpm 10

## Private notes (`docs/internal/`)

The analysis the library is built from (the Roadmap, the Classes contracts, the Blueprint) is private and lives outside
the repo. The repo expects it at `docs/internal/`, a **symlink** that git ignores; a fresh clone has none, so create it
once per machine, with your own path to the notes:

```bash
ln -s /path-to/docs/internal
ls docs/internal/     # AI Gateway Roadmap.md, AI Gateway Classes.md, AI Gateway Blueprint.md, …
```

Never commit the link or write its target into a tracked file: the path names your machine.

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

## Release

```bash
npm login                       # once per machine; the release aborts when the npm token is missing or expired
pnpm release [package-name]     # default: dyna-ai-gateway
```

`pnpm release` (`scripts/release.mjs`) runs the whole release of one package and aborts at the first failing step:

1. Guards: logged in to npm, clean working tree, entries present under `## [Unreleased]` in the package's `CHANGELOG.md`.
2. Bumps the version: the prerelease while the version has a prerelease suffix (`0.0.1-beta.4` → `0.0.1-beta.5`),
   the patch otherwise (`0.1.2` → `0.1.3`). A minor or major bump is done by hand in `package.json` before the release.
3. Moves the `[Unreleased]` entries under the new version with today's date.
4. Commits `Release <package> v<version>` and tags it `<package>@<version>`.
5. Publishes: the package's `prepublishOnly` builds it, its `publishConfig.tag` picks the npm dist-tag (`beta` while in beta).
6. Pushes the branch and the tag.

A failure after the commit leaves the commit and the tag local: `git reset --hard HEAD~1 && git tag -d <tag>` undoes them.

## Shared configuration

| Root file                                                                 | Extended by every package as                                                        |
|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `tsconfig.base.json`                                                      | `tsconfig.json` (`extends`, adds `rootDir`, `outDir`, `include`, `exclude`)         |
| `.eslintrc.js` (+ `.eslintrc.base.js`)                                    | `.eslintrc.js` (`extends`, adds the package's own overrides)                        |
| `jest.config.base.js`, `jest.setup.ts`                                    | `jest.config.js` (one `require`)                                                    |
| `webpack.dist.config.base.js`, `webpack.loaders.js`, `webpack.plugins.js` | `webpack.dist.config.js` (one call with the package folder and its subpath entries) |
| `babel.config.json`                                                       | found by babel-loader (`rootMode: "upward"`)                                        |

A new package: copy the folder of an adapter package, rename it in its `package.json`, and it is in the workspace.