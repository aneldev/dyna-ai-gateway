# Models and profiles

A call never names a model. It names a profile, and the profile names the model. The model registry holds the facts
of every model: provider, capabilities, prices. The profile holds a tenant's choices: which model, which tools, which
approvals, which prompt addendum, which limits. Both are data in a store, so a change reaches the next call without a
restart.

## 1. About

| Object  | Type                                                     | Scope                 | Held by                                     | Answers                                 |
|---------|----------------------------------------------------------|-----------------------|---------------------------------------------|-----------------------------------------|
| Model   | [`IModelInfo`](../30-api/index/interfaces/IModelInfo.md) | global, no `tenantId` | `ModelRegistry` (`gateway.modelRegistry`)   | what the model can do and what it costs |
| Profile | [`IAIProfile`](../30-api/index/interfaces/IAIProfile.md) | one tenant            | `AIProfileStore` (`gateway.aiProfileStore`) | how a tenant uses AI for one use case   |

A model entry:

| Field             | What it is                                                                                        |
|-------------------|---------------------------------------------------------------------------------------------------|
| `id`              | the gateway's own stable id, e.g. `"gpt-5-mini"`; profiles reference it                           |
| `provider`        | the `EModelProvider` the `LLMClient` calls: `OPENAI`, `ANTHROPIC`, `GOOGLE`, `MISTRAL`, `BEDROCK` |
| `providerModelId` | the provider's own id, e.g. `"claude-haiku-4-5-20251001"`                                         |
| `label`           | a human label for an admin screen                                                                 |
| `caps`            | the capabilities and prices, `IModelCaps` (chapter 2.1)                                           |
| `enabled`         | `false` switches the model off for every call                                                     |
| `deprecatedAt`    | the retirement date the provider announced, or `null`                                             |

A profile:

| Field               | What it does                                                              | Page                                                                             |
|---------------------|---------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| `id`, `tenantId`    | the id a call passes as `profileId`, and the tenant it belongs to         |                                                                                  |
| `name`              | a human label, e.g. `"Careful refunds"`                                   |                                                                                  |
| `modelId`           | the main model: the answer and every step of a run                        |                                                                                  |
| `cheapModelId`      | optional: the model of the helper calls (chapter 2.3)                     |                                                                                  |
| `promptAddendum`    | the tenant's text appended to the system prompt                           | [System prompt layers](../60-architecture/40-system-prompt-production-layers.md) |
| `allowedTools`      | the tool names the model may see; a subset of the registered tools        | [Tools](030-tools.md)                                                            |
| `approvals`         | the tool names that pause for a human before they run                     | [Human in the loop](040-human-in-the-loop.md)                                    |
| `reviewAnswers`     | optional: every answer of a `run()` waits for a human                     | [Human in the loop](040-human-in-the-loop.md)                                    |
| `parallelToolCalls` | optional, default `true`: the tool calls of one step run at the same time | [Tools](030-tools.md)                                                            |
| `workingMemory`     | optional: how this profile's threads reach the model                      | [Thread memory](080-thread-memory.md)                                            |
| `skills`            | optional: instructions the model loads on demand                          | [Skills](020-skills.md)                                                          |
| `limits`            | `maxStepsPerRun` (model calls per run) and `maxOutputTokens` (one answer) |                                                                                  |
| `templateOverrides` | reserved; the gateway does not read it                                    |                                                                                  |

A profile holds no budget. What a call may spend is decided by your usage adapter ([Usage guard](060-usage-guard.md)).

## 2. Logic

### 2.1 What the gateway reads from `caps`

