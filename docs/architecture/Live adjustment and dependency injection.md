# AI Gateway — Live adjustment and dependency injection

Status: 2026-10-27. Code: `../../packages/dyna-ai-gateway/src/AIGateway.ts`, `src/orchestration/createGatewayDeps.ts`, `src/types.ts`.

## 1. Two different things

| Term                 | Meaning here                                                          | When it takes effect |
|----------------------|-----------------------------------------------------------------------|----------------------|
| Dependency injection | A class receives the services it uses; it creates none of them        | At construction      |
| Live adjustment      | Behaviour changes while the service runs, without restart or redeploy | On the next call     |

The gateway does the first with a composition root and the second with data. It does **not** swap a service instance on a running gateway (section 4).

## 2. Dependency injection

### 2.1 Construction

```ts
const gateway = new AIGateway(config, overrides?);
```

- `config: IAIGatewayConfig` — settings and persistence seams only: for every store a `repository` or `adapter` interface, the provider credentials, the app's tools and guardrail rules, feature switches. No class instance is in the config.
- `overrides?: IAIGatewayOverrides` — one factory per child the host builds itself. The gateway calls it with that child's config and deps, exactly as it would call its own class: `(config, deps) => new MyThreadStore(config, deps)`. The factory returns an object that implements the child's `I<Class>` interface (`IThreadStore`, `IWorkingMemory`, …); every child has one.

### 2.2 The composition root

`createGatewayDeps({config, overrides})` creates the 23 children once, in dependency order, and hands each the ones it needs:

```ts
const modelRegistry = make(overrides.modelRegistry, config.modelRegistry, undefined, config => new ModelRegistry(config));
const trace         = make(overrides.trace,         config.trace,         undefined, config => new Trace(config));
const usageGuard    = make(overrides.usageGuard,    config.usageGuard,    undefined, config => new UsageGuard(config));
const llmClient     = make(overrides.llmClient,     config.llmClient,     {modelRegistry, usageGuard, trace}, (config, deps) => new LLMClient(config, deps));
const guardrails    = make(overrides.guardrails,    config.guardrails ?? {}, {llmClient, modelRegistry},     (config, deps) => new Guardrails(config, deps));
// … `make` calls the host's factory when there is one, the gateway's class otherwise; both get the same config and deps
```

An override builds the instance for everyone that depends on it: the `llmClient` a factory returns is the one the guardrails' judge, the memory helpers, the query rewriter and the embedder call.

A child takes its config and, when it uses other children, its deps: `constructor(private readonly config, private readonly deps)`. A child without dependencies takes the config only (`ModelRegistry`, `ToolPolicy`, …); `TurnBuilder` takes nothing. No child creates another child; no child has an `addXxx()` or `register()` mutator.

### 2.3 What can be injected

| Seam                   | How                                             | Used for                                                                                                       |
|------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| A whole child class    | `overrides.<name>: (config, deps) => I<Class>`  | A host's own `IWorkingMemory` or `IThreadStore`; tests: `FakeLLMClient` (scripted model, real agent loop)      |
| Persistence of a store | `config.<store>.repository` / `.adapter`        | In-memory adapters today; Mongo, PostgreSQL, S3, vector search later                                           |
| Usage rules            | `config.usageGuard.adapter`                     | The app's [usage adapter](../getting-started/Usage%20adapter.md): asked before every model call, told after it |
| Provider credentials   | `config.llmClient.providers`                    | Which providers the one `LLMClient` can reach                                                                  |
| Tools                  | `config.toolRegistry.tools`                     | The app's tools, next to the built-in ones                                                                     |
| Guardrail rules        | `config.guardrails.inputRules` / `.outputRules` | The app's checks; each rule receives a `judge`                                                                 |

Example from the tests:

```ts
const llmClient = new FakeLLMClient();
const gateway = new AIGateway(gatewayConfigResumeOnAnotherProfile, {llmClient: () => llmClient});
llmClient.accountTo({trace: gateway.trace, usageGuard: gateway.usageGuard}); // the fake asks, reports and traces as the real client does
llmClient.enqueueRunStep({toolCall: {kind: EPartKind.TOOL_CALL, callId: "call-1", toolName: "refund", input: {amount: 500}}});
llmClient.enqueueRunStep({text: "Refunded."});
```

Pauses, approvals and resume run through the real code; only the model is scripted (`../../packages/dyna-ai-gateway/src/tests/human-gate/resume-on-another-profile-swaps-the-model.test.ts`).

## 3. Live adjustment

The model, the tools, the limits and the prompts are data. A change is read on the next call. The model catalog, the profiles and the templates are cached; their write methods invalidate the cache, and `refresh()` on the catalog and the templates drops it by hand.

