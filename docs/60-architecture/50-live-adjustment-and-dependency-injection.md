# Live adjustment and dependency injection

Code: [`AIGateway.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/AIGateway.ts), [`types.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/types.ts).

## 1. About

What an application can change while the gateway runs, what is fixed when the gateway is constructed, and why. Not needed
to use the library.

## 2. Description

| Term                 | Meaning here                                                          | When it takes effect |
|----------------------|-----------------------------------------------------------------------|----------------------|
| Dependency injection | A class receives the services it uses; it creates none of them        | At construction      |
| Live adjustment      | Behaviour changes while the service runs, without restart or redeploy | On the next call     |

The gateway does the first with a composition root and the second with data. It does **not** swap a service instance on a
running gateway ([chapter 7](#7-what-is-deliberately-not-possible)).

## 3. For whom is this chapter

A developer who changes a model, a profile, a prompt or a limit in production and wants to know when the change takes
effect, or who asks whether a tool, a rule or a class can be added without a restart.

## 4. How it works

### 4.1 Construction

```ts
const gateway = new AIGateway(config, overrides);
```

- `config: IAIGatewayConfig` — settings and persistence seams only: for every store a `repository` or `adapter` interface, the provider credentials, the application's tools and guardrail rules, feature switches. No class of the gateway is in the config; the classes are built from it.
- `overrides?: IAIGatewayOverrides` — one factory per class the application builds itself: [Class replacement](30-class-replacement.md).

### 4.2 The composition root

The constructor builds the classes of the gateway once, in dependency order, each from its own config and the classes it
uses; a factory in `overrides` takes the place of a class ([Class replacement](30-class-replacement.md)).

A class takes its config and, when it uses other classes, its deps: `constructor(config, deps)`. A class without
dependencies takes the config only (`ModelRegistry`, `ToolPolicy`, …); `TurnBuilder` takes nothing. None of the 24
classes creates another one, and none keeps a class, a tool or a rule it was not constructed with (there is no `register()`); the tools
of one call travel with that call.

### 4.3 What is set at construction

| What is set            | How                                             | Used for                                                                                                             |
|------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| A whole class          | `overrides.<name>: (config, deps) => I<Class>`  | The application's own class in place of the gateway's: [Class replacement](30-class-replacement.md)                  |
| Persistence of a store | `config.<store>.repository` / `.adapter`        | The application's database: [Storage adapters](20-adapters.md)                                                       |
| Usage rules            | `config.usageGuard.adapter`                     | The application's usage adapter, asked before every model call and told after it: [Storage adapters](20-adapters.md) |
| Provider credentials   | `config.llmClient.providers`                    | Which providers the one `LLMClient` can reach                                                                        |
| Tools                  | `config.toolRegistry.tools`                     | The application's tools, next to the built-in ones                                                                   |
| Guardrail rules        | `config.guardrails.inputRules` / `.outputRules` | The application's checks; each rule receives a `judge`                                                               |

## 5. How it can be extended

- Another database: a [storage adapter](20-adapters.md).
- The application's usage rules: the usage adapter (`config.usageGuard.adapter`), on [the same page](20-adapters.md#the-ten-seams).
- Another behaviour of a part of the gateway: a [class replacement](30-class-replacement.md).
- A tool or a guardrail rule: in the config, at construction. A tool that exists for one request is passed on that
  `run()` (`additionalTools`), and again on its `resume()`.

## 6. Live adjustment

The model, the tools, the limits and the prompts are data. A change is read on the next call of the instance that wrote it; other instances read it once their cache TTL runs out (profiles 30 s, models and templates 60 s by default, `cacheTtlMs`). The model catalog, the profiles and the templates are cached; their write methods invalidate the local cache, and `refresh()` on the catalog and the templates drops it by hand.

| What changes                                          | How                                                                                                                                                                                      | Effective                            |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| The model of a conversation                           | Pass another `profileId` on the next `ask()` / `run()` ([decision](90-decisions.md#d46-the-profile-and-with-it-the-model-is-chosen-per-call))                                            | That call                            |
| The model of a paused run                             | `resume({userContext, runId, pauseId, decisions, profileId})` ([decision](90-decisions.md#d65-resume-continues-a-paused-run-on-another-profile))                                         | The continuation                     |
| A profile (model, tools, approvals, addendum, limits) | `gateway.aiProfileStore.upsertProfile({tenantId, profile})` — invalidates the tenant's profile cache                                                                                     | Next call that uses it               |
| A model entry (provider id, caps, cost, enabled)      | `gateway.modelRegistry.upsertModel({model})` — invalidates the catalog cache                                                                                                             | Next call                            |
| A model switched off, or removed                      | `gateway.modelRegistry.setEnabled({modelId, enabled: false})`, `removeModel({modelId})` — invalidate the catalog cache; a disabled model is refused with a 400, a removed one with a 404 | Next call; a call in flight finishes |
| A profile removed                                     | `gateway.aiProfileStore.removeProfile({tenantId, profileId})` — invalidates the tenant's cache; refused (409) while a paused run waits on the profile                                    | Next call                            |
| A prompt template                                     | `gateway.promptTemplateStore.addVersion(...)` then `activate(...)`                                                                                                                       | Next render                          |
| The tools a call offers                               | `activeTools` on `run()` narrows the registry's; `additionalTools` on `run()` adds the call's own ([decision](90-decisions.md#d66-tools-per-call)), passed again on `resume()`           | That call                            |
| Sampling                                              | `temperature` on the call                                                                                                                                                                | That call                            |
| Stopping a call, or how long it may take              | `abortSignal` and `timeoutMs` on `ask()` / `run()` / `resume()` ([decision](90-decisions.md#d90-a-call-can-be-stopped-abortsignal-and-timeoutms))                                        | That call                            |

### 6.1 Why a model change is safe mid-conversation

Stored turns, memory and run messages are in the gateway's own provider-neutral shape ([the SDK is sealed in one class](90-decisions.md#the-ai-sdk-is-sealed-in-one-class)). A different model receives the same history; the `LLMClient` maps it to the provider at call time. The trace entry of each call carries the `modelId` it ran on.

### 6.2 Resume on another profile

`resume({profileId})` takes from the new profile what `run()` takes from its profile: the model (`request.modelId`), the output cap (`min(profile.limits.maxOutputTokens, caps.maxOutputTokens)`), the tools (`ToolPolicy.resolve` over the run's tool names) and the limits. The system prompt and the messages so far stay. `reviewAnswers` and `approvals` are those of both profiles together ([decision](90-decisions.md#d113-a-profile-switch-on-resume-keeps-the-review-and-the-approvals)) for that resume: the switch adds guards. The run is then stored with the new profile, so a later pause of it, resumed without `profileId`, has only the new profile's guards.

Checked before the run leaves PAUSED: a pending tool the new profile does not allow is a 400 and nothing changes. The run is stored with the profile and model it continued on.

Tests: [`resume-on-another-profile-swaps-the-model.test.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/tests/human-gate/resume-on-another-profile-swaps-the-model.test.ts) (scripted model), [`resume-on-another-profile-swaps-the-model.real.test.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/tests/human-gate/resume-on-another-profile-swaps-the-model.real.test.ts) (OpenAI to Anthropic, both keys needed), [`resume-on-a-profile-without-the-tool-is-refused.test.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/tests/human-gate/resume-on-a-profile-without-the-tool-is-refused.test.ts).

## 7. What is deliberately not possible

| Not possible                                                                                                                                                             | Reason                                                                                                                                                                                                                                                 |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Replace a class instance on a running gateway (`setLlmClient(...)`)                                                                                                      | A running call holds references to the old instance; usage reports, traces and paused runs would split across two clients. What the gateway keeps between calls is in its adapters, so the standard is: construct a new gateway with the new override. |
| Register a tool or a guardrail rule on the running gateway ([decision](90-decisions.md#d48-the-tools-are-fixed-at-construction-a-call-can-narrow-them-never-widen-them)) | It would exist on one server instance and not the others, and what a call does would depend on earlier calls instead of configuration. A tool that exists for one request is passed on that call (`additionalTools`).                                  |
| Store the profile on the thread                                                                                                                                          | No call reads it: the caller names the profile on every call.                                                                                                                                                                                          |

## 8. Demonstration

For a developer who has cloned the repository.

Deterministic: [`resume-on-another-profile-swaps-the-model.test.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/tests/human-gate/resume-on-another-profile-swaps-the-model.test.ts) (two models, the `refund` tool, a scripted model). On real providers: [`resume-on-another-profile-swaps-the-model.real.test.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/tests/human-gate/resume-on-another-profile-swaps-the-model.real.test.ts), with both keys in `.env`.

Live, on real models, in the debugger (`pnpm sandbox-debug` with [`sandbox.config.ts`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/dev-sandbox/sandbox.config.ts) pointed at that test's config, both provider keys in `.env`). The chat (`pnpm sandbox-cli run`) resumes a pause on the profile the run started with, so the resume is typed by hand. Paste [`dev-tools-helper-methods.js`](https://github.com/aneldev/dyna-ai-gateway/blob/main/packages/dyna-ai-gateway/src/dev-sandbox/dev-tools-helper-methods.js) into the dev-tools console first: it defines `start`, `lastResponse` and the resume helpers.

1. `await start("Refund 500 to the customer")` — the run starts on the OpenAI profile; the `refund` tool pauses it.
2. `await dynaEnv.aiGateway.resume({userContext: dynaEnv.userContext, runId: lastResponse.envelopes[0].runId, pauseId: lastResponse.pauseId, decisions: [{action: "APPROVE"}], profileId: "anthropic-refund"}).response`.
3. The trace shows one `RUN_STEP` on the OpenAI profile's model and one on `claude-haiku-4-5`; the run is stored with the Anthropic profile; the answer is on the one thread.

## 9. Summary

- The classes, the registry's tools and the guardrail rules are fixed when the gateway is constructed.
- The models, the profiles (model, tools, limits) and the templates are data: the instance that writes a change reads it on
  its next call. A call picks its profile and, on `run()`, its tools.
- Another server instance reads a changed model, profile or template once its cache runs out.
- A new class or a new registry tool means a new gateway. What the gateway keeps between calls is in its adapters, so the
  new one continues from the same data; the old one finishes its calls first (`shutdown()`).

## 10. FAQ

**Do I restart the service to change the model of a conversation?** No. Pass another `profileId` on the next call, or
change the profile; see the table in [chapter 6](#6-live-adjustment).

**Can I add a tool without a restart?** Not to the registry. A tool for one request is passed on `run()` as
`additionalTools`; a registered tool is switched on for a profile with `allowedTools` (`upsertProfile`), which needs no
restart.

**Can I swap the LLM client on a running gateway?** No. Construct a new gateway with the new override
([chapter 7](#7-what-is-deliberately-not-possible)).