| Cap                                                   | Read by                          | Effect                                                                                                                                                            |
|-------------------------------------------------------|----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `tools`                                               | the tool policy                  | `false`: the call is offered no tools from the registry or the call; a `run()` answers without calling one                                                        |
| `images`, `pdf`                                       | the context assembler            | a file part of that kind reaches the model only when the cap is `true` ([Chat files](092-chat-files.md))                                                          |
| `temperature`                                         | every call, the guardrails judge | `false`: a call with `temperature` is a 400 before anything is stored ([D82](../60-architecture/90-decisions.md#d82-a-model-says-whether-it-takes-a-temperature)) |
| `embeddings`                                          | the `LLMClient`, the embedder    | only a model with `true` embeds; any other is a 400                                                                                                               |
| `contextTokens`                                       | the context assembler            | the window the history must fit in                                                                                                                                |
| `maxOutputTokens`                                     | every call                       | the answer's cap is `min(profile.limits.maxOutputTokens, caps.maxOutputTokens)`                                                                                   |
| `costInPerMTokUsd`, `costOutPerMTokUsd`               | `estimateCostUsd`                | the list price per million input and output tokens                                                                                                                |
| `costCacheReadPerMTokUsd`, `costCacheWritePerMTokUsd` | `estimateCostUsd`                | optional: the price of the tokens read from and written to the provider's prompt cache                                                                            |

`structuredOutput` and `reasoning` describe the model for your admin screen. The gateway does not refuse a call on them.

### 2.2 Cost

`modelRegistry.estimateCostUsd({modelId, inputTokens, outputTokens, cachedInputTokens?, cacheWriteInputTokens?})` returns
the list-price cost of one call in USD:

```
( uncached input × costInPerMTokUsd
+ cached input   × costCacheReadPerMTokUsd
+ cache writes   × costCacheWritePerMTokUsd
+ output         × costOutPerMTokUsd ) / 1 000 000
```

- The uncached input is `inputTokens` minus the cached and the cache-write tokens, never below zero.
- Without a cache price, the provider default applies. `ANTHROPIC`: 0.1 × the input price for a read, 1.25 × for a
  write. Any other provider: the input price for both. OpenAI's cache-read rate differs per model, so set
  `costCacheReadPerMTokUsd` on an OpenAI entry.
- A disabled model is still priced, so a call in flight when it was switched off is reported.

The `LLMClient` prices every model call this way. The result is `costUsd` on the trace entry
([`ITraceEntry`](../30-api/index/interfaces/ITraceEntry.md)) and on the report to your usage adapter
([`IUsageAddArgs`](../30-api/index/interfaces/IUsageAddArgs.md)). It is informative: no exchange rate, no discount.
An application that bills in its own currency computes from `usage`.

### 2.3 Main model and cheap model

| Call                                                    | Model                                                   |
|---------------------------------------------------------|---------------------------------------------------------|
| the answer, every step of a `run()`                     | `modelId`                                               |
| working memory summary, user facts, query rewrite       | `cheapModelId`, else the config's `defaultCheapModelId` |
| a guardrails judge on `EJudgeModel.CHEAP` (the default) | `cheapModelId`, else the profile's `modelId`            |
| a guardrails judge on `EJudgeModel.MAIN`                | `modelId`                                               |

`defaultCheapModelId` is required in `IAIGatewayConfig`. The judge does not read it. See [Guardrails](050-guardrails.md).

### 2.4 One call

1. The call names `profileId`. The gateway loads that profile of `userContext.tenantId`. An unknown id, or an id of
   another tenant, is a 404.
2. It loads the profile's model with `getModel`. An unknown model is a 404, a disabled one a 400.
3. It derives from the model and the profile what the call may do: the tools, the files, the temperature, the output cap.
4. The `LLMClient` resolves `provider` and `providerModelId` and calls the provider. A provider without credentials in
   `llmClient.providers` is a 400.

A thread stores no profile. The next call of the same thread may name another profile, and with it another model
([D46](../60-architecture/90-decisions.md#d46-the-profile-and-with-it-the-model-is-chosen-per-call)). There is no
default profile: every call names one ([D103](../60-architecture/90-decisions.md#d103-a-call-always-names-its-profile)).
A paused run resumes on the profile it started with, unless `resume()` names another one
([D65](../60-architecture/90-decisions.md#d65-resume-continues-a-paused-run-on-another-profile)).

### 2.5 Validation at the write

`upsertProfile({tenantId, profile})` checks the profile before it saves it. A stored profile names only what exists.

| Check                                                             | Error                                                |
|-------------------------------------------------------------------|------------------------------------------------------|
| `modelId` and `cheapModelId` (when set) exist in the registry     | 404, `data.modelId`                                  |
| they are enabled                                                  | 400, `data.modelId`                                  |
| every name of `allowedTools` and `approvals` is a registered tool | 400, `data.unknownTools`                             |
| the `skills` have unique, non-empty names within the skill caps   | 400 ([Skills](020-skills.md#24-validation-and-caps)) |

The profile is saved whole. `upsertModel({model})` saves the entry whole and checks nothing beyond its type.

### 2.6 Removal

| Method                                       | Refused when                                               | Effect on the profiles                                     |
|----------------------------------------------|------------------------------------------------------------|------------------------------------------------------------|
| `aiProfileStore.removeProfile`               | a PAUSED run of the tenant waits on it: 409, `data.runIds` | a thread is not bound to a profile, so nothing else breaks |
| `modelRegistry.setEnabled({enabled: false})` | the model is unknown: 404                                  | the profiles that name it fail at their next call (400)    |
| `modelRegistry.removeModel`                  | the model is unknown: 404                                  | the profiles that name it fail at their next call (404)    |

The registry is global and knows no profiles, so it cannot refuse a model a profile still names. The reasons are in
[A profile a paused run waits on cannot be removed](../60-architecture/90-decisions.md#a-profile-a-paused-run-waits-on-cannot-be-removed).

### 2.7 Caches

Every call reads a profile and a model, so both stores cache their repository.

| Store            | Cached                     | `cacheTtlMs` default | Dropped by                                              |
|------------------|----------------------------|----------------------|---------------------------------------------------------|
| `ModelRegistry`  | the whole catalog          | 60 000               | `upsertModel`, `setEnabled`, `removeModel`, `refresh()` |
| `AIProfileStore` | the profiles of one tenant | 30 000               | `upsertProfile`, `removeProfile` (that tenant only)     |

A write drops the cache of the instance that made it. Another server instance sees the change after its TTL. A host that
writes the repository directly, past the registry, calls `modelRegistry.refresh()`. The profile store has no `refresh()`.
The full table of what changes how is in
[Live adjustment](../60-architecture/50-live-adjustment-and-dependency-injection.md#3-live-adjustment).

### 2.8 Repositories

| Store            | Repository contract                                                                  | In-memory default                 | Methods                          |
|------------------|--------------------------------------------------------------------------------------|-----------------------------------|----------------------------------|
| `ModelRegistry`  | [`IModelRegistryRepository`](../30-api/index/interfaces/IModelRegistryRepository.md) | `InMemoryModelRegistryRepository` | `loadAll`, `save`, `remove`      |
| `AIProfileStore` | [`IAIProfileRepository`](../30-api/index/interfaces/IAIProfileRepository.md)         | `InMemoryAIProfileRepository`     | `loadByTenant`, `save`, `remove` |

The in-memory repositories take a seed in their constructor (`{models}`, `{profiles}`) and keep nothing past the process.
In production, implement the contract on your database. `save` is an upsert, and `remove` of a missing entry is not an
error. Only the store calls its repository.

## 3. Examples

The `config` and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md). The tools the profiles name (`get_invoice`, `post_credit_note`)
are registered in the config's `toolRegistry` ([Tools](030-tools.md)); `upsertProfile` refuses a name that is not.

### 3.1 A second provider

```ts
import {AIGateway, EModelProvider, IModelInfo, InMemoryModelRegistryRepository} from "dyna-ai-gateway";

const claudeHaiku: IModelInfo = {
  id: "claude-haiku-4-5",
  provider: EModelProvider.ANTHROPIC,
  providerModelId: "claude-haiku-4-5-20251001",
  label: "Claude Haiku 4.5",
  caps: {
    tools: true,
    images: true,
    pdf: true,
    structuredOutput: true,
    reasoning: true,
    temperature: true,
    embeddings: false,
    contextTokens: 200_000,
    maxOutputTokens: 8_000,
    costInPerMTokUsd: 1,
    costOutPerMTokUsd: 5,
    // no cache prices: ANTHROPIC defaults to 0.1 × and 1.25 × the input price
  },
  enabled: true,
  deprecatedAt: null,
};

const gateway = new AIGateway({
  ...config,
  llmClient: {
    providers: {
      [EModelProvider.OPENAI]: {apiKey: process.env.OPENAI_API_KEY ?? ""},
      [EModelProvider.ANTHROPIC]: {apiKey: process.env.ANTHROPIC_API_KEY ?? ""},
    },
  },
  modelRegistry: {
    repository: new InMemoryModelRegistryRepository({models: [gpt5Mini, textEmbedding3Small, claudeHaiku]}),
  },
});

const costUsd = await gateway.modelRegistry.estimateCostUsd({
  modelId: "claude-haiku-4-5",
  inputTokens: 12_000,
  cachedInputTokens: 10_000,
  outputTokens: 500,
});
// (2 000 × 1 + 10 000 × 0.1 + 500 × 5) / 1 000 000 = 0.0055
```

### 3.2 Two profiles, the user picks the model

```ts
import {EGatewayResponseKind, IAIProfile} from "dyna-ai-gateway";

const accountingClaude: IAIProfile = {
  ...accountingProfile,
  id: "accounting-claude",
  name: "Accounting assistant (Claude)",
  modelId: "claude-haiku-4-5",
  cheapModelId: "gpt-5-mini",
};
await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: accountingClaude});

const first = await gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Which invoices of March are unpaid?",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (first.kind === EGatewayResponseKind.ANSWER) {
  // The user switched to Claude: same thread, next call, another profile.
  await gateway.ask({
    userContext,
    threadId: first.threadId,
    profileId: "accounting-claude",
    prompt: "Draft a reminder for the oldest one.",
    kbFilters: {libraryIds: [], bookIds: []},
  }).response;
}
```

Where the application stores the user's choice, and what carries over to the new model, is in the
[FAQ](../10-getting-started/90-faq.md#how-can-the-user-change-the-model).

### 3.3 Change one field of a profile

`upsertProfile` replaces the whole profile. Read it, change the field, save it.

```ts
const current = await gateway.aiProfileStore.getProfile({tenantId: "acme", profileId: "accounting"});

await gateway.aiProfileStore.upsertProfile({
  tenantId: "acme",
  profile: {
    ...current,
    limits: {...current.limits, maxStepsPerRun: 10},
  },
});
// This instance reads the new limits on the next call; the other instances after their profile cache TTL.
```

### 3.4 A model menu and a profile editor

```ts
import {EModelProvider} from "dyna-ai-gateway";

const menu = await gateway.aiProfileStore.listProfiles({tenantId: "acme"});
// [{id: "accounting", name: "Accounting assistant", ...}, {id: "accounting-claude", ...}]

const pickable = await gateway.modelRegistry.listModels({enabledOnly: true});
const anthropicOnly = await gateway.modelRegistry.listModels({provider: EModelProvider.ANTHROPIC});
const allForAdmin = await gateway.modelRegistry.listModels({enabledOnly: false});
```

`gateway.modelRegistry` and `gateway.aiProfileStore` check no user. The host checks the admin permission before it
calls them.

### 3.5 Retire a model

```ts
const tenantProfiles = await gateway.aiProfileStore.listProfiles({tenantId: "acme"});
for (const profile of tenantProfiles.filter(candidate => candidate.modelId === "claude-haiku-4-5")) {
  await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: {...profile, modelId: "gpt-5-mini"}});
}

await gateway.modelRegistry.setEnabled({modelId: "claude-haiku-4-5", enabled: false});
// A profile still on it fails its next call with a 400; the entry and its history stay.
```

Repeat the loop for every tenant: the registry is global, the profiles are per tenant.

### 3.6 Remove a profile

```ts
try {
  await gateway.aiProfileStore.removeProfile({tenantId: "acme", profileId: "accounting-claude"});
} catch (error) {
  // error.status === 409, error.data.runIds: the paused runs that wait on the profile.
  // Resume or cancel them, then remove the profile again.
}
```

### 3.7 Profiles in your database

```ts
import {Pool} from "pg";
import {AIGateway, IAIProfile, IAIProfileRepository} from "dyna-ai-gateway";

class PgAIProfileRepository implements IAIProfileRepository {
  constructor(private readonly pool: Pool) {
  }

  public async loadByTenant({tenantId}: {tenantId: string}): Promise<IAIProfile[]> {
    const {rows} = await this.pool.query<{profile: IAIProfile}>(
      "SELECT profile FROM ai_profiles WHERE tenant_id = $1",
      [tenantId],
    );
    return rows.map(row => row.profile);
  }

  public async save({tenantId, profile}: {tenantId: string; profile: IAIProfile}): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_profiles (tenant_id, profile_id, profile) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, profile_id) DO UPDATE SET profile = EXCLUDED.profile`,
      [tenantId, profile.id, profile],
    );
  }

  public async remove({tenantId, profileId}: {tenantId: string; profileId: string}): Promise<void> {
    await this.pool.query("DELETE FROM ai_profiles WHERE tenant_id = $1 AND profile_id = $2", [tenantId, profileId]);
  }
}

const gateway = new AIGateway({
  ...config,
  aiProfileStore: {repository: new PgAIProfileRepository(new Pool()), cacheTtlMs: 10_000},
});
```

A model repository is the same shape. `IModelInfo.deprecatedAt` is a `Date`: a repository that stores JSON turns it back
into a `Date` in `loadAll`.

## 4. Pitfalls

- **A partial profile in `upsertProfile`.** The profile is stored whole. A field left out is gone, not kept. Read,
  spread, save (example 3.3).
- **A `tenantId` argument that differs from `profile.tenantId`.** The store saves and drops the cache under the
  argument. Keep both the same.
- **Removing a model a profile still names.** The registry does not know the profiles. The next call of such a profile is
  a 404. Switch the profiles first, and prefer `setEnabled({enabled: false})`: it keeps the entry and its history.
- **Expecting an admin write on every instance at once.** Only the instance that wrote drops its cache. Lower
  `cacheTtlMs` for an admin screen that must see its own edits fast everywhere.
- **Editing the repository behind the store's back.** A seed script that writes the table directly is invisible until the
  TTL. Write through `gateway.modelRegistry` and `gateway.aiProfileStore`, or call `modelRegistry.refresh()`.
- **A temperature on a model without the cap.** The OpenAI reasoning models have `caps.temperature: false`. A call with
  `temperature` on their profiles is a 400. Read the cap before you offer the setting.
- **A model without `tools` behind a `run()` profile.** The tool policy offers the model none of the profile's tools.
  The run answers without calling one.
- **A model whose provider has no credentials.** `upsertProfile` accepts it, since the registry knows the model. The call
  is then a 400. Add the provider to `llmClient.providers`.
- **Stale prices.** `costUsd` is only as right as `caps`. Keep the entries in step with the provider's price list.
- **A default profile on the gateway.** There is none. Resolve "the user has not picked one" to a profile id in your
  application and pass it on every call.

## 5. Summary

- A call names `profileId`. The profile names the model, the tools, the approvals, the addendum and the limits.
- The model registry is global: provider, `providerModelId`, `caps`, prices, `enabled`. A profile is per tenant.
- `caps` decides tools, files, temperature, the context window and the output cap. `estimateCostUsd` prices every call.
- Helper calls run on `cheapModelId`, else `defaultCheapModelId`. A judge falls back to the profile's `modelId`.
- `upsertProfile` validates models, tools and skills before it saves. `removeProfile` refuses a profile a paused run
  waits on.
- Both stores cache: the catalog 60 s, a tenant's profiles 30 s. A write drops the cache of its own instance.
- Production replaces `InMemoryModelRegistryRepository` and `InMemoryAIProfileRepository` with your own repositories.

## 6. FAQ

**Can one thread use two models?**
Yes. A thread stores no profile. Each call names its own, and the history is in the gateway's provider-neutral shape
([Why a model change is safe mid-conversation](../60-architecture/50-live-adjustment-and-dependency-injection.md#31-why-a-model-change-is-safe-mid-conversation)).

**Can a tenant add its own model?**
Not through the registry: it has no `tenantId`. The platform registers the models. A tenant chooses among them in its
profiles.

**How many profiles can a tenant have?**
No limit. One per use case or per model the user may pick: "cheap chat", "careful refunds", "accounting on Claude".

**Can two tenants use the same profile id?**
Yes. A profile is keyed by tenant and id, and a tenant never sees another tenant's profiles.

**Can a paused run continue on another model?**
Yes: `resume()` with another `profileId`. The approvals and the answer review of both profiles stay in force
([D113](../60-architecture/90-decisions.md#d113-a-profile-switch-on-resume-keeps-the-review-and-the-approvals)).

**What does `deprecatedAt` do?**
Nothing in the gateway. It is a fact for your admin screen. Switch the profiles and disable the model before the provider
retires it.

**Where do I see which model answered?**
Each trace entry carries the `modelId` of its call and its `costUsd`.

**Can I replace the registry or the store itself?**
Yes, through the second argument of `AIGateway`:
[`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md) `modelRegistry` and `aiProfileStore`. The
factory returns an `IModelRegistry` or an `IAIProfileStore`. A repository is enough in most cases.

## 7. API reference

| Symbol                                                                                          | What it is                                                                                                                  |
|-------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| [`IModelInfo`](../30-api/index/interfaces/IModelInfo.md)                                        | one model entry                                                                                                             |
| [`IModelCaps`](../30-api/index/interfaces/IModelCaps.md)                                        | its capabilities and prices                                                                                                 |
| [`EModelProvider`](../30-api/index/enumerations/EModelProvider.md)                              | the providers                                                                                                               |
| [`IModelRegistry`](../30-api/index/interfaces/IModelRegistry.md)                                | `gateway.modelRegistry`: `getModel`, `listModels`, `estimateCostUsd`, `upsertModel`, `setEnabled`, `removeModel`, `refresh` |
| [`IModelRegistryConfig`](../30-api/index/interfaces/IModelRegistryConfig.md)                    | `repository`, `cacheTtlMs`                                                                                                  |
| [`IModelRegistryRepository`](../30-api/index/interfaces/IModelRegistryRepository.md)            | the persistence contract of the models                                                                                      |
| [`InMemoryModelRegistryRepository`](../30-api/index/classes/InMemoryModelRegistryRepository.md) | the in-memory catalog                                                                                                       |
| [`IAIProfile`](../30-api/index/interfaces/IAIProfile.md)                                        | one profile                                                                                                                 |
| [`IAIProfileLimits`](../30-api/index/interfaces/IAIProfileLimits.md)                            | `maxStepsPerRun`, `maxOutputTokens`                                                                                         |
| [`IAIProfileStore`](../30-api/index/interfaces/IAIProfileStore.md)                              | `gateway.aiProfileStore`: `getProfile`, `listProfiles`, `upsertProfile`, `removeProfile`                                    |
| [`IAIProfileStoreConfig`](../30-api/index/interfaces/IAIProfileStoreConfig.md)                  | `repository`, `cacheTtlMs`                                                                                                  |
| [`IAIProfileRepository`](../30-api/index/interfaces/IAIProfileRepository.md)                    | the persistence contract of the profiles                                                                                    |
| [`InMemoryAIProfileRepository`](../30-api/index/classes/InMemoryAIProfileRepository.md)         | the in-memory profiles                                                                                                      |
| [`IAIGatewayConfig.defaultCheapModelId`](../30-api/index/interfaces/IAIGatewayConfig.md)        | the helper model of a profile without `cheapModelId`                                                                        |
| [`IGatewayAskInput.profileId`](../30-api/index/interfaces/IGatewayAskInput.md)                  | the profile of a call, `ask()` and `run()`                                                                                  |
| [`EJudgeModel`](../30-api/index/enumerations/EJudgeModel.md)                                    | which of the profile's models a guardrails judge uses                                                                       |
| [`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md)                      | the factories that replace the registry or the store                                                                        |