| What changes                                          | How                                                                                                                                                                                      | Effective                            |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| The model of a conversation                           | Pass another `profileId` on the next `ask()` / `run()` ([decision](Decisions.md#d46-the-profile-and-with-it-the-model-is-chosen-per-call))                                               | That call                            |
| The model of a paused run                             | `resume({userContext, runId, pauseId, decisions, profileId})` ([decision](Decisions.md#d65-resume-continues-a-paused-run-on-another-profile))                                            | The continuation                     |
| A profile (model, tools, approvals, addendum, limits) | `gateway.aiProfileStore.upsertProfile({tenantId, profile})` — invalidates the tenant's profile cache                                                                                     | Next call that uses it               |
| A model entry (provider id, caps, cost, enabled)      | `gateway.modelRegistry.upsertModel({model})` — invalidates the catalog cache                                                                                                             | Next call                            |
| A model switched off, or removed                      | `gateway.modelRegistry.setEnabled({modelId, enabled: false})`, `removeModel({modelId})` — invalidate the catalog cache; a disabled model is refused with a 400, a removed one with a 404 | Next call; a call in flight finishes |
| A profile removed                                     | `gateway.aiProfileStore.removeProfile({tenantId, profileId})` — invalidates the tenant's cache; refused (409) while a paused run waits on the profile                                    | Next call                            |
| A prompt template                                     | `gateway.promptTemplateStore.addVersion(...)` then `activate(...)`                                                                                                                       | Next render                          |
| The tools a call offers                               | `activeTools` on `run()` narrows the registry's; `additionalTools` on `run()` adds the call's own ([decision](Decisions.md#d66-tools-per-call)), passed again on `resume()`              | That call                            |
| Sampling                                              | `temperature` on the call                                                                                                                                                                | That call                            |
| Stopping a call, or how long it may take              | `abortSignal` and `timeoutMs` on `ask()` / `run()` / `resume()` ([decision](Decisions.md#d90-a-call-can-be-stopped-abortsignal-and-timeoutms))                                           | That call                            |

### 3.1 Why a model change is safe mid-conversation

Stored turns, memory and run messages are in the gateway's own provider-neutral shape ([the SDK is sealed in one class](Decisions.md#the-ai-sdk-is-sealed-in-one-class)). A different model receives the same history; the `LLMClient` maps it to the provider at call time. The trace entry of each call carries the `modelId` it ran on.

### 3.2 Resume on another profile

`resume({profileId})` takes from the new profile what `run()` takes from its profile: the model (`request.modelId`), the output cap (`min(profile.limits.maxOutputTokens, caps.maxOutputTokens)`), the tools (`ToolPolicy.resolve` over the run's tool names) and the limits. The system prompt and the messages so far stay. `reviewAnswers` and `approvals` are those of both profiles together ([decision](Decisions.md#d113-a-profile-switch-on-resume-keeps-the-review-and-the-approvals)): a switch adds guards, never removes them.

Checked before the run leaves PAUSED: a pending tool the new profile does not allow is a 400 and nothing changes. The run is stored with the profile and model it continued on.

Tests: `../../packages/dyna-ai-gateway/src/tests/human-gate/resume-on-another-profile-swaps-the-model.test.ts` (scripted model), `…/resume-on-another-profile-swaps-the-model.real.test.ts` (OpenAI to Anthropic, both keys needed), `…/resume-on-a-profile-without-the-tool-is-refused.test.ts`.

## 4. What is deliberately not possible

| Not possible                                                                                                                                                          | Reason                                                                                                                                                                                                                                         |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Replace a child instance on a running gateway (`setLlmClient(...)`)                                                                                                   | A running call holds references to the old instance; usage reports, traces and paused runs would split across two clients. The gateway holds no state outside its adapters, so the standard is: construct a new gateway with the new override. |
| Register a tool or a guardrail rule on the running gateway ([decision](Decisions.md#d48-the-tools-are-fixed-at-construction-a-call-can-narrow-them-never-widen-them)) | It would exist on one server instance and not the others, and what a call does would depend on earlier calls instead of configuration. A tool that exists for one request is passed on that call (`additionalTools`).                          |
| Store the profile on the thread                                                                                                                                       | It was written once and never read; the caller decides per call.                                                                                                                                                                               |

## 5. Demonstration

Deterministic: the test above (`gatewayConfigResumeOnAnotherProfile`: two models, the `refund` tool, a scripted model). On real providers: its `.real.test.ts` twin, with both keys in `.env`.

Live, on real models, in the debugger (`pnpm sandbox-debug` with `sandbox.config.ts` pointed at that config, both provider keys in `.env`). The chat (`pnpm sandbox-cli run`) resumes a pause on the profile the run started with, so the resume is typed by hand:

1. `await start("Refund 500 to the customer")` — the run starts on the OpenAI profile; the `refund` tool pauses it.
2. `await dynaEnv.aiGateway.resume({userContext: dynaEnv.userContext, runId: lastResponse.envelopes[0].runId, pauseId: lastResponse.pauseId, decisions: [{action: "APPROVE"}], profileId: "anthropic-refund"}).response`.
3. The trace shows one `RUN_STEP` on `gpt-5-mini` and one on `claude-haiku-4-5`; the run is stored with the Anthropic profile; the answer is on the one thread.