---
sidebar_label: Prompt caching
description: "Cut LLM latency and input-token cost with prompt caching: keep the stable part of the system prompt identical across calls, put per-call text after it, and measure cache reads and writes per call. Anthropic, OpenAI and Bedrock, in TypeScript."
keywords: [prompt caching, LLM latency, Anthropic prompt caching, OpenAI prompt caching, token cost, cache_control, TypeScript]
---

# Cut LLM Latency and Cost with Prompt Caching: Keep the Stable Prefix Stable

Most of a system prompt is the same on every call of a use case: the template, the product's rules, the tool definitions.
Providers cache such a prefix and bill the cached tokens at a fraction of the input price, and the answer starts sooner.
The cache only matches an exact prefix, so the practice is to keep the stable part byte for byte the same and to put every
per-call value after it.

## 1. The problem

- One changing value at the top of the prompt (a date, the user's name) makes every call a cache miss.
- A short stable part is below the provider's minimum and is never cached.
- Without the cache numbers per call, nobody notices that the cache stopped working.

## 2. The practice

1. **Turn it on.** With `contextAssembler.promptCaching: true`, the system prompt is sent as two blocks: the stable block
   (the template, the output format, the profile's addendum and skills) and the per-call block (the date, `instructions`,
   `context`, memory, the knowledge base). The stable block carries the provider's cache marker where the provider takes
   one.
2. **Nothing per call in the profile.** The addendum and the profile's skills are the same on every call. A date, a user
   name or a record belongs in `instructions` or `context`.
3. **Make the stable part worth caching.** A provider caches only a prefix above its minimum size. A short addendum is
   sent with the marker and not cached; a long addendum, the skills and many tools make it pay.
4. **Keep call skills stable.** A call's own `skills` are part of the stable block: calls with the same set share an
   entry, a different set writes another.
5. **Measure.** Every call reports `cachedInputTokens` (read from the cache) and `cacheWriteInputTokens` (written by this
   call) in its `usage`, to the usage adapter and the trace.
6. **Decide the tenant boundary.** `sharePromptCacheAcrossTenants: false` gives each tenant its own entries. `true` lets
   tenants with a byte-identical stable block share one, in exchange for no cache isolation between them.

## 3. In code

The samples run on your configuration and the caller's `userContext`. The setup they need is in
[Installation](../10-getting-started/20-installation.md).

The switch:

```ts
import {AIGateway, EGatewayResponseKind, IAIGatewayConfig, IAIProfile, IModelInfo, IUserContext} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;  // your configuration
declare const userContext: IUserContext; // who asks

const gateway = new AIGateway({
  ...config,
  contextAssembler: {...config.contextAssembler, promptCaching: true, sharePromptCacheAcrossTenants: false},
});
```

A profile whose addendum is the same on every call, and a call that puts its own values after it:

```ts
declare const longHouseRules: string; // the product's rules, the same text on every call

const support: IAIProfile = {
  id: "support",
  tenantId: "acme",
  name: "Customer support",
  modelId: "claude-haiku-4-5",
  promptAddendum: longHouseRules, // stable: cached
  allowedTools: [],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
};

await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: support});

declare const order: object; // the record on screen

const result = await gateway.ask({
  userContext,
  profileId: "support",
  prompt: "Can I still change the delivery address?",
  instructions: "The customer is a premium member.", // per call: after the cache breakpoint
  context: JSON.stringify(order),                   // per call: after the cache breakpoint
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.ANSWER) {
  const {inputTokens, cachedInputTokens, cacheWriteInputTokens} = result.usage;
  console.log({inputTokens, cachedInputTokens, cacheWriteInputTokens}); // the second call within the cache lifetime reads
}
```

The cost estimate prices cached tokens at the model's cache rates. An OpenAI model entry gets its cache-read rate set
explicitly, since the gateway assumes no discount for it:

```ts
declare const gpt5Mini: IModelInfo; // your entry of gpt-5-mini

await gateway.modelRegistry.upsertModel({
  model: {...gpt5Mini, caps: {...gpt5Mini.caps, costCacheReadPerMTokUsd: 0.025}},
});
```

## 4. Pitfalls

- **A per-call value in the addendum.** Every call writes a new entry and none reads one.
- **A stored template with a per-call slot before `{cacheBreakpoint}`.** The cache is off for the call, and the response
  carries the warning issue `prompt_cache_off`.
- **Expecting a cache on a short prompt.** Below the provider's minimum prefix the marker is sent and nothing is cached.
- **Sharing across tenants by default.** A faster or cheaper call can reveal that another tenant sent the same profile
  text minutes ago. Keep `false` unless the stable text is public, such as the library's own template.
- **Judging the cache by the bill alone.** Read `cachedInputTokens` per call in the trace or the usage adapter.

## 5. Checklist

- [ ] `contextAssembler.promptCaching` is `true`.
- [ ] Profiles hold no per-call values.
- [ ] Per-call values go into `instructions` and `context`.
- [ ] `cachedInputTokens` is visible in your usage reports.
- [ ] `sharePromptCacheAcrossTenants` is a decision, written down.

## 6. Go further

- [Is the system prompt cached, and what does it cost?](../10-getting-started/90-faq.md#is-the-system-prompt-cached-and-what-does-it-cost):
  the providers, the minimum sizes, the prices.
- [System prompt layers](../60-architecture/40-system-prompt-production-layers.md): which layer is stable and which is
  per call.
- [Context engineering](010-context-engineering.md): where each kind of information goes.
