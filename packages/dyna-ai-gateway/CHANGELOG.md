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

### Changed

- The shipped `CHAT_MAIN` template puts its stable layers first: the base text, the output format and the profile addendum,
  then the per-call "Today is … locale … timezone" line, the call's instructions and context, the memory and the knowledge
  base. The same layers, one of them moved: a prompt cache can now match the prefix across calls. A tenant's own stored
  `CHAT_MAIN` version is not touched. See `docs/architecture/System prompt production layers.md`.
