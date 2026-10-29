# Usage adapter: the application decides every model call

The gateway holds no token logic: no budget, no plan, no quota, no remaining amount. Before **every** model call it asks the
application's usage adapter "may this call run?", and after the call it reports what the call used. Who may spend what, how
much is left, per day, per user, per model, in tokens, credits or money: all of that is the application's, inside its adapter
([D121](../architecture/Decisions.md#d121-the-application-decides-every-model-call)).

## 1. The contract

`IAIGatewayConfig.usageGuard.adapter` takes one `IUsageAdapter`:

| Method           | When                                                                            | What it receives                                                                                                      | What it answers                                                        |
|------------------|---------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| `check(args)`    | before every model call                                                         | the call's factors (`IUsageCheckArgs`) and `neededTokens`, a rough size of the call                                   | `{approved: true}` or `{approved: false, denyCode?, denyUserMessage?}` |
| `addUsage(args)` | after every approved `check`, also when the provider call failed or was aborted | the same factors (`IUsageAddArgs`), `date`, `usage` (the provider's tokens, all zero for a failed call) and `costUsd` | nothing                                                                |

The factors (`IUsageCall`) are everything the gateway knows about the call: `tenantId`, `userId`, `profileId`, `modelId`,
`kind` (`ETraceKind`: the answer, a run step, a guardrail judge, a query rewrite, a memory update, an embedding),
`threadId`, `runId` and `traceId`. The `traceId` is the same on `check` and on the matching `addUsage`, and it is the id of
the call's trace entry.

"Every model call" is literal: an `ask` with guardrails, knowledge base and memory makes about five to eight of them, and
each is checked and reported on its own. Keep `check` fast or cached.

- A `check` that **throws** is a denial (the gateway fails closed), logged with the `denyCode` `usage_check_failed`.
- An `addUsage` that throws is logged; the answer is still returned.
- `usage` carries `inputTokens` (the whole prompt), `outputTokens` and, when the provider reports them, `cachedInputTokens`
  and `cacheWriteInputTokens`, the part of the prompt read from or written to the provider's prompt cache (see the FAQ,
  "Is the system prompt cached, and what does it cost?").
- `costUsd` is informative: the model's list prices times the tokens, the cached ones at the model's cache rates. An
  application that bills in its own currency or in credits computes from `usage`.

## 2. An adapter

A tenant limit and a user limit per day, kept in the application's own table. The reservation by `traceId` lets `check`
count the call at once, so two concurrent calls cannot both pass on the same remaining amount; `addUsage` replaces the
estimate with the real count.

```ts
import {ETraceKind, IAIGatewayConfig, IUsageAdapter, IUsageAddArgs, IUsageCheckArgs, IUsageCheckResult} from "dyna-ai-gateway";

export class PlanUsageAdapter implements IUsageAdapter {
  constructor(private readonly db: UsageDb) {}

  public async check(args: IUsageCheckArgs): Promise<IUsageCheckResult> {
    const needed = args.neededTokens.input + args.neededTokens.output;
    const [tenant, user] = await Promise.all([
      this.db.todayTokens({tenantId: args.tenantId}),
      this.db.todayTokens({tenantId: args.tenantId, userId: args.userId}),
    ]);
    if (tenant.used + tenant.reserved + needed > tenant.limit) {
      return {approved: false, denyCode: "tenant_plan_exhausted", denyUserMessage: "Your organisation's plan is used up for today."};
    }
    if (args.userId && user.used + user.reserved + needed > user.limit) {
      return {approved: false, denyCode: "user_limit_reached", denyUserMessage: "You have reached your daily limit."};
    }
    await this.db.reserve({traceId: args.traceId, tenantId: args.tenantId, userId: args.userId, tokens: needed});
    return {approved: true};
  }

  public async addUsage(args: IUsageAddArgs): Promise<void> {
    await this.db.settle({
      traceId: args.traceId,
      tokens: args.usage.inputTokens + args.usage.outputTokens,
      costUsd: args.costUsd,
      date: args.date,
    });
  }
}

const config: IAIGatewayConfig = {
  // …
  usageGuard: {adapter: new PlanUsageAdapter(usageDb)},
};
```

`UsageDb` stands for the application's own storage; the gateway ships no table for it. The rules are plain code: a free
plan that may use the cheap model only (`args.modelId`), a helper call (`args.kind !== ETraceKind.CHAT`) that is always
approved, a test tenant with no limit.

For tests and the sandbox, `InMemoryUsageAdapter` approves every call, records every `check` and `addUsage`
(`checkCalls`, `addUsageCalls`) and denies when its `deny` option says so. It enforces nothing.

## 3. What a denied call does

The gateway refuses the model call and passes the application's `denyCode` and `denyUserMessage` through unchanged, as an
issue with the code `usage_denied` (`USAGE_DENIED_ISSUE_CODE`): `IIssue.userMessage` is the `denyUserMessage`, `IIssue.data.denyCode`
the `denyCode`. A host shows `userMessage` to the user and never `message`.

| Denied call                                          | Effect                                                                                                                                               |
|------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| The answer of an `ask`, or the first step of a `run` | `FAILED` response, reason "The usage adapter refused the model call", one ERROR issue `usage_denied`. Nothing of the model's is stored               |
| A later step of a `run`                              | The run ends as a truncated one: `DONE`, finish reason `LENGTH`, a WARNING issue `usage_denied` on the answer; the steps that ran stay in the thread |
| An input guardrail judge                             | The call is `FAILED` as above: an input check that could not run has not passed                                                                      |
| An output guardrail judge                            | The answer is refused, like a blocked answer, with the `usage_denied` issue                                                                          |
| A memory update, a user-facts extraction             | Skipped silently; the memory keeps its state                                                                                                         |
| A query rewrite                                      | The search runs with the user's question as it is                                                                                                    |
| An embedding of a knowledge-base save                | The save fails with the denial; the re-index of a book stops at it                                                                                   |

A denial is never an exception on the application's side of `ask()` / `run()`: it is a response, like an abort or a blocked
answer. Code that works with the gateway's lower layers recognises the thrown error with `isUsageDeniedError`.

## 4. What the gateway does not do

- It keeps no totals and no history of its own: the trace (`ITraceEntry.usage`, `costUsd`) is a log, not a ledger.
- It does not stop a run before its `maxStepsPerRun` on its own; only the adapter's "no" does.
- It does not estimate exactly: `neededTokens.input` is the request counted with the `o200k_base` tokenizer, exact for OpenAI
  models and 20% over the count for the other providers, whose tokenizers are not public; an image or a PDF is priced with the
  providers' published formulas. `output` is the call's `maxOutputTokens`, the worst case. The real count arrives with `addUsage`.
