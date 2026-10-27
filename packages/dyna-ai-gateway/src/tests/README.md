# Tests of the AIGateway

The gateway's behaviour, one test per file, each with the `IAIGatewayConfig` it runs on in a sibling file. A test is a recipe:
a developer opens it to see one behaviour, and replays its config in the sandbox (`src/dev-sandbox/README.md`).

## Writing a test

Invoke the skill **`write-gateway-tests`** (`.claude/skills/write-gateway-tests/SKILL.md`) — it holds the rules (one test per file,
the sibling config, deterministic vs real-provider tests, the checklist). This README only says where things are.

## Layout

```
src/tests/
├─ <feature>/                       one folder per feature: ask, run, human-gate, memory, knowledge-base, guardrails, trace, usage, files, threads, gateway
│  ├─ <behaviour>.test.ts           a deterministic test (FakeLLMClient, no key needed)
│  ├─ <behaviour>.real.test.ts      a test on a real provider (gated: runs when the key is in .env, skipped otherwise)
│  ├─ <scenario>.config.ts          the IAIGatewayConfig of the test(s) next to it, exported as gatewayConfig<Scenario>
│  │                                (.real.config.ts when only real tests use it); tests of one scenario may share one
│  └─ <scenario>.config.readme.md   the readme of a config that carries a story (data, tools, gates): what it offers, the use cases,
│                                   the tests on it, how to replay it in the sandbox. Readmes belong to configs, never to tests
└─ internal/
   ├─ samples/                      the data the configs are built from: models, sampleUser / sampleProfile, tools, kbDocuments
   ├─ fakes/                        FakeLLMClient: the scripted model of the deterministic tests (its own tests in fakes/tests/)
   ├─ eval/                         the knowledge-base retrieval evaluation
   └─ utils/
      ├─ gatewayConfigBase.ts       the config every scenario spreads: OpenAI gpt-5-mini, in-memory adapters, silent trace,
      │                             nothing switched on; the only caller of loadProviderCredentials (.env → providers)
      ├─ describeWithProvider.ts    the gate of a real test: describe or describe.skip by the provider's key
      ├─ sampleUserContext.ts       sampleUser with `now`
      ├─ loadToolResults.ts         the TOOL_RESULT parts of a thread
      └─ makeGateway.ts, makeGatewayConfig.ts, makeToolGateway.ts   older helpers of the not-yet-converted tests; not for new tests
```

A test of one class or function lives next to its source instead: `src/internal/<module>/tests/`. The tests of the Vercel UI module
(`AIGatewayVercelUi`, `UiMapper`) are in `src/entries/vercel-ui/tests/`, on `vercel-ui.config.ts`.

## Running

```
pnpm test-no-coverage                      everything
pnpm test-no-coverage src/tests/run        one feature
pnpm test-no-coverage src/tests/run/tool-  files whose path starts so
```

Real-provider tests read `AIGATEWAY_TEST_<PROVIDER>_API_KEY` from the repo-root `.env` (copy `.env.sample`); a test whose key is
empty is skipped, never failed. They cost seconds and tokens each; the jest timeout is 60 s (`jest.setup.ts`).

## Replaying a test in the sandbox

Point `src/dev-sandbox/sandbox.config.ts` at the test's config and start `./sandbox.cli.sh run` (or `ask`), or `./sandbox.debug.sh`
for a debugger session: same models, profile, tools and adapters as the test, with every model call printed.
