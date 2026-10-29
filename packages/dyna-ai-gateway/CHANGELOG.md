# Changelog

All notable changes to `dyna-ai-gateway` are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com); versions follow [semver](https://semver.org). A breaking change lists
what breaks, the migration, and an AI prompt that performs the migration in your codebase.

## [Unreleased]

### Breaking changes

- **`IModelRequest.system` is `ISystemBlock[]`, not `string`.** Affects a host that overrides the `LLMClient` or the
  `ContextAssembler` (`overrides` of the `AIGateway` constructor), builds an `IModelRequest` itself, or reads
  `request.system` from a stored run or trace entry. A host that only calls `ask()` / `run()` is not affected:
  `IAnswerDebug.system` stays a string.

  The system prompt is now an ordered list of blocks, `{text: string; cache?: boolean}`, so a provider's prompt cache can
  be told where the stable part ends. `joinSystem({blocks})` (exported) gives the blocks as one text, the texts joined
  with a blank line.

  Migration — building a request:

  ```ts
  // before
  const request: IModelRequest = {modelId, system: "You are the assistant.", messages, maxOutputTokens};
  // after
  const request: IModelRequest = {modelId, system: [{text: "You are the assistant."}], messages, maxOutputTokens};
  ```

  Migration — reading a request:

  ```ts
  // before
  const text = request.system;
  // after
  import {joinSystem} from "dyna-ai-gateway";
  const text = joinSystem({blocks: request.system});
  ```

  AI prompt that performs the migration:

  ```text
  Migrate this codebase to dyna-ai-gateway 0.0.1-beta.3, where `IModelRequest.system` changed from `string` to
  `ISystemBlock[]` (`ISystemBlock` is `{text: string; cache?: boolean}`; both exported from "dyna-ai-gateway").
  1. Search for `system:` inside objects typed `IModelRequest`, and for `.system` reads on an `IModelRequest`
     (search terms: `IModelRequest`, `request.system`, `overrides: {llmClient`, `overrides: {contextAssembler`).
  2. Where a request is built with `system: <string>`, write `system: [{text: <string>}]`; an empty prompt becomes
     `system: []`.
  3. Where `request.system` is read as a string (passed to a provider, logged, counted, compared), replace it with
     `joinSystem({blocks: request.system})`, imported from "dyna-ai-gateway". A custom LLMClient for Anthropic may
     instead send one system block per entry and put `cacheControl: {type: "ephemeral"}` on the entry whose
     `cache` is true.
  4. Leave `IAnswerDebug.system` reads as they are: it is still a string.
  5. Verify: `tsc --noEmit` passes and the project's tests pass.
  ```

- **`IAIGatewayConfig.contextAssembler` is required, with two new required switches.** Affects every host: the gateway
  does not start (TypeScript error) until the config says whether the stable part of the system prompt is marked for the
  provider's prompt cache (`promptCaching`) and whether tenants may read each other's cache entries
  (`sharePromptCacheAcrossTenants`). Neither has a default: whoever configures the gateway decides.

  Migration — add the block (these values cache per tenant, with no sharing: the safe choice):

  ```ts
  // before
  const config: IAIGatewayConfig = {
    // …
    usageGuard: {adapter: new InMemoryUsageAdapter()},
    trace: {repository: new InMemoryTraceRepository()},
  };
  // after
  const config: IAIGatewayConfig = {
    // …
    usageGuard: {adapter: new InMemoryUsageAdapter()},
    contextAssembler: {promptCaching: true, sharePromptCacheAcrossTenants: false},
    trace: {repository: new InMemoryTraceRepository()},
  };
  ```

  A config that already has `contextAssembler: {reserveOutputTokens: …}` keeps it and adds the two switches next to it.
  The JSDoc of `IContextAssemblerConfig` says what each value means and costs.

  AI prompt that performs the migration:

  ```text
  Migrate this codebase to dyna-ai-gateway 0.0.1-beta.3, where `IAIGatewayConfig.contextAssembler` became required
  and `IContextAssemblerConfig` gained two required booleans, `promptCaching` and `sharePromptCacheAcrossTenants`.
  1. Find every object typed `IAIGatewayConfig` (search terms: `IAIGatewayConfig`, `new AIGateway(`).
  2. If it has no `contextAssembler`, add `contextAssembler: {promptCaching: true, sharePromptCacheAcrossTenants: false}`.
     If it has one (e.g. `{reserveOutputTokens: 2000}`), add the two keys inside it. A config built by spreading
     another config inherits the block from it: add it only to the base.
  3. Keep `sharePromptCacheAcrossTenants: false` unless the product runs one shipped profile text for every tenant
     and accepts that tenants share cache entries; read the JSDoc of `IContextAssemblerConfig` before setting `true`.
  4. Verify: `tsc --noEmit` passes and the project's tests pass.
  ```

### Added

- Prompt caching of the stable part of the system prompt. `CHAT_MAIN` has a `{cacheBreakpoint}` placeholder after
  `{addendum}`; with `contextAssembler.promptCaching: true` the prompt is sent as a stable block (marked for the provider's
  cache) and a per-call block. `sharePromptCacheAcrossTenants: false` scopes the stable block to the tenant with a
  `[cache scope <hash>]` line; `true` lets tenants share an entry and marks the tool definitions too
  (`IModelRequest.cacheTools`). A stored template with a per-call slot before the breakpoint is sent uncached with the new
  WARNING issue `prompt_cache_off`. See the FAQ, "Is the system prompt cached, and what does it cost?".
- Anthropic cache markers: on an Anthropic model the stable block is sent as its own system message with
  `cache_control: ephemeral` (the 5-minute cache), and with `cacheTools` the last tool definition too. The other providers
  receive the blocks joined as one string, as before.
- OpenAI `promptCacheKey`: on an OpenAI model a request with a stable block carries the provider option `promptCacheKey`,
  a hash of the stable block's text, so the calls that share the block are routed to the same cache. Without a stable
  block (caching off, a system job) the request is unchanged.
- `IUsage.cacheWriteInputTokens`: the prompt tokens a call wrote to the provider's cache, next to `cachedInputTokens` (the
  ones read) and `inputTokens` (the whole prompt). Reported to the usage adapter and the trace.
- `IModelCaps.costCacheReadPerMTokUsd` and `costCacheWritePerMTokUsd`: the cache prices of a model entry, both optional.
  Default on an Anthropic model: 0.1× and 1.25× `costInPerMTokUsd`; on any other provider: `costInPerMTokUsd`.

### Changed

- The cost estimate of a call (`ModelRegistry.estimateCostUsd`, the `costUsd` of the usage report and the trace entry)
  prices the cached tokens at the model's cache rates: the tokens read from the cache at `costCacheReadPerMTokUsd`, the
  ones written at `costCacheWritePerMTokUsd`, the rest of the prompt at `costInPerMTokUsd`. A call without cache tokens
  costs exactly what it did before.

- The shipped `CHAT_MAIN` template puts its stable layers first: the base text, the output format and the profile addendum,
  then the per-call "Today is … locale … timezone" line, the call's instructions and context, the memory and the knowledge
  base. The same layers, one of them moved: a prompt cache can now match the prefix across calls. A tenant's own stored
  `CHAT_MAIN` version is not touched. See `docs/architecture/System prompt production layers.md`.
