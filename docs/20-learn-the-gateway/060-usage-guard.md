# Token control with the Usage Guard

The gateway holds no budget, plan, quota or ledger. Before every model call it asks your usage adapter whether the call may
run, and after the call it tells the adapter what the call used. Your adapter applies your rules: per tenant, per user, per
model, in tokens, credits or money. The profile adds two caps of its own: the output of one answer and the steps of one run.

## 1. About

| Part                                                                      | Who writes it    | What it does                                                                                    |
|---------------------------------------------------------------------------|------------------|-------------------------------------------------------------------------------------------------|
| [`IUsageAdapter`](../30-api/index/interfaces/IUsageAdapter.md)            | you              | `check` answers "may this call run?", `addUsage` receives what it used                          |
| `UsageGuard`                                                              | the gateway      | wraps your adapter: a `check` that throws is a denial, an `addUsage` that throws is logged      |
| [`InMemoryUsageAdapter`](../30-api/index/classes/InMemoryUsageAdapter.md) | the gateway      | approves every call and records it; for tests and the sandbox                                   |
| [`IAIProfileLimits`](../30-api/index/interfaces/IAIProfileLimits.md)      | you, per profile | `maxOutputTokens` caps one answer, `maxStepsPerRun` caps the steps of one `run()` or `resume()` |

The adapter is set once, in `IAIGatewayConfig.usageGuard`. The key is required:

```ts
usageGuard: {adapter: new InMemoryUsageAdapter()},
```

