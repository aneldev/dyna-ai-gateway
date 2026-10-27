---
name: write-gateway-tests
description: How to write a Jest test in dyna-ai-gateway — one test per file, folder per feature, the IAIGatewayConfig in a sibling <test>.config.ts (gatewayConfig<Scenario>, spreads gatewayConfigBase), FakeLLMClient for deterministic tests, gated real-provider tests (.real.) that stay stable. Use whenever you add or change a test in src/tests or in an internal tests/ folder, or when the developer says "write a test", "add a test", "test this".
---

# Tests in dyna-ai-gateway

The general Jest rules of `write-jest-tests` (one behaviour per test, output before interaction, no `any`, no `!`) apply. This skill adds what is specific to this repo. When they disagree, this skill wins. The layout is in `src/tests/README.md`.

## 1. One test per file

- **Every `test(...)` lives in its own file.** No second `test` in a file, no shared `describe` with several tests. The file is a recipe a developer opens to see or debug one behaviour, so it must be readable alone.
- A `describe` wraps the single test only to carry the gate (`describeWithProvider(...)`) or a title; otherwise a bare `test` is fine.
- Shared arrangement goes into a helper under `src/tests/internal/utils/` (or the `tests/utils/` of an internal folder), never into a shared test file.
- Old multi-test files still exist (`ask.test.ts`, `general.run.test.ts`, … on `makeGateway`); they are being converted file by file. A test added to such a topic goes into a new file next to it, on the new rules.

## 2. Where a test lives, how it is named

| Test of                                                                                                     | Folder                                                                                                                                                                  | File                                                                               |
|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| The gateway (`AIGateway` doors, a flow through several classes), deterministic                              | `src/tests/<feature>/` — one folder per feature (`ask`, `run`, `human-gate`, `memory`, `knowledge-base`, `guardrails`, `trace`, `usage`, `files`, `threads`, `gateway`) | `<behaviour-in-kebab-case>.test.ts`                                                |
| Same, on a real provider                                                                                    | the same feature folder                                                                                                                                                 | `<behaviour>.real.test.ts`                                                         |
| The config of the test(s)                                                                                   | next to them                                                                                                                                                            | `<scenario>.config.ts`, or `<scenario>.real.config.ts` when only real tests use it |
| A test of a named scenario (a config with its own data, tools and story, replayed in the sandbox for demos) | the same feature folder                                                                                                                                                 | `<scenario>--<behaviour>.test.ts` / `.real.test.ts` (double dash)                  |
| The readme of a config                                                                                      | next to the config, named after it                                                                                                                                      | `<scenario>.config.readme.md` / `<scenario>.real.config.readme.md`                 |
| One class or function                                                                                       | `tests/` next to the source, e.g. `src/internal/human-gate/tests/`                                                                                                      | `<Subject>.<behaviour>.test.ts`                                                    |

The file name states the behaviour, not the method: `tool-side-effect-pauses-for-approval.real.test.ts`, `input-rule-blocks-prompt.test.ts`. `.real` is in the name **only** when the test calls a real LLM.

A **named scenario** is a config worth a story of its own (`support-shop`: an orders DB, a gated refund tool, customer verification,
user questions, a guardrail). Every file of it starts with the scenario name, so the folder lists them together:
`support-shop.real.config.ts`, `support-shop.real.config.readme.md`, `support-shop--refund-above-50-pauses-and-the-edited-input-is-what-runs.real.test.ts`.
A scenario of one or two tests on a shared sample config (`tools.real.config.ts`) is not a named scenario; it keeps the plain names.

**Readmes belong to configs, never to tests.** A config is what one or more tests share, so it is the thing a reader needs explained:
`<scenario>.real.config.readme.md` (named after the config file) says what the config offers (data, tools, profile rules, gates,
guardrails), the use cases with the prompt that triggers each and what happens, the tests that run on it (one line each), how to
replay it in the sandbox (the console calls, what to look at), things to try. A test has no readme: everything about the one
behaviour it pins is its JSDoc and its name, and a second file would only repeat them. A config that is a two-line spread of
`gatewayConfigBase` needs no readme either; write one when the config carries a story.

## 3. The config is the test's sibling `.config.ts`

Every test that instantiates the `AIGateway` has its `IAIGatewayConfig` in a sibling file, exported as **`gatewayConfig<Scenario>`**. It spreads `gatewayConfigBase` (`src/tests/internal/utils/gatewayConfigBase.ts`: OpenAI `gpt-5-mini`, in-memory adapters, silent trace, nothing switched on, the provider keys from `.env`) and overrides **only what the test is about**:

