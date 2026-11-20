---
sidebar_label: Control LLM costs
description: "Control LLM API costs per tenant and per user in TypeScript: a usage adapter that refuses a model call before it spends, reserves the worst case and settles the real tokens, covers helper calls, and shows the user a clear message."
keywords: [LLM cost control, token budget, OpenAI cost, Anthropic cost, rate limiting, usage limits, quota, TypeScript]
---

# Control LLM Costs: Per-Tenant and Per-User Token Budgets That Refuse Before They Spend

A model call costs money before you know whether it was worth it. A loop that runs away, a tenant on a free plan that
uses the expensive model, a user who pastes a book into the chat: the bill shows it a month later. The practice is to
decide every model call before it runs, against your own budget, and to record what it really used right after.

## The problem

- A spend limit at the provider applies to the organization, a project or a workspace, monthly, not to a user or a plan. When your customers
  share one project, it stops all of them at once.
- Counting only the chat answers misses the helper calls: guardrail judges, query rewrites, memory updates, embeddings.
- A check that reads the remaining budget and writes it later lets two parallel calls spend the same remainder.
- A call refused with a technical error leaves the user without a reason or a next step.

## The practice

1. **Ask before every call.** The gateway asks your usage adapter before every model call, helpers included, with the
   tenant, the user, the profile, the model, the kind of call and the estimated tokens. A `false` means the provider is
   not called.
2. **Reserve the worst case, settle the real count.** `check` receives the estimated input tokens and the output cap, the
   worst case. Reserve that amount; `addUsage` arrives after the call with the provider's token count and the same
   `traceId`, and replaces the reservation. It arrives for a failed or aborted call too, with zero tokens: the gateway does not
   count a call it does not return. The provider may still bill such a call (the tokens of a stream before it was stopped, a request
   that finished after a timeout), so reconcile the ledger with the provider's usage report.
3. **Make the reservation atomic.** One conditional update in your database, so two calls in flight cannot both pass on
   the same remainder.
4. **Refuse with a reason.** A refusal carries your `denyCode` and `denyUserMessage`. The user reads the message; your UI
   branches on the code, for example to show the upgrade button.
5. **Fail closed.** A `check` that throws refuses the call. An adapter that cannot answer has not said yes.
6. **Bound one call and one run in the profile.** `limits.maxOutputTokens` caps one answer, `limits.maxStepsPerRun` the
   model calls of a `run()`, and again of each `resume()`. Spend per day or per plan stays in the adapter.
7. **Run the helpers on a cheap model.** The profile's `cheapModelId` serves the judges, the query rewrite and the memory
   updates. A profile without one runs its judges on the main model, and its rewrite and memory updates on the gateway's
   `defaultCheapModelId`.

## In code

The samples run on your configuration and the caller's `userContext`. The setup they need is in the learning path
[Run it in production](../24-learning-paths/080-run-it-in-production.md).

A daily budget per tenant, over a ledger in your database:

```ts
import {
  AIGateway,
  EGatewayResponseKind,
  IAIGatewayConfig,
  IUsageAdapter,
  IUsageAddArgs,
  IUsageCheckArgs,
  IUsageCheckResult,
  IUserContext,
  USAGE_DENIED_ISSUE_CODE,
} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;  // your configuration
declare const userContext: IUserContext; // who asks
declare const ledger: {                  // your database: each method is one atomic statement
  reserve(args: {tenantId: string; traceId: string; tokens: number; limit: number}): Promise<boolean>;
  settle(args: {traceId: string; tokens: number}): Promise<void>;
};

const DAILY_TOKENS_PER_TENANT = 2_000_000;

class DailyTenantBudget implements IUsageAdapter {
  public async check({tenantId, traceId, neededTokens}: IUsageCheckArgs): Promise<IUsageCheckResult> {
    const reserved = await ledger.reserve({
      tenantId,
      traceId,
      tokens: neededTokens.input + neededTokens.output, // the worst case of this call
      limit: DAILY_TOKENS_PER_TENANT,
    });
    return reserved
      ? {approved: true}
      : {approved: false, denyCode: "daily_limit_reached", denyUserMessage: "Your team has used today's AI budget. It resets at midnight UTC."};
  }

  public async addUsage({traceId, usage}: IUsageAddArgs): Promise<void> {
    await ledger.settle({traceId, tokens: usage.inputTokens + usage.outputTokens}); // the real count replaces the reservation
  }
}

const gateway = new AIGateway({...config, usageGuard: {adapter: new DailyTenantBudget()}});
```

The refusal, on the screen:

```ts
declare function showToUser(text: string): void;   // your UI
declare function showUpgradeButton(): void;         // your UI

const result = await gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "Summarise the open invoices of October.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.FAILED || result.kind === EGatewayResponseKind.ANSWER) {
  const denied = result.issues.find(issue => issue.code === USAGE_DENIED_ISSUE_CODE);
  if (denied?.userMessage) showToUser(denied.userMessage);      // your denyUserMessage, as it is
  if (denied?.data?.denyCode === "daily_limit_reached") showUpgradeButton();
}
```

On a `FAILED` response the denial is an `ERROR`: nothing was answered. On an `ANSWER` it is a `WARNING`: a later step of
the run was refused, and the text is that of the last step that completed, often empty when that step called tools. An
`ask()` has no later step: a refused answer, judge or search embedding is a `FAILED`; a refused query rewrite is skipped and the prompt is searched as typed. A refused memory update after the
answer is skipped, and the answer stands.

## Pitfalls

- **`InMemoryUsageAdapter` in production.** It approves every call. It is a test double, not a limit.
- **A rule that counts only the answers.** The `kind` of the call says what it is for; a budget that skips the judge,
  rewrite, memory and embedding calls lets them spend freely.
- **Read, then write.** Two calls in flight pass on the same remainder. Reserve in `check`, settle in `addUsage`.
- **Settling only successful calls.** `addUsage` also arrives for a failed or aborted call, with zero tokens. An adapter
  that ignores it keeps the reservation forever.
- **Zero taken as the bill.** The zero of an aborted call is what the gateway knows, not what the provider charges.
- **A slow `check`.** It runs before every model call. Keep the read fast.
- **Billing from `costUsd`.** It is an estimate at list prices, in USD. Bill from `usage` with your own prices.
- **`maxStepsPerRun` as a budget.** It caps one invocation: the next run, and each `resume()` of a paused one, starts
  with the full count.

## Checklist

- [ ] A usage adapter of your own decides every call, by tenant, user, model or plan.
- [ ] `check` reserves atomically; `addUsage` settles by `traceId`, also for zero tokens.
- [ ] Every refusal has a `denyCode` and a `denyUserMessage`.
- [ ] Profiles have `maxOutputTokens`, `maxStepsPerRun` and a `cheapModelId`.

## Go further

- [Token control with the Usage Guard](../20-learn-the-gateway/060-usage-guard.md): what the adapter receives, what a
  denial does per kind of call, how the cost is estimated.
- [Prompt caching](110-prompt-caching.md): fewer billed input tokens for the same prompt.
- [Models and profiles](../20-learn-the-gateway/010-models-and-profiles.md): a profile names its model and its cheap
  model.
