---
sidebar_label: Prompt caching
description: "Cut LLM latency and input-token cost with prompt caching: keep the stable part of the system prompt identical across calls, put per-call text after it, and measure cache reads and writes per call. Anthropic, OpenAI and Bedrock, in TypeScript."
keywords: [prompt caching, LLM latency, Anthropic prompt caching, OpenAI prompt caching, token cost, cache_control, TypeScript]
---

# Cut LLM Latency and Cost with Prompt Caching: Keep the Stable Prefix Stable

Most of a system prompt is the same on every call of a use case: the template, the product's rules, and the tool definitions sent before it.
Providers cache such a prefix and bill the cached tokens at a fraction of the input price, and the answer starts sooner.
The cache only matches an exact prefix, so the practice is to keep the stable part byte for byte the same and to put every
per-call value after it.

## The problem

- One changing value at the top of the prompt (a date, the user's name) makes every call a cache miss.
- A short stable part is below the provider's minimum and is never cached.
- Without the cache numbers per call, nobody notices that the cache stopped working.

## The practice

1. **Turn it on.** With `contextAssembler.promptCaching: true`, the system prompt is sent as two blocks: the stable block
   (the template, the output format, the profile's addendum and skills) and the per-call block (the date, locale and timezone,
   `instructions`, `context`, memory, the knowledge base). Anthropic and Bedrock need the cache marker the stable block then carries.
   OpenAI caches on its own, also with the switch off. Before GPT-5.6 it caches the longest shared prefix, and the
   switch's cache key, made from the stable block, helps it route the calls that share the block to one cache. From
   GPT-5.6 on it sets the breakpoint at the end of the latest user message or tool result and can fall back to the end
   of an earlier message, never to the end of the system prompt; only an explicit breakpoint, which the gateway does
   not set (a known gap), marks the stable block, so calls that share only that block rarely share an entry, and the key only keeps the cache accounting of each key (per tenant, unless shared) apart.
2. **Nothing per call in the profile.** The addendum and the profile's skills are the same on every call. A date, a user
   name or a record belongs in `instructions` or `context`.
3. **Make the stable part worth caching.** A provider caches only a prefix above its minimum size. A short addendum is
   sent with the marker and not cached; a long addendum, the skills and many tools make it pay.
4. **Know what changes the stable block.** A call's own `skills`, its output format and an `outputSchema` (which drops the
   format text) are part of it, and `ask()`, like a `run()` on a model without tools, writes the skill bodies out where a `run()` with tools lists one
   line per skill. Calls
   that differ in one of these write separate entries. The tool set is part of the cached prefix too (Anthropic caches
   tools, then system): each distinct set of offered tools (`activeTools`, `additionalTools`, the user's permissions, the steps `requires` and `visibleWhen` narrow, `ask()`
   without tools) is
   its own entry.
5. **Measure.** The usage adapter and the trace get `cachedInputTokens` (read from the cache) and `cacheWriteInputTokens`
   (written by this call) per model call when the provider reports them; the `usage` of an `ask()` carries them too, the
   `usage` of a run sums only input and output tokens. OpenAI bills cache writes from GPT-5.6 on; earlier models have no
   cache-write charge.
6. **Decide the tenant boundary.** `sharePromptCacheAcrossTenants: false` gives each tenant its own entries. `true` lets
   tenants with a byte-identical stable block share one, in exchange for no cache isolation between them.

## In code

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
  modelId: "claude-haiku-4-5", // caches a prefix of 4 096 tokens or more
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
  console.log({inputTokens, cachedInputTokens, cacheWriteInputTokens}); // the second call within the cache lifetime reads, when the stable block is over the minimum
}
```

The cost estimate prices cached tokens at the model's cache rates. Only Anthropic models have default cache rates; an
OpenAI or a Bedrock model entry gets them set explicitly, or the estimate prices cached tokens at the full input price:

```ts
declare const gpt61Terra: IModelInfo; // your entry of gpt-6.1-terra

await gateway.modelRegistry.upsertModel({
  model: {...gpt61Terra, caps: {...gpt61Terra.caps, costCacheReadPerMTokUsd: 0.05, costCacheWritePerMTokUsd: 1.25}},
});
```

## Pitfalls

- **A per-call value in the addendum.** Every call writes a new entry and none reads one.
- **A stored template with a per-call slot before `{cacheBreakpoint}`.** The cache is off for the call, and the response
  carries the warning issue `prompt_cache_off`.
- **Expecting a cache on a short prompt.** Below the provider's minimum prefix the marker is sent and nothing is cached.
- **Sharing across tenants by default.** A faster or cheaper call can reveal that another tenant sent the same profile
  text minutes ago. Keep `false` unless the stable text is public, such as the library's own template.
- **Judging the cache by the bill alone.** Read `cachedInputTokens` per call in the trace or the usage adapter.
- **Mixing `ask()` and `run()`, or schemas, on one profile.** Each variant of the stable block, and each tool set, is its own entry, and each
  writes it once before it can be read.

## Checklist

- [ ] `contextAssembler.promptCaching` is `true`.
- [ ] Profiles hold no per-call values.
- [ ] Per-call values go into `instructions` and `context`.
- [ ] `cachedInputTokens` is visible in your usage reports.
- [ ] `sharePromptCacheAcrossTenants` is a decision, written down.

## Go further

- [Is the system prompt cached, and what does it cost?](../10-getting-started/90-faq.md#is-the-system-prompt-cached-and-what-does-it-cost):
  the providers, the minimum sizes, the prices.
- [System prompt layers](../60-architecture/40-system-prompt-production-layers.md): which layer is stable and which is
  per call.
- [Context engineering](010-context-engineering.md): where each kind of information goes.