The decision behind the feature is [D121](../60-architecture/90-decisions.md#d121-the-application-decides-every-model-call).

## 2. Logic

### 2.1 Every model call is asked and reported

The question is asked inside the gateway's model client, so no call can skip it. That covers the answer of an `ask()`,
every step of a `run()` and `resume()`, and every helper call: a guardrail judge, a query rewrite, a thread-memory update, a
user-memory extraction, an embedding of the knowledge-base search or of an ingestion.

1. The gateway calls `check` with the call's factors and its rough size.
2. `approved: false`: the provider is not called, and nothing is reported.
3. `approved: true`: the provider is called.
4. After the call, the gateway calls `addUsage` with the factors, the tokens and the estimated cost. It does so also when
   the provider failed or the call was aborted, then with zero tokens and a cost of 0.

The two calls of one model call carry the same `traceId`. An adapter that reserves in `check` settles the reservation in
`addUsage` by that id.

### 2.2 What the adapter receives

Both calls carry the factors of [`IUsageCall`](../30-api/index/interfaces/IUsageCall.md):

| Field       | Content                                                                             |
|-------------|-------------------------------------------------------------------------------------|
| `traceId`   | the id of the call's trace entry; pairs a `check` with its `addUsage`               |
| `tenantId`  | the tenant that pays                                                                |
| `userId`    | the user; absent for a system job                                                   |
| `profileId` | the profile the call runs on; absent for a system job                               |
| `modelId`   | the model that answers: the profile's main or cheap model, or the embedding model   |
| `kind`      | what the call is for, an [`ETraceKind`](../30-api/index/enumerations/ETraceKind.md) |
| `threadId`  | the thread; absent outside a thread (an embedding, an ingestion)                    |
| `runId`     | the run the call is a step of; absent outside a run                                 |

`check` adds `neededTokens` ([`IUsageCheckArgs`](../30-api/index/interfaces/IUsageCheckArgs.md)):

| Field    | Content                                                                                        |
|----------|------------------------------------------------------------------------------------------------|
| `input`  | the estimated tokens of the request: a real tokenizer for OpenAI, a safe factor for the others |
| `output` | the call's `maxOutputTokens`, the worst case; 0 for an embedding                               |

`addUsage` adds `date`, `usage` and `costUsd` ([`IUsageAddArgs`](../30-api/index/interfaces/IUsageAddArgs.md)).

The `kind` values:

| `kind`            | The call                                           |
|-------------------|----------------------------------------------------|
| `CHAT`            | the answer of an `ask()`                           |
| `RUN_STEP`        | one step of a `run()` or a `resume()`              |
| `GUARDRAIL_JUDGE` | the judge of an input or output rule               |
| `QUERY_REWRITE`   | the rewrite of a follow-up question for the search |
| `MEMORY_WORKING`  | the update of a thread's memory                    |
| `MEMORY_USER`     | the extraction of user facts                       |
| `EMBED`           | the embedding of a search query or of an ingestion |

### 2.3 What a denial does

The adapter's `denyCode` and `denyUserMessage` travel through unchanged. On the response they are the issue
`usage_denied` ([`USAGE_DENIED_ISSUE_CODE`](../30-api/index/variables/USAGE_DENIED_ISSUE_CODE.md)): `data.denyCode` is the
code, `userMessage` is the message. The call never throws for a denial, except an ingestion, which has no response.

| Refused call                  | Effect                                                                                                                                       |
|-------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| the answer of an `ask()`      | `FAILED`, one ERROR issue `usage_denied`                                                                                                     |
| the first step of a `run()`   | `FAILED`, one ERROR issue `usage_denied`; no run is stored, no tool ran                                                                      |
| a later step of a run         | `ANSWER` with the text so far and two WARNING issues, `usage_denied` and `output_truncated`                                                  |
| an input rule's judge         | `FAILED`, one ERROR issue `usage_denied` (not `rule_error`); the answer is never asked for                                                   |
| an output rule's judge        | `FAILED`, one ERROR issue `usage_denied`; a streamed answer is withdrawn with `ANSWER_WITHDRAWN`                                             |
| the embedding of the search   | `FAILED`, one ERROR issue `usage_denied`                                                                                                     |
| the query rewrite             | the search uses the question as written; the call goes on                                                                                    |
| a thread-memory update        | skipped; the answer stands, the memory catches up on a later turn                                                                            |
| a user-memory extraction      | skipped; the known facts stay as they are                                                                                                    |
| the embedding of an ingestion | `ingestDocument` throws a 429 ([`isUsageDeniedError`](../30-api/index/functions/isUsageDeniedError.md)); `reindexBook` throws the same error |

A later step keeps the earlier ones because their tools have already had their effect. The run ends the way the step
limit ends it ([How does a run end](../10-getting-started/90-faq.md#how-does-a-run-end-and-can-a-tool-end-it)). What a
`FAILED` call stored before the denial, its user turn for example, stays in the thread.

### 2.4 A failing adapter

| The adapter       | The gateway                                                                                                                                                                |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `check` throws    | logs the error and refuses the call with the `denyCode` `usage_check_failed` ([`USAGE_CHECK_FAILED_DENY_CODE`](../30-api/index/variables/USAGE_CHECK_FAILED_DENY_CODE.md)) |
| `addUsage` throws | logs the error and returns the answer                                                                                                                                      |

The check fails closed: an adapter that cannot answer has not said yes. The report never breaks a call that already ran.

### 2.5 Tokens and cost

[`IUsage`](../30-api/index/interfaces/IUsage.md) is what the provider reported for one call:

| Field                   | Content                                                 |
|-------------------------|---------------------------------------------------------|
| `inputTokens`           | every prompt token, the cached ones included            |
| `outputTokens`          | the generated tokens: the answer and its tool calls     |
| `cachedInputTokens`     | of `inputTokens`, those read from the provider's cache  |
| `cacheWriteInputTokens` | of `inputTokens`, those written to the provider's cache |

The same `usage` reaches `addUsage`, the trace entry and the stored assistant turn. `IAnswerResponse.usage` is the usage of
the answer's call; for a run it is the sum over its steps.

`costUsd` is an estimate at the model's list prices
([`IModelCaps`](../30-api/index/interfaces/IModelCaps.md)), per million tokens:

| Tokens                                                              | Price                      | Default when not set                                             |
|---------------------------------------------------------------------|----------------------------|------------------------------------------------------------------|
| `inputTokens` − `cachedInputTokens` − `cacheWriteInputTokens` (≥ 0) | `costInPerMTokUsd`         | required                                                         |
| `cachedInputTokens`                                                 | `costCacheReadPerMTokUsd`  | Anthropic: 0.1 × `costInPerMTokUsd`; others: `costInPerMTokUsd`  |
| `cacheWriteInputTokens`                                             | `costCacheWritePerMTokUsd` | Anthropic: 1.25 × `costInPerMTokUsd`; others: `costInPerMTokUsd` |
| `outputTokens`                                                      | `costOutPerMTokUsd`        | required                                                         |

The estimate knows no exchange rate, discount or contract price. An app that bills in its own currency or in credits
computes from `usage`. A cost estimate that fails is logged, and the call is reported with `costUsd: 0`. The same estimate
is available as `gateway.modelRegistry.estimateCostUsd`. When and how the prompt cache produces read and write tokens is in
[Is the system prompt cached](../10-getting-started/90-faq.md#is-the-system-prompt-cached-and-what-does-it-cost).

### 2.6 The profile's caps

| Limit             | What it caps                                                                                                                       |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------|
| `maxOutputTokens` | the output of the answer and of each run step, at most the model's `caps.maxOutputTokens`; a cut answer carries `output_truncated` |
| `maxStepsPerRun`  | the model calls of one `run()`, and again of each `resume()`; reached, the run ends with the text so far and `output_truncated`    |

The caps also shape the question to the adapter: `neededTokens.output` of an answer or a step is the capped
`maxOutputTokens`. The helper calls (judge, query rewrite, memory) carry small output caps of their own. The caps bound one
call and one run, not spend: what a tenant may spend in a day is your adapter's rule.

## 3. Examples

The `config`, the `gpt5Mini` model and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md).

### 3.1 A daily token budget per tenant

The adapter reserves the worst case in `check` and replaces it with the real count in `addUsage`. Two calls in flight on
the same tenant cannot both pass on the same remainder.

```ts
import {
  AIGateway,
  IUsageAdapter,
  IUsageAddArgs,
  IUsageCheckArgs,
  IUsageCheckResult,
} from "dyna-ai-gateway";

const DAILY_TOKENS_PER_TENANT = 2_000_000;

interface IReservation {
  key: string;
  tokens: number;
}

class DailyTokenBudget implements IUsageAdapter {
  private readonly spent = new Map<string, number>();             // tenant and day -> tokens
  private readonly reservations = new Map<string, IReservation>(); // traceId -> reservation

  public async check(args: IUsageCheckArgs): Promise<IUsageCheckResult> {
    const key = `${args.tenantId}:${new Date().toISOString().slice(0, 10)}`;
    const tokens = args.neededTokens.input + args.neededTokens.output;
    const spent = this.spent.get(key) ?? 0;
    if (spent + tokens > DAILY_TOKENS_PER_TENANT) {
      return {
        approved: false,
        denyCode: "daily_limit_reached",
        denyUserMessage: "Your team has used today's AI budget. It resets at midnight UTC.",
      };
    }
    this.spent.set(key, spent + tokens);
    this.reservations.set(args.traceId, {key, tokens});
    return {approved: true};
  }

  public async addUsage(args: IUsageAddArgs): Promise<void> {
    const reservation = this.reservations.get(args.traceId);
    if (!reservation) return;
    this.reservations.delete(args.traceId);
    const used = args.usage.inputTokens + args.usage.outputTokens;
    this.spent.set(reservation.key, (this.spent.get(reservation.key) ?? 0) - reservation.tokens + used);
  }
}

const gateway = new AIGateway({
  ...config,
  usageGuard: {adapter: new DailyTokenBudget()},
});
```

The maps live in one process. With several server instances, keep the ledger in your database and make the reservation
one atomic update.

### 3.2 A model per plan

The adapter decides on the factors, not only on the numbers. A free plan answers with the cheap model only, and its
helper calls run.

```ts
import {ETraceKind, IUsageAdapter, IUsageAddArgs, IUsageCheckArgs, IUsageCheckResult} from "dyna-ai-gateway";

const freeTenants = new Set(["trial-42"]);

class PlanByModel implements IUsageAdapter {
  public async check({tenantId, modelId, kind}: IUsageCheckArgs): Promise<IUsageCheckResult> {
    const isAnswer = kind === ETraceKind.CHAT || kind === ETraceKind.RUN_STEP;
    if (freeTenants.has(tenantId) && isAnswer && modelId !== "gpt-5-mini") {
      return {
        approved: false,
        denyCode: "model_not_in_plan",
        denyUserMessage: "This assistant needs the Pro plan.",
      };
    }
    return {approved: true};
  }

  public async addUsage(args: IUsageAddArgs): Promise<void> {
    console.info(`[usage] ${args.tenantId} ${args.kind} ${args.modelId} ${args.usage.inputTokens}/${args.usage.outputTokens} $${args.costUsd}`);
  }
}
```

### 3.3 Showing a denial to the user

```ts
import {EGatewayResponseKind, USAGE_DENIED_ISSUE_CODE} from "dyna-ai-gateway";

const result = await gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "Book the three open invoices of October.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

const denied = result.kind === EGatewayResponseKind.FAILED || result.kind === EGatewayResponseKind.ANSWER
  ? result.issues.find(issue => issue.code === USAGE_DENIED_ISSUE_CODE)
  : undefined;

if (denied) {
  denied.severity;      // ERROR on FAILED: nothing was answered. WARNING on ANSWER: a later step was refused, the text is partial.
  denied.userMessage;   // "Your team has used today's AI budget. It resets at midnight UTC.": show it as it is
  denied.data?.denyCode; // "daily_limit_reached": branch on it, e.g. to show the upgrade button
}
```

### 3.4 A refused ingestion

An ingestion has no response, so `ingestDocument` throws the denial.

```ts
import {IKbDocument, isUsageDeniedError} from "dyna-ai-gateway";

const doc: IKbDocument = {
  id: "refund-policy",
  libraryId: "support",
  bookId: "policies",
  title: "Refunds",
  markdown: "# Refunds\n\nA refund is possible within 14 days of delivery.",
  tags: [],
  language: "en",
};

try {
  await gateway.kbIngestor.ingestDocument({tenantId: "acme", doc, userId: "u-17"});
} catch (error) {
  if (!isUsageDeniedError(error)) throw error;
  // error.status === 429, error.data.denyCode === "daily_limit_reached"; nothing was embedded or reported
}
```

### 3.5 Cache prices on a model

An OpenAI model gets no cache-read discount by default. Set the rate on the model entry so the estimate shows it.

```ts
await gateway.modelRegistry.upsertModel({
  model: {...gpt5Mini, caps: {...gpt5Mini.caps, costCacheReadPerMTokUsd: 0.025}},
});

const costUsd = await gateway.modelRegistry.estimateCostUsd({
  modelId: "gpt-5-mini",
  inputTokens: 12_000,
  cachedInputTokens: 10_000,
  outputTokens: 400,
});
// 2 000 × 0.25 + 10 000 × 0.025 + 400 × 2, per million tokens: 0.00155 USD
```

### 3.6 Tests: script the denial

`InMemoryUsageAdapter` records every `check` and `addUsage` in `checkCalls` and `addUsageCalls`. Its `deny` option
refuses the calls it picks: `true` refuses with the `denyCode` `denied_by_test`, a result with `approved: false` refuses
with that result.

```ts
import {AIGateway, ETraceKind, InMemoryUsageAdapter} from "dyna-ai-gateway";

const usageAdapter = new InMemoryUsageAdapter({
  deny: call => call.kind === ETraceKind.CHAT
    ? {approved: false, denyCode: "plan_exhausted", denyUserMessage: "Your plan is used up for today."}
    : false,
});
const gateway = new AIGateway({...config, usageGuard: {adapter: usageAdapter}});

await gateway.ask({userContext, profileId: "accounting", prompt: "Hi", kbFilters: {libraryIds: [], bookIds: []}}).response;
usageAdapter.checkCalls.map(call => call.kind); // [ETraceKind.CHAT]
usageAdapter.addUsageCalls.length;              // 0: a refused call is not reported
```

## 4. Pitfalls

- **`InMemoryUsageAdapter` in production.** It approves every call and forgets everything at a restart. It is a test
  double, not a limit.
- **Checking only the answer.** The adapter is asked for every call, helpers included. An `ask()` with guardrails, a
  knowledge base and memory makes several. A rule that counts only `CHAT` lets the judge, rewrite, memory and embedding
  calls spend freely.
- **A slow `check`.** It runs before every model call and delays each of them. Keep the read fast or cache it.
- **A `check` that throws on a missing row.** A throw is a denial (`usage_check_failed`), so a new tenant without a ledger
  row gets no answer. Answer explicitly instead.
- **Reading and writing the remainder in two steps.** Two calls in flight can both pass on the same remainder. Reserve in
  `check`, settle in `addUsage` by `traceId`
  ([What no check covers](../60-architecture/10-architecture-and-trade-offs.md#53-what-no-check-covers)).
- **Settling only on success.** `addUsage` comes also for a failed or aborted call, with zero tokens. An adapter that
  ignores it keeps the reservation forever.
- **Billing from `costUsd`.** It is a list-price estimate in USD. Bill from `usage` with your own prices.
- **Showing `message`.** The issue's `message` is for the log and names the trace id. Show `userMessage`, and branch on
  `data.denyCode`.
- **`maxStepsPerRun` as a budget.** It caps the steps of one `run()` or `resume()`; the next call starts with the full
  count. Spend per day or per plan belongs in the adapter.
- **A refused query rewrite in the error log.** The search goes on with the question as written, and the refusal is
  logged as an internal error of the rewrite. Refuse `QUERY_REWRITE` only when you mean it.

## 5. Summary

- `IAIGatewayConfig.usageGuard.adapter` is required: your `IUsageAdapter` decides every model call.
- `check` before the call, with the factors and `neededTokens`; `addUsage` after every approved call, also a failed or
  aborted one, with `usage` and `costUsd`. One `traceId` pairs them.
- A denial is the issue `usage_denied` with your `denyCode` and `denyUserMessage`: `FAILED` when the call cannot go on, a
  WARNING on a run cut after its first step, a skipped memory update, a 429 on an ingestion.
- A `check` that throws refuses the call; an `addUsage` that throws is logged.
- `costUsd` prices uncached, cache-read, cache-write and output tokens at the model's list prices.
- `maxOutputTokens` and `maxStepsPerRun` cap one answer and one run; spend is the adapter's.

## 6. FAQ

**Does the gateway count tokens per tenant or per day?**
No. It keeps no totals. The adapter receives every call and keeps whatever ledger your plans need.

**Is the denied call in the trace?**
No. The provider was not called, so there is no entry and no report. The response's issue carries the trace id the call
would have had, in its `message`.

**Does an aborted call cost anything in the report?**
It is reported with zero tokens and `costUsd: 0`. The provider bills its own count; the gateway gets none from a cut
stream.

**Can I refuse only some users of a tenant?**
Yes. `check` receives `userId`, `profileId`, `modelId` and `kind`; decide on any of them. A system job such as an
ingestion without a user has no `userId`.

**Where do I see the cost of one answer?**
In the trace entry of the call (`costUsd`) and in the `addUsage` report. The response carries `usage`, the tokens, not
the cost.

**How do I lower the cost of a long system prompt?**
Turn on prompt caching and keep the stable part of the prompt the same across calls
([Is the system prompt cached](../10-getting-started/90-faq.md#is-the-system-prompt-cached-and-what-does-it-cost)).
`cachedInputTokens` and `cacheWriteInputTokens` then show the effect in every report.

## 7. API reference

| Symbol                                                                                      | What it is                                                     |
|---------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| [`IAIGatewayConfig.usageGuard`](../30-api/index/interfaces/IAIGatewayConfig.md)             | where the adapter is set                                       |
| [`IUsageGuardConfig`](../30-api/index/interfaces/IUsageGuardConfig.md)                      | `adapter`                                                      |
| [`IUsageAdapter`](../30-api/index/interfaces/IUsageAdapter.md)                              | the contract you implement: `check`, `addUsage`                |
| [`IUsageCall`](../30-api/index/interfaces/IUsageCall.md)                                    | the factors of a call                                          |
| [`IUsageCheckArgs`](../30-api/index/interfaces/IUsageCheckArgs.md)                          | the question: the factors and `neededTokens`                   |
| [`IUsageCheckResult`](../30-api/index/interfaces/IUsageCheckResult.md)                      | the answer: `approved`, `denyCode`, `denyUserMessage`          |
| [`IUsageAddArgs`](../30-api/index/interfaces/IUsageAddArgs.md)                              | the report: the factors, `date`, `usage`, `costUsd`            |
| [`IUsage`](../30-api/index/interfaces/IUsage.md)                                            | input, output, cache-read and cache-write tokens               |
| [`IModelCaps`](../30-api/index/interfaces/IModelCaps.md)                                    | the list prices, the cache prices, `maxOutputTokens`           |
| [`IModelRegistry`](../30-api/index/interfaces/IModelRegistry.md)                            | `estimateCostUsd`                                              |
| [`IAIProfileLimits`](../30-api/index/interfaces/IAIProfileLimits.md)                        | `maxOutputTokens`, `maxStepsPerRun`                            |
| [`USAGE_DENIED_ISSUE_CODE`](../30-api/index/variables/USAGE_DENIED_ISSUE_CODE.md)           | `"usage_denied"`, the issue code                               |
| [`USAGE_CHECK_FAILED_DENY_CODE`](../30-api/index/variables/USAGE_CHECK_FAILED_DENY_CODE.md) | `"usage_check_failed"`, the `denyCode` of a `check` that threw |
| [`USAGE_DENIED_ERROR_CODE`](../30-api/index/variables/USAGE_DENIED_ERROR_CODE.md)           | the `code` of the 429 an ingestion throws                      |
| [`IUsageDeniedErrorData`](../30-api/index/interfaces/IUsageDeniedErrorData.md)              | its `data`: `traceId`, `denyCode`, `denyUserMessage`           |
| [`isUsageDeniedError`](../30-api/index/functions/isUsageDeniedError.md)                     | recognises that error                                          |
| [`IUsageGuard`](../30-api/index/interfaces/IUsageGuard.md)                                  | the contract to pass in `overrides` to replace the guard       |
| [`InMemoryUsageAdapter`](../30-api/index/classes/InMemoryUsageAdapter.md)                   | the adapter of tests and the sandbox                           |
| [`IInMemoryUsageAdapterConfig`](../30-api/index/interfaces/IInMemoryUsageAdapterConfig.md)  | its `deny` option                                              |
| [`IN_MEMORY_USAGE_DENY_CODE`](../30-api/index/variables/IN_MEMORY_USAGE_DENY_CODE.md)       | `"denied_by_test"`                                             |