```ts
// src/tests/run/tools.real.config.ts
export const gatewayConfigTools: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [{...sampleProfile, promptAddendum, allowedTools: [getCurrentTimeTool.name, sendEmailTool.name]}]})},
  toolRegistry: {tools: [getCurrentTimeTool, sendEmailTool]},
  humanGate: {userQuestions: {enabled: true}},
};

// src/tests/run/tool-side-effect-pauses-for-approval.real.test.ts
const gateway = new AIGateway(gatewayConfigTools);
```

- The building blocks are in `src/tests/internal/samples/`: `openAiModel`, `anthropicModel`, `openAiEmbeddingModel`, `sampleUser` / `sampleProfile`, the tools `get_current_time`, `send_email`, `refund`, the KB document `nordwindReturnsDocument`. A scenario-specific tool, rule or document lives in the config file itself (`restaurants-ny.real.config.ts` holds its DB, tool and judge rule).
- Tests of one scenario **may share** a config file (`tools.real.config.ts` serves two tests). A config exports what the tests need to assert on next to it: a repository instance, a planted token, a `kbFilters`.
- The user of a call is `sampleUserContext` (`src/tests/internal/utils/sampleUserContext.ts`); the KB scope of a call without knowledge base is `noKb`; `loadToolResults` reads the tool results of a thread.
- A test is replayable: point `src/dev-sandbox/sandbox.config.ts` at its config and run `./sandbox.cli.sh run`.
- Never assemble a config inline in a test, and never call `loadProviderCredentials` anywhere but in `gatewayConfigBase`. `makeGateway` / `makeGatewayConfig` / `makeToolGateway` are the older helpers of the not-yet-converted tests; do not use them in new tests.

## 4. Deterministic tests: FakeLLMClient

The model is scripted, never mocked with `jest.fn()`:

```ts
const llmClient = new FakeLLMClient();
const gateway = new AIGateway(gatewayConfigResumeOnAnotherProfile, {llmClient});
llmClient.accountTo({trace: gateway.trace, usageGuard: gateway.usageGuard});
llmClient.enqueueRunStep({toolCall: {kind: EPartKind.TOOL_CALL, callId: "call-1", toolName: "refund", input: {amount: 500}}});
llmClient.enqueueRunStep({text: "Refunded."});
```

A step with `toolCalls: [...]` scripts a model's parallel tool calls (handled in that order); `text` next to a tool request is the model's preamble ("Let me check…"), `text` alone the final answer.
`enqueueComplete` scripts an `ask()`, `enqueueRunStep` one step of a `run()`; the fake runs the real agent loop, so pauses, approvals and resume are the real code. Nothing enqueued = the model must not be called (a guardrail that fails first). Assert on the response (`kind`, `text`, `envelope`) and on stored state (the repositories of the config), not on what the fake was called with.

## 5. Real-provider tests: gated and stable

- Gate with `describeWithProvider(EModelProvider.OPENAI)(...)` (`src/tests/internal/utils/describeWithProvider.ts`): the test runs when the key is in the repo-root `.env` (`AIGATEWAY_TEST_<PROVIDER>_API_KEY`, see `.env.sample`) and is skipped otherwise. Never fail for a missing key. Real tests never run in CI.
- A real model is not deterministic. A stable test **leaves the model one path**:
  1. The profile addendum states the facts and the rule ("two invoices are overdue … when the request does not say which, you MUST call ask_user_question; never guess, never ask in plain text").
  2. The prompt lacks exactly what the rule needs, or plants a token no model knows (`PONG-7731`, `XK-7731`, the document's invented "34 days").
  3. Only the tools the path needs are offered (`allowedTools`, `activeTools`).
  4. Assert structure, not wording: response kind, pause kind, the tool name in the stored tool results, a traced call kind (`ETraceKind.QUERY_REWRITE`), the planted token. Never assert a sentence.
- Background work (working memory, user facts) runs after the answer: `await gateway.whenIdle()` before reading it — and before a follow-up that depends on it (the query rewriter needs the thread's memory).
- Do not set `temperature` on `gpt-5-mini`: its entry has `caps.temperature` false (a reasoning model), so the gateway refuses the call (400, D82).
- One model call costs seconds; the jest timeout is 60 s (`jest.setup.ts`). A test with more than three calls states why in its JSDoc.
- When a real test flakes, tighten the path (points 1–3) before touching the assertion.

## 6. Checklist

- [ ] One `test` in the file, file name says the behaviour, folder is the feature, `.real` only for a real LLM; a named scenario's files share its prefix (`<scenario>--<behaviour>`); a readme only next to a config (`<scenario>.real.config.readme.md`), never next to a test
- [ ] Config in the sibling `.config.ts` as `gatewayConfig<Scenario>`, spreads `gatewayConfigBase`, only the subject overridden
- [ ] Deterministic: `FakeLLMClient` scripted; real: gated, one path, structural assertions, `whenIdle()` before background state
- [ ] Imports sorted (`sort-imports` skill); no `any`, no `!`
- [ ] `pnpm test-no-coverage <file>` green; a real test run once with the key present
