# AI Gateway — Decisions

Status: 2026-10-22.

The design decisions that shape how the gateway behaves, one chapter per class, in the order a call meets them. Each entry says what the gateway does, why, and what that means for the application. Read it when a behaviour surprises you or when you want to know what you cannot do and what to do instead.

A decision has an id, `D46`; the JSDoc of the code cites the id where a behaviour comes from a decision (`… chosen per call, not stored on the thread (D46)`). The ids are not contiguous: the numbers in between are implementation decisions that do not change what the application sees. An entry without an id is a design principle, not a single decision.

The composition of the classes is in [Architecture and trade-offs](Architecture%20and%20trade-offs.md); how a change takes effect while the service runs is in [Live adjustment and dependency injection](Live%20adjustment%20and%20dependency%20injection.md); where a sentence of the system prompt comes from is in [System prompt layers](System%20prompt%20production%20layers.md).

---

## 1. AIGateway

### D38: A call returns its stream and its response

**Decision.** `ask(input)` and `run(input)` are not async. They return at once an `IGatewayCall`: `events`, an async iterable of every event of the call (`ELLMClientEventKind`: text deltas, tool requests and results, step ends, a pause, done, error, a withdrawn answer), and `response`, a promise of the final `ANSWER`, `PAUSED` or `FAILED` response. `resume()` returns the same shape.

**Why.** This is the shape of the AI SDK's `streamText`: the caller decides whether to stream, and a backend service that only needs the answer awaits `response` and pays nothing for the events. A channel id delivered with the response would reach the client when nothing is left to stream.

**Consequence.** `events` is collected only once it is accessed, so a streaming caller reads it before the first `await`: `const {events, response} = gateway.ask(input)`. One reader; stopping early ends the collection. The application owns the transport to its clients (SSE, WebSocket, a pub/sub topic): it reads `events` and publishes them. `response` rejects with the call's error; a caller that reads only `events` gets no unhandled rejection.

### D46: The profile, and with it the model, is chosen per call

**Decision.** `IGatewayAskInput.profileId` selects the profile of a call. A thread stores no profile, and the gateway has no default one: [a call always names its profile](#d103-a-call-always-names-its-profile).

**Why.** A profile stored on the thread was written at creation and never read. The application knows which model the user picked, and it may change between two messages of one conversation. Stored turns and memory are in the gateway's own provider-neutral shape, so any profile continues any thread.

**Consequence.** There is no `switchModel`: switching is passing another `profileId` on the next call, and the application passes the user's choice on every call. A paused run keeps the profile it started with unless [resume names another one](#d65-resume-continues-a-paused-run-on-another-profile). The step by step is in the [FAQ](../getting-started/FAQ.md#how-can-the-user-change-the-model).

### D103: A call always names its profile

**Decision.** `IGatewayAskInput.profileId` is required on `ask()` and `run()`. A profile has no "default" flag, and `AIProfileStore` has no `getDefault` or `setDefault`.

**Why.** Which profile answers when the user has picked none is the application's decision, like the user's choice itself. A flag on the profile made it the gateway's: "one default per tenant" is a property of the whole set of profiles that a boolean on each row cannot keep, and every `upsertProfile` had to set a field the gateway used for nothing else.

**Consequence.** The application resolves "no choice yet" to a profile id before the call, from its own settings, and passes an id on every call. `resume()` is unchanged: a paused run continues on the profile it started with unless `profileId` [names another one](#d65-resume-continues-a-paused-run-on-another-profile). A `profileId` the tenant does not have is a 404.

### D104: The input of a call is typed per method

**Decision.** `ask()` takes an `IGatewayAskInput`; `run()` takes an `IGatewayRunInput`, which extends it with the tools of the call: `activeTools` and `additionalTools`. There is no shared `IGatewayInput`.

**Why.** One interface for both methods carried two fields that only `run()` read, marked "only for run()" in their JSDoc. A caller of `ask()` saw them, and a tool list passed to `ask()` compiled and was ignored. The type of each method now says exactly what the method takes.

**Consequence.** A tool list on `ask()` is a type error. A caller that named `IGatewayInput` renames it: `IGatewayAskInput` where the value goes to `ask()` or to both methods, `IGatewayRunInput` where it goes to `run()`. The fields of a call are unchanged.

### D105: The package exports its public API only

**Decision.** Everything an application can import from `dyna-ai-gateway` comes from one entry, and that entry carries only what an application is designed to call: `AIGateway` and its types, the contracts, the in-memory adapters, the interfaces and enums of every internal (`IAIProfile`, `IThreadRepository`, `ERunStatus`, …), the internal classes as types only, and `defineTool`. The classes the gateway composes (`ModelRegistry`, `LLMClient`, `Trace`, …), its agent loop and its helpers are not exported as values.

**Why.** The internals are constructed by the gateway, never by the application; a class or a helper that is importable is a class that gets called, and its signature then becomes a contract the library did not mean to give. The types stay public because the application implements the repositories and reads what the gateway returns.

**Consequence.** `gateway.modelRegistry`, `gateway.trace` and the other exposed children can be named as types (`const registry: IModelRegistry = gateway.modelRegistry`) but not constructed: `new ModelRegistry(...)` is a type error. The `overrides` argument of the constructor exists for tests, which pass an instance of a public interface such as `ILLMClient` ([Live adjustment and dependency injection](Live%20adjustment%20and%20dependency%20injection.md) § 2.3). An application that needs something the entry does not export asks for a facade method instead of a deep import; there is no sub path to import from.

### D106: An enum's value is its member name

**Decision.** Every enum of the gateway has the value of its member name, in capitals: `ERunStatus.PAUSED` is `"PAUSED"`, `EPartKind.TOOL_CALL` is `"TOOL_CALL"`, `EPromptTemplateKey.CHAT_MAIN` is `"CHAT_MAIN"`.

**Why.** A value read outside the code, in a database row, a log line, a trace or a JSON payload, is recognisably a value of an enum, and a search for it finds the member that defines it.

**Consequence.** These are the values your stores keep and your client receives: compare with the members (`response.kind === EGatewayResponseKind.PAUSED`), never with a string. The prompt templates are keyed by these values (`CHAT_MAIN`, `MEMORY_WORKING`, …). The AI SDK and the providers see their own values, unchanged: the gateway maps at the boundary.

### D65: Resume continues a paused run on another profile

**Decision.** `resume({userContext, runId, decision, profileId?})` derives from the given profile what `run()` derives from its own: the model, the output cap, the tools and the limits. The system prompt and the messages so far stay.

**Why.** A stored run froze its model at the first step, so a profile change between the pause and the approval never reached the model.

**Consequence.** A pending tool the new profile does not allow is a 400 and the run stays paused. The run is stored with the profile it continued on. What guards the run is not dropped by the switch: the [review of the answer and the approvals](#d113-a-profile-switch-on-resume-keeps-the-review-and-the-approvals) are those of both profiles.

### Resume is only for a paused run

**Decision.** `resume()` answers a pause: a tool that waits for approval, a question the model asked the user, or [an answer that waits for a review](#d99-the-answer-waits-for-a-human). A normal follow-up message is a new `ask()` or `run()` on the same thread.

**Why.** A pause is a tool call that waits for its result, or a finished answer that waits for its verdict; the decision closes it. A new message is a new turn.

**Consequence.** The four decisions are `EResumeAction`: `APPROVE` runs the tool with its input, `EDIT` runs it with `editedInput`, `REJECT` does not run it and gives the model `text` as the reason, `ANSWER` supplies the result, as `answers` for a user question. On a reviewed answer the same three words deliver it, deliver the edited text, or drop it. A resume may pause again when the next tool needs approval, or when the answer it produces is reviewed.

### D68: Per-call instructions and context

**Decision.** `IGatewayAskInput.instructions` is text the application adds to the system prompt for this call, as instructions. `IGatewayAskInput.context` is what the application knows about this call (the open invoice, the selected rows), rendered as data under a label that says it is not instructions.

**Why.** The profile's `promptAddendum` is stored once per tenant and profile; the prompt is the user's words. Nothing carried what the application knows or wants on this one call.

**Consequence.** Neither is stored: a later call on the thread passes its own, a paused run keeps the prompt it started with and `resume()` takes none. Which layer to use for which text is in [System prompt layers](System%20prompt%20production%20layers.md#which-layer-to-use).

### D42: The caller decides the format of a text answer

**Decision.** `IGatewayAskInput.outputFormat` is `EOutputFormat.MARKDOWN` (default) or `PLAIN`. With an `outputSchema` the format instruction is left out: the provider's structured-output mode fixes the shape.

**Why.** A model writes Markdown reliably and cheaply. HTML is written less reliably, costs more tokens and must be sanitised before a browser renders it.

**Consequence.** There is no `HTML` value. Convert and sanitise Markdown where it is rendered.

### D58: Sampling temperature per call

**Decision.** `IGatewayAskInput.temperature` sets the sampling temperature of the main model call; omitted, the provider's default applies. The helper calls (memory, query rewrite, judge) are not affected.

**Consequence.** A profile-level default is not available yet; pass the value on every call that needs it. The profile's model must [accept a temperature](#d82-a-model-says-whether-it-takes-a-temperature); otherwise the call is refused.

### D63: `debug: true` attaches the transcript to the answer

**Decision.** `IGatewayAskInput.debug` (and the same flag on `resume()`) adds `IAnswerResponse.debug`: the system prompt as sent, the messages the model saw and produced, the number of model calls, and on a resume the stored run as settled.

**Why.** A run that never pauses is never stored, so without the flag its loop is visible only in the trace.

**Consequence.** For developers only. The transcript carries the system prompt and every tool output; never pass it to an end user.

### D32: A thread belongs to its user

**Decision.** `ask`, `run` and the thread methods answer 404 for a thread of another user of the tenant. `ask` and `run` check it before the thread's lease (D77), so a busy thread of another user is a 404 too, never a 409, and nothing is stored for the call. `resume` and `cancelRun` stay open to every user of the tenant.

**Why.** The approver of a tool call is often not the person who asked.

**Consequence.** A run stays the asker's whoever resumes it: the facts extracted after it go into the asker's memory, its trace entries and the screens of its answer are under the asker, so erasing the asker removes them. The tools of the resumed step run with the context of the user who resumes, who is accountable for the approved action. A reviewer of answers therefore collects nothing of the customers in their own memory.

### D77: One call at a time on a thread

**Decision.** A call on an existing thread takes a lease on it (`IThread.lease`) and releases it when the call ends. A second call while the lease is held is a 409. `IThreadStoreConfig.leaseMs` (default 5 minutes) sizes the lease for the longest run.

**Why.** Two calls on one thread at once (a double click, two tabs) both stored a turn and both answered, and the conversation got mixed up. The lease is one atomic check-and-set in the repository, so it also holds across server instances. A fixed expiry means a crashed server leaves no thread busy for ever.

**Consequence.** Show the 409 as "still answering" and retry after the response. `cancelRun` and the expiry job take no lease: they store no turns.

### D90: A call can be stopped: `abortSignal` and `timeoutMs`

**Decision.** `ask`, `run` and `resume` take an optional `abortSignal` (the caller's `AbortSignal`) and an optional `timeoutMs` (a deadline for the whole call, model calls and tools included). The two are one signal inside the call: the first to fire stops the model call in flight, the agent loop, the tool that is running and the guardrail rules. The call then returns `FAILED` with the reason "The call was aborted" or "The call timed out after N ms" and one `ERROR` issue whose `code` is `CALL_ABORTED_ISSUE_CODE` (`call_aborted`) or `CALL_TIMED_OUT_ISSUE_CODE` (`call_timed_out`). Nothing is thrown. A `timeoutMs` that is not a positive integer (up to 2 147 483 647 ms, Node's largest timer) is a 400 before anything is stored.

**Why.** When the user presses "stop" or closes the tab, the model kept writing and the tools kept running at the tenant's cost; a slow provider or a hanging tool held the thread until its lease (D77) expired. A timeout is an abort with a clock, so both ride the same mechanism and the same response shape. An abort is a normal end of a call the caller asked for, so it is a `FAILED` response like a blocked answer, not an error.

**Consequence.** A call with a signal that is already aborted is answered before the thread's lease is taken. A call stopped during the input check creates nothing; stopped after its user turn was stored, the turn stays and the response names the thread (a new one too). In a run, the steps that completed before the stop are stored as for a blocked answer: the tools did run, so their calls and results stay in the thread, and a tool call the abort cut gets an error result; no answer is stored, no memory update runs, a fresh run never pauses. An answer that was already streamed when the abort landed in the output check is withdrawn with `ANSWER_WITHDRAWN`; an abort during the model call itself leaves the deltas streamed so far on the stream with no further event, the response says the call failed; a tool call the stream announced (`TOOL_REQUEST`) and the stop cut gets no `TOOL_RESULT` event, the thread holds its error result. An aborted `resume` closes the run: the run is `FAILED`, the tool that ran stays on record, a tool call the abort cut gets an error result, the thread is open again; an abort while the answer is still being screened, or a signal that is already aborted, leaves the run paused for another decision. The abort is cooperative for a tool: the gateway aborts the tool's `abortSignal` and stops waiting, but a tool that ignores the signal runs to its end, and an abort never undoes what a tool already did. The partial text of an aborted stream is not returned, and the usage adapter is told the call used zero tokens (the provider bills its own count). The knowledge-base search (query rewrite, embedding) and a tool's policy predicate do not take the signal yet; an abort during them is seen when they return, so `timeoutMs` can overrun by their duration. A `TimeoutError` the caller passes as `abortSignal` (its own `AbortSignal.timeout`) reads "The call timed out" with `call_timed_out`, without a number the gateway did not set.

### D70, D74: A blocked answer is not stored, and the stream learns it was withdrawn

**Decision.** When an output rule blocks an answer, the response is `FAILED`, the answer text is not stored in the thread, and no memory update runs. The tool calls and results of a run stay stored: the tools did run. Because the text was already streamed, the call emits one last event, `ANSWER_WITHDRAWN`, with the issues. The same event ends a call that is [aborted](#d90-a-call-can-be-stopped-abortsignal-and-timeoutms) while the output check runs, then with the abort's one issue.

**Why.** A stored failed answer would be sent back to the model on the next call. Streaming cannot be undone, so the client needs a signal.

**Consequence.** A client that renders deltas drops or greys the text of the call on `ANSWER_WITHDRAWN` and shows the issues; a client that reads only `response` is unaffected. The choice between live deltas and showing only the final response is in the [FAQ](../getting-started/FAQ.md#how-do-i-add-moderation-or-other-safety-checks).

### D54: Forgetting a user is two methods

**Decision.** `deleteUserData({tenantId, userId})` erases everything of the user. `anonymizeUserData({tenantId, userId})` keeps threads, runs and trace entries as skeletons (status, counts, usage, cost, dates) under one random pseudonym it returns. In both modes the content goes: files, turns, remembered facts, run messages and system prompts, trace requests and results. An open run is cancelled and its thread closed.

**Why.** Erasure and pseudonymisation are the two data-protection obligations; a pseudonym that is a hash of the user id would be reversible.

**Consequence.** Both return `IForgetUserResult` with the counts per place. Both wait for the user's own calls and background work first, so a running call or a queued memory update cannot bring a fact back ([D114](#d114-the-erasure-keeps-the-users-calls-out)). What the app's usage adapter stored is the app's to erase; the knowledge base has no user.

### D114: The erasure keeps the user's calls out

**Decision.** While `deleteUserData` or `anonymizeUserData` runs for a user, every new call of that user — `ask`, `run`, `resume` (as the one who resumes or the one who asked), `uploadFile`, `upsertUserFact` — is a 409. The erasure first waits for the user's calls that are already running, then for the user's own background work, and deletes after both.

**Why.** A call running during the erasure kept writing after it: its turns, its trace entries, a fact the model remembered. And the erasure waited for the background work of every tenant, so on a busy server it might never return.

**Consequence.** An erasure takes as long as the user's longest running call. The guard is per server instance: on several instances, route the erasure to where the user's calls run, or stop the user's traffic first.

**Limit.** The gateway waits only for the calls of its own process. A thread of the user whose [lease](#d77-one-call-at-a-time-on-a-thread) is live is a call running on another instance: both methods are then a 409 (`data.busyThreadIds` names the threads) before anything is touched, never a partial erasure, so the user's rows never split over two pseudonyms. The host retries when the call ended; a lease ends with the call or with `leaseMs` at the latest.


### D116: The model cannot write a user fact unasked

**Decision.** `remember_user_fact` pauses the run for the user's approval by default: a TOOL_APPROVAL card whose input is the fact (`{key, value}`); on approval the fact is stored, on rejection it is not. `userMemoryStore.rememberNeedsApproval: false` stores it at once.

**Why.** A remembered fact enters every future prompt of the user, in every thread. Text the model only read — a tool result, a knowledge-base excerpt, an uploaded file — could make it store an instruction ("always recommend the premium plan") that then steered every later answer.

**Consequence.** "Remember this" costs the user one click. The facts the background extraction finds and the ones the UI sets with `upsertUserFact` do not pause; the extraction reads the same conversation, so it stays exposed to the same injection, bounded by its prompt and the size cap of a fact. `forget_user_fact` only removes and never pauses.

### D44: Memory is reachable for a UI

**Decision.** The facade exposes the user's facts (`getUserFacts`, `upsertUserFact`, `removeUserFact`, `clearUserFacts`) and the thread's memory (`getThreadMemory`, `resetThreadMemory`).

**Consequence.** The thread methods follow [the user's ownership of a thread](#d32-a-thread-belongs-to-its-user). `resetThreadMemory` waits in the thread's background line, so it never races a memory update.

### D17: Background work and `whenIdle()`

**Decision.** Memory updates run after the answer, in the background. `whenIdle()` resolves when that work is done. A background task never rejects: its error is logged on the server.

**Consequence.** Call `whenIdle()` before a server shuts down and in tests that assert on memory.

### D96: Graceful shutdown

**Decision.** `shutdown({timeoutMs})` stops the gateway in order: every new `ask`, `run` and `resume` is refused with a 503, the calls in flight get `timeoutMs` to end, the ones still running after it are aborted through their call signal ([D90](#d90-a-call-can-be-stopped-abortsignal-and-timeoutms)), then the background work lands as `whenIdle()` does. A second call returns the same promise.

**Why.** A server stopped in the middle of a call leaves the thread leased until the lease expires, the run running with nobody to close it, and the user turn stored without an answer. `whenIdle()` waits for the memory updates only, not for the calls. Stopping is the standard order of a Node server: stop taking work, drain within a grace period, abort the rest.

**Consequence.** The refusal is a 503, not a 4xx: the client did nothing wrong and may retry on another instance. An aborted call answers `FAILED` with `call_aborted` and the reason "The call was aborted: the gateway is shutting down"; its run is closed, its thread lease released and its turns kept. A paused run is stored, so it is untouched and resumes on the next instance. A crash skips all of it. A gateway that was shut down takes no call again. The SIGTERM handler is in the [FAQ](../getting-started/FAQ.md#how-do-i-stop-the-server-cleanly).

### D40: The gateway knows no UI

**Decision.** Nothing in the gateway imports or names a chat client's message types. The translation to a chat protocol is a separate server-only module that takes an `AIGateway` instance and a per-use-case configuration.

**Why.** The gateway is also called by backend services to complete an operation.

**Consequence.** The module is `dyna-ai-gateway/vercel-ui` (`AIGatewayVercelUi`, see [chapter 17](#17-aigatewayvercelui)): an endpoint for a Vercel chat client becomes one call into it; a second use case is a second instance with another configuration. The gateway's own API stays free of chat-client types; an application that never streams to a browser never loads the module.

### D43: `zod` is a peer dependency

**Decision.** The application's own `zod` schemas cross the API: `outputSchema` on a call, `inputSchema` on a tool.

**Why.** One schema instance, no double validation, and the SDK's structured output is used as is.

**Consequence.** The application installs `zod` 4 and keeps it in step with the gateway's version.

---

## 2. ModelRegistry and AIProfileStore

### A profile bundles what goes with a model

**Decision.** `IAIProfile` holds the model, the cheap helper model, the allowed tools, the tools that need approval, the prompt addendum and the limits (daily tokens, steps per run, output tokens). The models themselves are entries of the registry with provider, capabilities, cost and an `enabled` flag.

**Why.** A model choice is never only a model: tools, limits and prompt go with it.

**Consequence.** Models, profiles and templates are data with a cache; their write methods invalidate it, so a change is read by the next call. The table of what changes how is in [Live adjustment](Live%20adjustment%20and%20dependency%20injection.md#3-live-adjustment).

### A profile a paused run waits on cannot be removed

**Decision.** `AIProfileStore.removeProfile` refuses, with a 409 that names the runs, a profile that a paused run of the tenant started on. A model is switched off with `ModelRegistry.setEnabled` rather than removed: a disabled entry is refused by the next call and keeps its history; `removeModel` deletes it and knows nothing of the profiles that name it.

**Why.** A paused run resumes on the profile it started with ([D46](#d46-the-profile-and-with-it-the-model-is-chosen-per-call)); removing it would turn every later resume into a 404. The registry is global and the profiles are per tenant, so the registry cannot check them.

**Consequence.** Resume or cancel the paused runs of a profile before removing it (`listPausedRuns`, `cancelRun`, `expirePausedRuns`). Switch the profiles of a model before removing the model; prefer `setEnabled: false`, which needs no switch.

### D82: A model says whether it takes a temperature

**Decision.** `IModelCaps.temperature` states whether the model accepts a sampling temperature. A call with [`IGatewayAskInput.temperature`](#d58-sampling-temperature-per-call) on a profile whose model has it `false` is refused with a 400 before anything is stored or paid for; the same request reaching the `LLMClient` directly is refused the same way. The guardrails judge sends its temperature 0 only to a model that takes one.

**Why.** The OpenAI reasoning models (the GPT-5 family, the o-series) reject the parameter; the SDK drops it and logs a warning on every call. A warning in the server log is the wrong place for a mistake the developer made in a call: the gateway refuses the call instead, with the model and the profile in the error. The fact belongs to the registry entry, not to `caps.reasoning`: the Anthropic models reason and take a temperature.

**Consequence.** Every registry entry states `caps.temperature` (`false` for the OpenAI reasoning models, `true` for the Anthropic models). An application that lets the user pick a temperature reads the cap of the profile's model first, or omits the value for a profile on such a model.

---

## 3. PromptTemplateStore

### D69: Templates are versioned, and the history is read only on request

**Decision.** One active version per template key is cached and rendered. `listVersions({key, page})` pages the history, newest first, with the cursor paging of this library (`IPageArgs`: `limit`, `startingAfter`, `endingBefore`; `IPage`: `items`, `hasMore`). `setActive` switches versions in one operation. Old versions are kept.

**Why.** Loading a whole table to find five active rows is wrong once a key has hundreds of versions. The trace records the version of every answer, so an old version can be inspected and activated again.

**Consequence.** The seed (version 0) answers when the repository has no active version, so a fresh database works at once. The host replaces the seed of a key with `promptTemplateStore.seedTemplates`; a key not given there keeps the shipped seed, and an active version in the repository always wins. The layers of the main template are in [System prompt layers](System%20prompt%20production%20layers.md).

---

## 4. ThreadStore and FileStore

### D30: A file is its pointer

**Decision.** `uploadFile` stores the bytes under the key `<tenantId>/<path>/<userId>/<fileId>` and returns an `IFileRef`; the gateway keeps no list of files. `IFileStoreConfig.path` is required (any number of folders, may be empty). The allowed types default to PNG, JPEG, WebP, GIF and PDF, named one by one: an SVG can carry a script, so a host allows it only when files are never shown inline from an origin it trusts. A file name is at most 255 characters, on one line.

**Why.** The tenant is the first folder of every key, so everything of a tenant is under one prefix. The user's folder makes "remove the files of this user" one prefix delete. Where the files live is decided where the gateway is configured, like the table names of the stores.

**Consequence.** A file is read with its tenant, its uploader and its id, all three on the pointer. The pointer comes from the client, so the gateway checks it: a call may carry only files of its own tenant and its own user, any other pointer is a 400. [`delete`](#d119-threads-are-deleted-in-bulk-with-everything-they-left) walks the thread's turns, which hold the pointers, and removes the thread owner's files only.

### D119: Threads are deleted in bulk, with everything they left

**Decision.** `delete({tenantId, threadIds, userId?})` removes threads from every store in one call: thread, turns, working memory, files, runs and trace entries of every matched thread. `threadIds` is `"all"` or a list of ids; `userId` narrows either to one user's threads. It returns `{threads}`, the number deleted. Every repository behind a thread's data (`IThreadRepository`, `IRunRepository`, `ITraceRepository`) has one bulk `delete` with the same arguments; the thread repository also lists the ids (`listThreadIds`).

**Why.** Nothing was ever removed after a call, and the application deletes conversations in bulk: the user's "delete selected", a tenant's reset, a retention job. One method with one shape on the facade and on every seam keeps a real database to one query per store.

**Consequence.** Hard delete, no tombstone: a deleted thread is a 404 like one that never existed, and a second call with the same ids returns 0. A thread with a call in flight ([its lease is live](#d77-one-call-at-a-time-on-a-thread)) is skipped and not counted; an unknown id, or one of another tenant or user, is ignored. The owners' [background memory updates](#d17-background-work-and-whenidle) are awaited first, so nothing is written after the delete. Only the thread owner's files are removed (a stored pointer of another user's file stays). User facts are not touched: they belong to the user, not to a thread. "Forget this user" stays [`deleteUserData` / `anonymizeUserData`](#d54-forgetting-a-user-is-two-methods), which also remove the files and facts. `delete` takes raw ids and checks no user: the host decides who may call it.

### D31: Only the files of the current question go to the model

**Decision.** The files passed on a call are sent to the model with their bytes. Files of earlier turns stay in the thread as pointers and are not sent again.

**Why.** Sending every past file on every call multiplies the cost of the conversation.

**Consequence.** A question about an earlier file passes it again.

### D108: The bytes of a file live in the FileStore only

**Decision.** A trace entry and a paused run keep the file parts of the model's messages with their name, type, file id and size, and empty bytes. A resume loads the bytes again from the FileStore, under the user who asked; a file deleted while the run waited reaches the model as a short note that it is gone.

**Why.** The trace recorded the request as sent, and a paused run stored its messages as they were: each kept a full copy of every uploaded file. Removing a file left those copies, and one large file was enough to exceed a database's document size limit.

**Consequence.** `deleteFile` and `removeFilesByUser` remove the only copy. A trace entry shows which file was sent, not its content. The resumed step's model sees the file as the first step did, as long as the file still exists.

---

## 5. WorkingMemory and UserMemoryStore

### D16, D19: Memory has a switch, and the switch is required

**Decision.** `IWorkingMemoryConfig.enabled` and `IUserMemoryStoreConfig.enabled` are required, no default. Off: the model is never called for memory, the thread still reaches the model as its last 20 turns, and stored user facts are still read and editable. `updateEveryTurns` (default 1, an option of the `SUMMARY_BUFFER` strategy) counts the thread's turns since the last update.

**Why.** Memory is a quality lever, so the configuration says in one word whether it is on.

**Consequence.** The thread summary and facts and the user's facts reach the model as a labelled layer of the system prompt; a stored template without the `{memory}` slot gets no memory. See [System prompt layers](System%20prompt%20production%20layers.md).

### D122: The working memory owns the thread's window

**Decision.** Which turns of a thread the model reads, how many, and whether a digest stands in for the older ones is decided by the working memory alone, behind one interface, `IWorkingMemory`: `load` gives the message window and the notes for one request, `saveContext` learns from one answered call, `getState` and `reset` serve the UI. The `ContextAssembler` renders the system prompt first, asks `load` with the tokens that are left (`contextTokens − reserveOutputTokens − system prompt`; `reserveOutputTokens` defaults to the call's `maxOutputTokens`), puts the notes into the `{memory}` layer and only trims an overflow. The built-in `WorkingMemory` has two strategies, `EWorkingMemoryStrategy`: `SLIDING_WINDOW` sends the newest turns that fit `chatHistoryRatio` (default 0.8) of that budget, verbatim, counted with the model's tokenizer, and stores nothing; `SUMMARY_BUFFER` sends a rolling summary and facts written by the cheap model plus the last `recentTurns` (default 20) turns. The strategy of a call is the profile's `workingMemory`, else the gateway's `workingMemory.strategy`, else `SUMMARY_BUFFER`. A host replaces the built-in memory with its own `IWorkingMemory` in the constructor's `overrides`.

**Why.** A chat assistant and a long-running support agent need different memories, and a tenant often runs both. One raw interface (the idiom of LangChain's `saveContext` / `loadMemoryVariables`) lets each strategy, built-in or the host's, decide for itself, with the one number it needs: the budget. A ratio instead of a priority between history and knowledge base is what LlamaIndex does (`chat_history_token_ratio`); it is one knob and it reads as what it does.

**Consequence.** `IContextAssemblerConfig.maxTurns` is gone; the window is sized in tokens, by the strategy. A stored summary survives a switch to `SLIDING_WINDOW` unused and is resumed after the switch back; `getThreadMemory` shows it meanwhile and returns the empty state for a thread that never ran `SUMMARY_BUFFER`. Every window opens on a user turn, so a tool result never arrives without its call. The token count is a real tokenizer (exact for OpenAI, a safety factor for the other providers; images and PDFs by size), the same count the usage adapter is asked with ([D121](#d121-the-application-decides-every-model-call)). How to choose and configure a strategy is in the [FAQ](../getting-started/FAQ.md#how-much-of-the-conversation-does-the-model-see-and-how-do-i-choose).

### D56: The user-facts extractor returns operations

**Decision.** The extraction answers a list of `{key, value, op}` with `op` `SET` (add or replace) or `DELETE`.

**Why.** With add-or-replace only, "forget what you know about my language" was answered by the model and ignored by the store: the fact came back in the next thread. Memory services (mem0, LangMem, ChatGPT memory) use the same add / update / delete events.

### D61, D18: Memory on request

**Decision.** Two built-in tools, `remember_user_fact {key, value}` and `forget_user_fact {key}`, are offered to the model in every `run()` when the user memory is enabled, whatever the profile's `allowedTools` say. `remember_user_fact` waits for the user's approval unless `userMemoryStore.rememberNeedsApproval` is false ([D116](#d116-the-model-cannot-write-a-user-fact-unasked)); `forget_user_fact` never does. The batch extraction also runs after the first answer of a thread, not only every `extractEveryTurns` turns.

**Why.** "I am based in Vienna, remember this" was never stored: a short thread never reached the extraction boundary, and the model had no tool to act at once. The opening message of a thread carries most facts.

**Consequence.** `ask()` has no tool loop, so "remember this" is not acted on at once there; the facts are picked up by the next extraction. A `run()` stores them the moment the model is asked.

---

## 6. MdChunker, Embedder, VectorStore

### D21: The knowledge base is scoped by the caller, on every call

**Decision.** Content is grouped tenant → library → book → document → chunk. `IGatewayAskInput.kbFilters` is required: `libraryIds` is a list of libraries or `"all"`, `bookIds` narrows to single books, empty means all books of those libraries. **An empty `libraryIds` array means no search.** Nothing about libraries is on the profile.

**Why.** The application owns libraries and knows what the user may read; the gateway does not. A list that came out empty by accident must never open every library.

**Consequence.** Pass the scope on every call, also on a thread that already has one.

### D22: A book moves without re-embedding

**Decision.** `moveBook({tenantId, bookId, libraryId})` on the ingestor changes the library of a book's chunks in place.

### D23: The Markdown splitter is the gateway's own

**Decision.** Documents are Markdown, split by headings into chunks of `IMdChunkerConfig.maxTokens` with an overlap; token counts are estimated as characters divided by four.

**Why.** No dependency for a splitter, and the same estimator as the context assembler, so the two estimates agree.

**Consequence.** Headings are ATX headings (`#` … `######`); a closing sequence of `#`s is stripped only after a space, as in CommonMark, so `## Using C#` keeps its `#`. Splitting a document takes time linear in its length, whatever its lines contain.

### D27: Embeddings come from OpenAI

**Decision.** The embedding model of `IEmbedderConfig` must be an OpenAI model. A provider without embeddings is refused with a 400.

**Why.** The Anthropic provider of the SDK has no embeddings.

---

## 7. QueryRewriter and KbRetriever

### D24: The query rewrite has a required switch

**Decision.** `IQueryRewriterConfig.enabled` is required. On, the user's question is rewritten by the cheap model into a search query before retrieval.

### D25, D26: The retrieval says whether it searched

**Decision.** `IRetrievalResult.searched` tells "the call did not use the knowledge base" from "the knowledge base was searched and has nothing"; the system prompt differs. `IAnswerResponse.citations` are the ids of the chunks the model was given, not of the ones the answer rests on.

**Consequence.** For a grounding check, an output rule gets the same chunks as `evidence.chunks`.

---

## 8. ToolRegistry

### D48: The tools are fixed at construction; a call can narrow them, never widen them

**Decision.** The tools come from `IToolRegistryConfig.tools`. There is no `register()`. `IGatewayRunInput.activeTools` offers the model only those names of the tools the profile and the user's permissions allow; a name outside them is a 400 before anything is stored. `ask()` has no tools, and its input [has no such field](#d104-the-input-of-a-call-is-typed-per-method).

**Why.** A tool added at runtime exists on one server instance and not the others, and what a call does would depend on earlier calls instead of configuration. Which tools a use case may use is data: the profile's `allowedTools`, the user's permissions.

**Consequence.** A new tool arrives with a deploy. A tool that exists for one request is passed on that call, see the next entry.

### D66: Tools per call

**Decision.** `run({additionalTools})` adds the call's own tool definitions to the registry's for this call. They run on the same pipeline: the user's permissions, approvals, `requires`, timeout and output cap. The profile's `allowedTools` is not consulted for them: the application that passes them is trusted code. A name that is already in the registry, or given twice, is a 400.

**Consequence.** A paused run stores tool names only, so `resume({additionalTools})` must receive them again; a missing one is a 400 and the run stays paused.

### D72, D79: Only a tool the model was offered can run

**Decision.** The tools of the step are the ones that may run. A call to a tool the model was not offered in that step (hidden by `activeTools`, by the profile, by `requires`, or named from an earlier turn) is refused with a 403 the model reads as the tool's error. It cannot pause for approval either.

**Why.** A model naming a tool it saw earlier in the thread would otherwise run it past the approvals.

### D88: A refused guarded tool names what must run first

**Decision.** A call to a tool that `requires` hid for the step is refused with a message that names the tools it requires: `Tool [refund] is not available in this step of the run. Call lookup_order first, then call it again.` A tool outside the run keeps the bare refusal of D72.

**Why.** The bare text did not tell the model "not yet" from "never", and gave no cue which tool to call first; the order worked by absence alone. The model can now recover in the next step instead of guessing.

**Consequence.** The ordering still relies on the tool descriptions and the system prompt to be found at all: the gateway never forces a tool call.

### D60: Tools run under a timeout and an output cap

**Decision.** A tool is raced against `IToolRegistryConfig.toolTimeoutMs` (default 30 s) or its own `timeoutMs`; `execute` receives an `abortSignal`. A timeout is a 504, an output above `maxOutputChars` (default 50 000 characters as JSON) is a 413. Both become the tool's result ([D100](#d100-what-the-model-reads-when-a-tool-fails-and-how-the-developer-is-told)), so the model reads what happened and can retry narrower.

**Why.** A hung tool hangs the run; a huge result is paid for by every following model call. Truncating an output silently would let the model reason on cut JSON.

**Consequence.** A cooperating tool passes the `abortSignal` to its own HTTP calls. The same signal is aborted when the caller stops the call or its deadline passes ([D90](#d90-a-call-can-be-stopped-abortsignal-and-timeoutms)).

### Input is validated, output is not

**Decision.** `ToolRegistry.execute` parses the input with the tool's `inputSchema`; a mismatch is a 400 returned to the model as the tool result, so it can retry. The output is serialised and handed to the model as text without a check.

**Why.** The input comes from the model, which can invent fields. The output comes from the application's own code; throwing on its shape would turn a recoverable situation into a failed call.

**Consequence.** The model learns what a tool returns from its `description`. Keep results small, self-describing and consistent in naming. A failure the model should act on is thrown as a `dynaError` with a `userMessage` (next entry).

### D100: What the model reads when a tool fails, and how the developer is told

**Decision.** A tool that throws never ends the run: the error becomes the tool's result, and the model reads one line built from the fields of a `dynaError` that are safe for the end user — `code: 82758244, status: 404, userMessage: No order with id 4711; ask the customer for the number on the invoice` (an absent field is left out; `canRetry: false` appends "Do not retry this call."; a `userMessage` over 2 000 characters is cut and marked `[cut]`). The error's `message` and `data` never reach the model. A tool steers the model with `throw dynaError({code, status, userMessage})`. Any other error — a plain `Error`, a `dynaError` without a `userMessage` — gives the model a generic text instead (status 500, the gateway's code): the input was not the cause, do not retry it unchanged. The gateway's own refusals (invalid input, tool not offered, timeout, oversized output, a guarded tool called too early) carry a `userMessage` that says how to recover. The stored result carries the error's code as `IToolResultPart.errorCode`.

Every failed call — the tool threw, timed out, returned too much, got an input its schema rejected, was not offered — is reported to `IToolRegistryConfig.onToolError` with everything the gateway knows (`IToolErrorReport`: tenant, user, thread, run when known, step, the model's `callId`, the tool, the input, the error as thrown, the text the model read, the duration). The handler is fire-and-forget: the run never waits for it, one that throws is logged and ignored. With or without a handler, a failure the tool did not describe with a `userMessage` is logged on the server. A call the caller aborted is not a failure of the tool and is not reported.

**Why.** The model is one step away from the end user: an error message with a host, a table name or a stack is repeated to them. `dyna-error` already separates the developer's `message` from the `userMessage` that is safe to show, so the tool decides at the throw site what the model may read, with a safe default for what it did not decide. The `status` tells the model the class of the failure, the `code` is what an end user quotes to support. One hook in the registry's config, rather than a callback on every tool, because the gateway has every datum of a failure in one place. Correlation needs no new id: `callId` is on the thread's call and result parts and in the request of the next step's trace entry.

**Consequence.** A tool that lets its HTTP client's error through leaks nothing, and the model stops retrying; a tool that wants the model to recover catches and rethrows with a `userMessage`. The one line the model reads is not localised: the model answers in the user's language whatever the language of the text. The report's `runId` is absent during the loop of a fresh run (the run is stored when it pauses); `threadId` and `callId` are always there.

---

## 9. ToolPolicy

### D87, D67, D50: One policy on the tool: allow, deny, needs approval

**Decision.** `IToolDef.policy` decides what happens to a call of the tool before it runs. It is omitted (every call runs), a verdict of `EToolCallVerdict` that applies to every call (`NEEDS_APPROVAL`: a human first; `DENY`: refused, a kill switch for a tool that stays registered; `ALLOW`: the same as omitting it), or a predicate `({input, userContext})` on the parsed input, sync or async, that returns a `TToolCallPolicyResult`: `{verdict: ALLOW}`, `{verdict: DENY, reason}` or `{verdict: NEEDS_APPROVAL, rejectionText?, reasonCode?}`. `IAIProfile.approvals` lists the tools that wait for a human in this tenant, whatever the tool says. Nothing removes a pause the tool or the profile demands.

**Why.** One rule on the tool, decided per call outside the tool's own code: two tool-level rules that disagree confuse every tool author, and a check that lives inside `execute` runs too late to spare the human an approval of a call that would be refused anyway. The AI SDK and the OpenAI Agents SDK have one field for the approval; the deny verdict is the third row of a policy table (allow, deny, needs approval) added to the same field.

**Consequence.** The rules apply in this order: an input the schema rejects never reaches the policy (`execute` reports it to the model); then the tool's `policy`; then the profile's `approvals` as the floor, which turn an `ALLOW` into `NEEDS_APPROVAL`. `DENY` wins over everything. A denied call is a tool result the model reads (`DEFAULT_TOOL_DENIAL_TEXT` followed by the reason, the part flagged `denied`), like a tool that threw: the other calls of the same step still run, the run goes on, and the denied call counts as not executed for [`requires`](#d15-d76-guarded-workflows) and never ends the run ([D86](#d86-a-tool-can-end-the-run)). The `rejectionText` of a `NEEDS_APPROVAL` result is what the model reads if the human rejects the call, followed by the human's reason; without one, `DEFAULT_TOOL_REJECTION_TEXT`. It is kept with the pause (`IToolApprovalEnvelope.rejectionText`) so a rejection after a restart still sends it; a cancelled or expired pause closes its call with the same text. The `reasonCode` of a `NEEDS_APPROVAL` result tells the approval card why the call waits, as a key of the app's translations; it is kept with the pause as `IToolApprovalEnvelope.reasonCode` and never reaches the model.

### D109: An edited tool input goes through the policy again

**Decision.** When a human approves a paused tool call with `EDIT`, the tool's policy decides again on the edited input before it runs. `DENY` gives the call the denied result (the fixed sentence and the policy's reason) and the tool does not run; the run goes on. `NEEDS_APPROVAL` and `ALLOW` run it with the edited input.

**Why.** The human approved one input; the edit is another one, and only the schema checked it. A policy that refuses refunds above the charge was bypassed by approving a small refund and editing it to a large one.

**Consequence.** `NEEDS_APPROVAL` on the edited input counts as approved: the human just approved it, and a tool in the profile's `approvals` always answers so, which would otherwise make its edits impossible. A policy that looks something up runs once more for an edit.

### D15, D76: Guarded workflows

**Decision.** `IToolPolicyConfig.requires` maps a tool to the tools that must have run before it is offered (`refund` after `get_invoice`). A tool counts as run only when its execution returned: a refused, failed, timed-out or rejected call unlocks nothing. The set of executed tools survives a pause.

**Consequence.** The model sees the guarded tool only once its requirement ran, in this run.

### D86: A tool can end the run

**Decision.** `IToolDef.endsRun` is omitted (the run goes on), `true` (every successful call ends the run) or a predicate `({input, output, userContext}) => boolean | Promise<boolean>` on the parsed input and the tool's output (ended only when the hand-over was accepted). It is evaluated after the tool returned, so a call that failed, timed out, was refused or was rejected by the human never ends the run; a predicate that throws counts as false. The other calls of the same step still run; when one of them pauses for approval, the run ends after the resume (the result of the terminal call carries `endedRun`, and the paused run keeps it). Then the model gets one last step without tools to phrase the answer, the stream carries `RUN_ENDED_BY_TOOL` before that text, and the answer carries `endedByTool` with the tool's name.

**Why.** A tool that is terminal by nature (a hand-over to a human agent, an escalation, a placed order) should not depend on the model choosing to stop afterwards. The rule belongs on the tool, like `policy`, not in application code around the loop: the loop stays the gateway's own. The final step keeps "the model answers" as the contract, so the output rules, the output schema and the trace are unchanged.

**Consequence.** The final step is an ordinary step: counted, reported to the usage adapter and under `maxStepsPerRun` and the adapter's check. When they refuse it, the run ends as a truncated one (`finishReason` LENGTH), still naming the tool. A terminal tool that must come after a lookup combines `endsRun` with [`requires`](#d15-d76-guarded-workflows).

### D89: A tool decides in which steps it is offered

**Decision.** `IToolDef.visibleWhen` is omitted (every step) or a sync predicate `({stepIndex, executed}) => boolean` on the step index and the tools executed so far in the run. It is applied before every model call, next to [`requires`](#d15-d76-guarded-workflows): a tool must pass both. A hidden tool called by name is refused as in [D88](#d88-a-refused-guarded-tool-names-what-must-run-first).

**Why.** Some tools belong to one moment of the run: a classifier of the request on the first step, a report only after the data was fetched. `requires` can say "after X ran" but not "on the first step only" or "never again after it ran". The rule belongs on the tool, like `policy` and `endsRun`.

**Consequence.** Visibility is not a forced call: the model may still answer without calling the tool. The predicate is sync and sees no user context; permissions stay in `permissionsToTools`, decided once per run.

### D101: The tool calls of one step run in parallel

**Decision.** When the model asks for several tools in one step, the gateway decides every call first (its policy, in request order) and then runs the allowed ones concurrently. The results are appended to the thread in request order once the whole batch has settled, so the thread reads the same whatever finished first; the `TOOL_RESULT` events still stream as each call completes. A profile switches this off with `parallelToolCalls: false` (default `true`): the calls then run one after the other, each decided right before it runs.

**Why.** The calls of one step are independent by construction: the model emits them before any result exists, so no call can use another's output, and the protocol gives the model no way to order them. A model that needs an order puts the dependent call in a later step. Running them one by one made a step of five slow tools take five times what it needs; the providers and the common SDKs run them concurrently by default. The switch lives on the profile, like `reviewAnswers`, because it is a property of a way of using AI, not of the gateway.

**Consequence.** A pause now waits for every call of the step that needs a human, not only the first ([D102](#d102-one-pause-carries-every-pending-call-of-the-step)); the allowed calls of the step have finished when the run pauses, so nothing is resumed mid-flight. A stop ([D90](#d90-a-call-can-be-stopped-abortsignal-and-timeoutms)) inside a batch keeps the results of the calls that finished. On a sequential profile the calls after the first one that waits for a human are not decided before the pause; the run pauses once per such call.

### D112: A policy that reads state sees the earlier calls of its step

**Decision.** In a parallel step, the calls of a tool whose `policy` is a predicate are decided and run one by one, in request order, after the calls decided up front have run. A fixed verdict and a tool without `policy` keep the D101 batch. The results are stored in request order.

**Why.** A predicate may look something up: "deny when the charge is already refunded". With every call decided before any ran, two refunds of one charge in one step were both allowed, and the customer was refunded twice.

**Consequence.** The calls of a predicate-policy tool lose their concurrency within a step; the other calls keep it. A policy still sees only what the gateway's tools changed: a write by something outside the run is the application's own concern.

### D61: Built-in tools are always offered

**Decision.** The gateway's own tools (the memory tools, `ask_user_question`) are offered whatever the profile's `allowedTools`, the permissions and `activeTools` say. A model whose capabilities exclude tools gets none.

**Consequence.** Switch them off through their feature switch (`userMemoryStore.enabled`, `humanGate.userQuestions.enabled`), not through the profile.

---

## 10. RunStore and HumanGate

### D51, D52: The pause envelope is a discriminated union without text

**Decision.** Each envelope of `IPausedResponse.envelopes` is a `TPauseEnvelope`, discriminated by `kind` (`EPauseKind`): `TOOL_APPROVAL` carries the `toolCall`, `USER_QUESTION` carries the `userQuestions`, `RESULT_REVIEW` carries the `result` (the answer as the user would get it). Every envelope has the `runId`, the `allowed` resume actions and `expiresAt`; the ones bound to a tool call carry its `callId`. There is no title or rationale text.

**Why.** The gateway cannot word an approval for every tool and every locale. The application owns a renderer per tool from `toolCall.toolName` and `input`, as the AI SDK's approval part and the OpenAI Agents SDK's interruption do.

### D102: One pause carries every pending call of the step

**Decision.** A `PAUSED` response carries `envelopes`, never empty: one envelope per tool call of the step that waits for a human (an approval, a user question), in the order the model asked for them, all with the same `expiresAt`; or the one `RESULT_REVIEW` envelope of a reviewed answer ([D99](#d99-the-answer-waits-for-a-human)), which is always alone. `resume()` takes `decisions`, one per envelope, each naming its envelope by `callId`, all or nothing: an envelope left without a decision, a decision that names no envelope of the pause, two decisions for one envelope, or an action its envelope does not allow is a 400 and the run stays paused. A pause of one envelope takes one decision without `callId`. The free text of every `ANSWER` decision is screened once, together ([D71](#d71-a-users-free-text-answer-is-screened-like-a-prompt)). The stream says `RUN_PAUSED` once, with every pending call in `toolCalls`.

**Why.** With [parallel tool calls](#d101-the-tool-calls-of-one-step-run-in-parallel) a step can hold several calls back at once. The human answers the step as a whole: a card set, not a queue of single cards each followed by a round trip; and a run resumed with half of its step decided would be a mix of two states. A review comes after the step, when every tool has finished, so it never shares a pause.

**Consequence.** A UI renders every envelope and sends every decision back in one call. On a profile with `parallelToolCalls: false` a pause has one envelope, so its decisions need no `callId`. A cancel or an expiry closes every pending call, each with its own `rejectionText` ([D87](#d87-d67-d50-one-policy-on-the-tool-allow-deny-needs-approval)).

### D111: The draft of a review is the reviewer's

**Decision.** On a profile with `reviewAnswers` the model's text is not streamed. The asker's `PAUSED` response carries the review card without its `result`, and `listPausedRuns` returns a summary per run (`IPausedRunSummary`: ids, profile, pause id, cards, dates) instead of the stored run. The reviewer reads the draft with `getPausedRun({tenantId, runId})`, which takes raw ids like the other admin calls.

**Why.** The review exists so that a human reads the answer before the user does. The draft reached the user three ways first: on the stream while the model wrote it, in the response of `run()`, and in `listPausedRuns`, which also returned the system prompt (memory notes, knowledge-base excerpts) and every tool output.

**Consequence.** The asker's UI shows "in review" until the decision returns the `ANSWER`. The application decides who may call `getPausedRun`, and never forwards its result to the asker. On every other profile the stream and the responses are unchanged.

### D113: A profile switch on resume keeps the review and the approvals

**Decision.** When `resume({profileId})` names another profile than the run's, the continuation takes the model, the tools and the limits from the new profile, and `reviewAnswers` and `approvals` from both: the answer is reviewed when either profile reviews, and a tool waits for approval when either profile lists it. A run whose own profile no longer exists cannot switch: the resume is the profile's 404.

**Why.** The profile is chosen by the caller of `resume`. An application that passes on a client's `profileId` let the end user resume a reviewed run on a profile without review and get the answer unreviewed.

**Consequence.** A switch can add guards, never remove them. To drop a review or an approval, change the profile the run started on, not the one the resume names.

### D115: Ids are random UUIDs

**Decision.** Every id the gateway makes — threads, turns, runs, pauses, files, trace entries, leases, pseudonyms — is a version 4 UUID from Node's cryptographic generator (`crypto.randomUUID()`).

**Why.** `resume` and `cancelRun` stay open to every user of the tenant ([D32](#d32-a-thread-belongs-to-its-user)), so a run id is the key to a run. The ids were a timestamp plus `Math.random`, whose state can be recovered from a few outputs: one id told when it was made and helped guess the next.

**Consequence.** An id says nothing about its time or its order; nothing in the gateway sorts by id. Ids made before the change keep their old form.

### D118: The gateway checks what a user could forge and trusts what the host sets

**Decision.** The gateway checks every value an end user could forge or replay: the tenant and the user on threads, files and memory, the pause a decision is for, the answer against its card, an edited tool input against its policy, the sizes of what enters a prompt. It trusts what only the host's code sets: `userContext`, the profile and the scope of a call, who may resume or review, and the admin methods that take raw ids. [What the gateway checks and what it trusts](Architecture%20and%20trade-offs.md#5-what-the-gateway-checks-and-what-it-trusts) lists both sides.

**Why.** The gateway sees no session or token: authentication and the roles of the host's users are the host's. Within that boundary, every input that travels through the end user's client is treated as forged until checked.

**Consequence.** A host that forwards a value of the second list from the end user's request widens what that user can do. The admin methods are for the host's own back office.

### D110: A decision names the pause it is for

**Decision.** Every pause gets a fresh `pauseId`, on the `PAUSED` response and on each of its envelopes. `resume({runId, pauseId, decisions})` requires it; decisions for another pause of the run are a 409, and the run stays paused.

**Why.** A run can pause twice under one `runId`: for the approval of a tool, then for the [review](#d99-the-answer-waits-for-a-human) of the answer the resumed step wrote. A decision without `callId` fits any single-card pause, so the same request body — a retry, a second click, or an end user who may approve tools — approved the review too and skipped the reviewer. The id is the standard guard against a stale write: the client states which version it decided on, as an ETag does.

**Consequence.** Every client passes `pauseId` back from the response it rendered. Two cards of one pause share it; a decision for an earlier pause is refused before the profile is read or any answer is screened.

### D117: An answer must fit its card

**Decision.** Before a resume screens anything or the run leaves the pause, every `ANSWER` is checked against its USER_QUESTION card: one answer per question, in order; `selected` only options the question offers (at most one on a RADIO, none on a FREE_TEXT question); `freeText` only where the question takes typed text (FREE_TEXT, or `freeOption`). Anything else is a 400 and the run stays paused. The answer's `question` is replaced by the card's own text.

**Why.** Only typed text was screened ([D71](#d71-a-users-free-text-answer-is-screened-like-a-prompt)); `selected` and `question` were free strings from the client that reached the model and the thread unscreened, so any text could pass as a "picked option".

**Consequence.** What the model reads and the thread stores is the checked answer. A client that rendered its own copy of the question text gets the card's text back in the stored turn.

### D62: The model asks the user through a built-in tool

**Decision.** With `IHumanGateConfig.userQuestions.enabled`, the model has the tool `ask_user_question`. One call packs every open question (`IUserQuestions`: a title, questions with a `RADIO`, `CHECK` or `FREE_TEXT` mode, options, a free-text option); the run pauses with a `USER_QUESTION` envelope and resumes with `ANSWER` and `IResumeDecision.answers`. The answers are stored as the tool's result.

**Why.** There is no provider standard for asking the user; the common idiom (Claude Code, Codex, the AI SDK's approval tools) is a tool whose call pauses the run and whose result is the user's answer.

**Consequence.** The UI renders a form from the envelope and sends the answers back; nothing is typed into the prompt.

### D85: A free-text question is a mode

**Decision.** `EUserQuestionMode` has three members: `RADIO` (one of the options), `CHECK` (several) and `FREE_TEXT` (the user types; no options, the answer is `IUserAnswer.freeText`). `options` and `freeOption` belong to `RADIO` and `CHECK` only.

**Why.** A question without options was a free-text question by convention, while `mode` was still required, so the model filled `RADIO` on questions that had nothing to pick. A mode that always carries meaning lets the UI render by `mode` alone.

**Consequence.** A question without options and without `FREE_TEXT` is a mistake of the model, not a convention the UI has to know.

### D71: A user's free-text answer is screened like a prompt

**Decision.** The free text of the `ANSWER` decisions of a resume runs through the input rules, once for all of them, before the run leaves the pause. A blocked answer returns `FAILED` and the run stays paused, so the user can answer again. Selected options are not text and are not screened; `APPROVE`, `EDIT` and `REJECT` are not screened either.

**Why.** A text typed into the answer form reaches the model like a prompt.

**Consequence.** A judge input rule costs one judge call per typed answer. Selected options can go unscreened because [the answer must fit its card](#d117-an-answer-must-fit-its-card): they are the card's own options.

### D69, D78: Leaving a pause is one atomic step

**Decision.** A resume or a cancel moves the run from `PAUSED` through one compare-and-set in the repository. The loser of a race gets a 409. The checks on the run (paused, not expired, action allowed) run before anything else, so a doomed resume pays no judge call.

**Why.** Two approvals arriving together (a double click, two tabs) must run the side-effect tool once.

### D75, D80: Pauses expire

**Decision.** A pause carries `expiresAt` (`IHumanGateConfig.timeoutMs`). `expirePausedRuns({tenantId})`, called by a scheduled job of the application, cancels every due pause like a user cancel: the run is closed, every waiting tool call is marked as not executed (each with its own `rejectionText`), the thread is open again. It returns the number of runs closed; one thread that cannot be closed does not stop the batch. A paused run without an envelope counts as due at once.

**Why.** A run that waits for an approval blocks its thread; without the job it would stay blocked for ever. A state nobody can leave by a decision must have a way out.

### D97: Stuck runs are recovered by a job

**Decision.** `recoverStuckRuns({tenantId})`, called by a scheduled job of the application next to `expirePausedRuns`, fails every run that is marked running and that no call works on: it takes the thread's lease first ([D77](#d77-one-call-at-a-time-on-a-thread)), moves the run to `FAILED`, answers the cut tool call with an error in the thread, opens the thread and releases the lease. It returns the number of runs recovered.

**Why.** A server that dies inside a `resume` leaves the run running and the thread waiting for a human. No door reopens that thread: `resume` and `cancelRun` refuse a run that is not paused, `ask` and `run` refuse a thread that waits, and the expiry job sees only paused runs. The lease is the proof: a live call holds it, so a lease obtained means nobody works on the thread.

**Consequence.** A busy thread, a thread that is gone and a thread that cannot be closed are skipped; the next job finds them again. The proof holds only while a call's `timeoutMs` ([D90](#d90-a-call-can-be-stopped-abortsignal-and-timeoutms)) is at most `IThreadStoreConfig.leaseMs`: a longer live call loses its lease and can be failed by the job while it runs. A clean stop needs no recovery: [`shutdown`](#d96-graceful-shutdown) closes its runs itself.

### D99: The answer waits for a human

**Decision.** A profile with `reviewAnswers: true` does not deliver the answer of a `run()`: once the answer passed the output checks, the run pauses with a `RESULT_REVIEW` envelope whose `result` is the answer as the user would get it (`text`, `structured`, `citations`, `issues`), the stream ends with `RUN_PAUSED` without a tool call, and the answer stays on the stored run. `resume()` finishes it without a model call: `APPROVE` stores the answer and returns the `ANSWER` the run would have returned; `EDIT` does the same with `editedInput` as the new text (a string; with an `outputSchema` it is parsed through the schema again, a miss is a 400 and the run stays paused; the output rules do not run on it); `REJECT` drops it: nothing is stored, the run is cancelled, the thread is open, the response is `FAILED` with `text` as the reason and the issue `answer_rejected` (`ANSWER_REJECTED_ISSUE_CODE`), and the stream withdraws the draft with `ANSWER_WITHDRAWN`. An `ask()` on such a profile is a 400: it has no run to pause.

**Why.** Tool approval gates the actions; some tenants must gate the words too: a moderator reads the reply of a support bot, a clerk checks a drafted letter, before the customer sees it. The reviewer sees only what passed the checks, so a blocked answer is never reviewed. The reviewer is the application's own person, like `instructions`, so an edit is not screened; the schema is the caller's code contract, so it holds. The edit is still bounded: at most the length the model's answer may have (`maxOutputTokens` × 4 characters), and an edit of a structured answer whose run kept no schema is refused rather than delivered next to the model's unreviewed value.

**Consequence.** The review is the tenant's policy, on the profile like `approvals`, and a call picks it by its profile. The tool turns of the run are stored at the pause (the tools did run); the answer is stored on approval or edit only. A cancelled or expired review drops the answer like a reject. A run can pause twice: for a tool, then for its answer, under one run id. Memory is extracted after an approved or edited answer, never after a rejected one.

### D36: A stored run carries what a resumed run needs

**Decision.** A paused run stores its request, the messages so far, the tool names and the pending envelopes, and three things of its first step: the thread's turn count before its question, the ids of the knowledge-base chunks in its request, and the version of the prompt template the request was rendered from. It does not store the `outputSchema`: a schema cannot be serialised, so `resume()` takes it again from its caller and is generic in it. The trace stores requests without the schema for the same reason.

**Why.** A run that paused and resumed answered poorer than one that never paused: no citations, trace entries without a template version, and the user's facts extracted from the resumed part only, so an extraction boundary the pause crossed was skipped.

**Consequence.** A resumed answer cites the chunks of the first step and every trace entry of the run carries them with the template version; the memory after a resumed answer reads the turns from the run's start. A run started with an `outputSchema` is resumed with the same schema again (`resume({outputSchema})`); without it the resumed answer is plain text, and an `EDIT` of a structured reviewed answer is a 400. The output rules of a resumed step get no chunks as evidence: the run keeps their ids, not their text.

---

## 11. UsageGuard

### D121: The application decides every model call

**Decision.** The gateway holds no token logic: no budget, plan, quota, remaining amount or ledger. Before every model call it makes, the main call and the helpers (memory, query rewrite, judge, embedding) alike, the `LLMClient` asks the application's `IUsageAdapter` (`IAIGatewayConfig.usageGuard.adapter`) `check` with the call's factors (tenant, user, profile, model, kind, thread, run, trace id) and a rough token estimate, and after the call it reports what the call used with `addUsage`, also for a failed or aborted call. The `UsageGuard` wraps the adapter: a `check` that throws is a denial, an `addUsage` that throws is logged. The profile keeps `maxStepsPerRun` and `maxOutputTokens`, caps of the loop and of one answer, not of spend.

**Why.** Every application counts differently: per tenant, per user, per model, in tokens, credits or money, per day or per plan. A limit shipped by the gateway is one rule for all of them and a second ledger next to the application's; one question and one report per call let the application apply its own rule, with the same facts the gateway has. Asking inside the `LLMClient` means no helper call can skip the question.

**Consequence.** A denial is a response, never an exception on the application's side: the answer of an `ask` or the first step of a `run` is `FAILED` with one ERROR issue `usage_denied`, a later step ends the run truncated (`LENGTH`) with a WARNING issue, an input judge fails the call, an output judge refuses the answer, a memory update is skipped, a query rewrite falls back to the question, a knowledge-base save fails. The application's `denyCode` and `denyUserMessage` travel through unchanged (`IIssue.data.denyCode`, `IIssue.userMessage`). Concurrent calls are the adapter's to order: the gateway asks about each on its own.

---

## 12. Guardrails

### D47, D49: One class with rules, and the severity is the only verdict

**Decision.** Built-in rules in code (input: not empty, under `maxPromptChars`, no prompt-injection marker; output: schema, truncation) and the application's `inputRules` and `outputRules` in config. A rule returns issues; `ERROR` blocks the call, `WARNING` and `INFO` travel on the response. Rules run in parallel under `ruleTimeoutMs` (default 10 s) or their own `timeoutMs`; a rule that throws or times out is the `ERROR` issue `rule_error`. Rules are fixed at construction and their names are unique.

**Why.** The libraries of the field (OpenAI Agents SDK, Mastra, NeMo) call every check a guardrail, built-in or custom. One vocabulary, one place.

**Consequence.** The application's rules run only when the built-in ones passed, so a rejected prompt pays no moderation call. How to write a rule, what it receives and what happens on each severity is in the [FAQ](../getting-started/FAQ.md#how-do-i-add-moderation-or-other-safety-checks).

### D57, D59: A rule gets a judge

**Decision.** `check` receives `judge({instruction, model?})`: one classification call on the profile's cheap model (`EJudgeModel.CHEAP`, default) or main model, with a fixed classifier prompt, structured output in the issue shape and temperature 0 where [the model takes one](#d82-a-model-says-whether-it-takes-a-temperature). The guardrails put the evidence into the call themselves: an input rule's judge sends the prompt and the files its `fileFilter` picks, an output rule's judge sends the question and the answer, with `chunks` and `toolResults` on request.

**Why.** A rule that classifies (moderation, topic scope, grounding) cannot be text matching. Rules are plain config created before the gateway exists, so the only other door to a model was a second gateway, whose calls escape the first one's usage adapter and trace. The judge is checked, reported and traced like every call and touches no thread, memory, template or tool.

**Consequence.** A verdict the schema rejects is `rule_error`, never a pass. The judge call ends with the rule's timeout.

### D73: A check's issues are on the trace entries of its judge calls

**Decision.** The trace entries of the judge calls a check made carry the check's issues.

**Why.** A rejected prompt produces no chat entry; without this the trace showed a judge call and nothing about its verdict.

### D107: How the developer is told that a rule failed

**Decision.** Every rule that throws or gives no answer in time is reported to `IGuardrailsConfig.onRuleError` with everything the gateway knows (`IRuleErrorReport`: tenant, user, thread when it exists, the stage — `INPUT` or `OUTPUT` —, the rule, whether it threw or timed out, the error as thrown, the `rule_error` issue the caller got, the evidence the rule checked, the trace ids of its judge calls, its timeout and duration). The handler is fire-and-forget: the check never waits for it, one that throws is logged and ignored. With or without a handler, the failure is logged on the server. A call the caller aborted is not a failure of the rule and is not reported.

**Why.** The issue the caller gets is short on purpose, so a moderation service that is down, a judge that answered out of shape and a timeout that is too short all read `rule_error`. One hook in the guardrails' config, rather than a callback on every rule, for the same reason as [for the tools](#d100-what-the-model-reads-when-a-tool-fails-and-how-the-developer-is-told): only the gateway sees the whole failure — a rule cannot see its own timeout — and a callback a rule forgets is a hole.

**Consequence.** The `issue` of the report is the issue of the response, so a support case that quotes it leads to the report; a judge out of shape is read in the trace entry its `traceIds` name.

---

## 13. LLMClient

### The AI SDK is sealed in one class

**Decision.** The Vercel AI SDK is imported in the LLM client only (a lint rule enforces it). Everything else, stored data included, uses the gateway's own message, result and event types.

**Consequence.** A provider or SDK upgrade touches one folder. Stored turns and runs stay readable across providers, which is what lets [any profile continue any thread](#d46-the-profile-and-with-it-the-model-is-chosen-per-call).

### The agent loop is the gateway's own

**Decision.** The SDK's built-in multi-step loop is not used. The gateway calls the model once per step and owns the loop: narrowing the tools per step, asking whether a tool needs approval, executing it, ending after [a tool that ends the run](#d86-a-tool-can-end-the-run), stopping on `maxStepsPerRun` or on the [usage adapter's refusal](#d121-the-application-decides-every-model-call).

**Why.** A run must pause mid-loop, be stored, and continue hours later in another process. The SDK's loop lives in memory inside one call.

**Consequence.** Pauses, approvals and resumes behave the same on every provider, and the scripted model of the tests runs the same loop as the real one. A single-request chatbot that never pauses would be simpler on the SDK's loop; this library is built for the pausing case.

### D83: Amazon Bedrock is a provider of its own

**Decision.** `EModelProvider.BEDROCK` is a provider next to `OPENAI` and `ANTHROPIC`. A registry entry on it names the model by Bedrock's own id (`anthropic.claude-haiku-4-5-20251001-v1:0`), so the same Claude model through Bedrock and through Anthropic are two entries. Its credentials are a Bedrock API key in `apiKey` and the optional `region`; `baseUrl` is honoured as for the other providers.

**Why.** Bedrock serves the Anthropic, Amazon, Meta and Mistral models under its own ids and its own authentication, which no `baseUrl` of another provider can express.

**Consequence.** Everything above the LLM client is untouched: a profile on a Bedrock entry runs the same threads, tools, pauses and guardrails. Bedrock embedding models (Titan, Cohere) work through `embed`. IAM key pairs are not accepted yet; an installation that cannot use a Bedrock API key needs that added.

### D84: Every provider of the enum has an adapter

**Decision.** `EModelProvider` lists `OPENAI`, `ANTHROPIC`, `GOOGLE`, `MISTRAL` and `BEDROCK`, and the LLM client has an SDK adapter for each. OpenAI, Anthropic, Google and Mistral take `apiKey` and the optional `baseUrl`; Bedrock is described in D83.

**Why.** An enum member without an adapter is a promise the config cannot keep: a registry entry on it is accepted and fails at the first call.

**Consequence.** `embed` works on OpenAI, Google, Mistral and Bedrock. Anthropic has no embedding models, so an Anthropic entry with `caps.embeddings` is refused with a 400.

### D123: The system prompt travels as blocks

**Decision.** `IModelRequest.system` is an ordered list of `ISystemBlock` (`{text, cache?}`), not one string. The `ContextAssembler` builds the blocks; the `LLMClient` maps them per provider: a provider that takes cache markers (Anthropic) gets one system block per entry, with the marker where `cache` is set, every other provider gets the texts joined. `joinSystem({blocks})` is the one join (a blank line between the texts, the marks dropped); the token estimate and the `debug.system` of an answer, which stays a string, use it.

**Why.** A provider's prompt cache matches an exact prefix and has to be told where the stable part of the prompt ends. One string cannot carry that boundary; a list of blocks carries it without a second field that has to agree with the text.

**Consequence.** A host that overrides the `LLMClient` or the `ContextAssembler`, or builds an `IModelRequest` itself, builds or reads blocks (`[{text}]` for one unmarked block; `joinSystem` to get the text). The pseudonymised skeleton of a run has `system: []`. Whether the stable block is marked, and whether tenants may share a cache entry, is decided by two required switches, `contextAssembler.promptCaching` and `contextAssembler.sharePromptCacheAcrossTenants` (a switch is never optional in this library: whoever configures the gateway decides), so `IAIGatewayConfig.contextAssembler` is required. The `CHANGELOG.md` of the package carries both migrations.

---

## 14. ContextAssembler

### D20, D42, D68: The system prompt is one template with layers

**Decision.** Every call sends one system prompt: the `CHAT_MAIN` template with its slots filled, from the most general (the base text, the profile's addendum) to the most specific (the call's instructions and context), then the data layers (memory, knowledge base) with labels that say they are data.

**Consequence.** The full table, which layer to use for which text and why the order, is in [System prompt layers](System%20prompt%20production%20layers.md).

---

## 15. Trace

### Every model call leaves an entry

**Decision.** Each call writes an `ITraceEntry` with its kind (`ETraceKind`: chat, run step, memory, query rewrite, judge, embed), tenant, user, profile, thread and run, model, template version, usage, cost, the chunk ids it was given and the issues of its check, plus the full request and result. What of that is persisted is the repository's decision: it drops what it must not keep in `save`.

**Consequence.** The trace is the place to answer "what did the model see and what did it cost"; `debug: true` on a call gives the same transcript on the response for development.

---

## 16. Persistence

### D28, D29: Every store has a seam, and the names of its tables are configuration

**Decision.** Every store takes a `repository` or `adapter` interface in its config; in-memory implementations of all of them ship with the library. A real adapter is constructed with the names of the collections or tables it uses; none is hard-coded.

**Why.** The whole gateway runs and is tested without infrastructure. Where a tenant's data lives is what tenant isolation rests on, so the developer who wires the gateway decides it: one set of names with a tenant column, a set per tenant, or a schema per tenant.

**Consequence.** The real adapters are planned, see the [Roadmap](../Roadmap.md#planned).

### D120: The real adapters are packages of their own

**Decision.** The repository is a pnpm workspace. `dyna-ai-gateway` stays one package, with no database driver among its dependencies. Each real adapter is a sibling package: `dyna-ai-gateway-mongodb` (the MongoDB repositories and the Atlas Vector Search index), `dyna-ai-gateway-postgres`, `dyna-ai-gateway-s3`. They are placeholders until they are implemented and are not published before.

**Why.** This is the shape of Auth.js, Keyv and the AI SDK: the core defines the seam, each backend is a small package that declares its driver as a peer dependency with a version range. The application installs the driver it already uses, so the gateway never brings a second copy of it, and an adapter receives a connected client instead of a connection string, so the application keeps the connections, the pooling and the credentials.

**Consequence.** An application installs the gateway and only the adapter packages it uses. The conformance tests of the repositories will be exported, so an adapter written outside this repository can run the same suites.

### D37: Lists page by cursor

**Decision.** A paged list takes `{limit, startingAfter, endingBefore}` and answers `{items, hasMore}`, newest first. No `skip`, no page numbers.

**Why.** This is how the Vercel chat client pages its conversations; a cursor is stable while rows are added.

**Consequence.** `listThreads` (the gateway and `ThreadStore`) and `PromptTemplateStore.listVersions` page this way: `limit` is 1–200 and only one cursor may be set (400), a cursor that is not an item of the list is a 404. The order is by creation, so a thread used again keeps its place. A thread's history is not paged: `getTurns` returns every turn, oldest first.

---

## 17. AIGatewayVercelUi

The server-only module `dyna-ai-gateway/vercel-ui` that speaks the Vercel UI message protocol for a chat client on `useChat` (D40). How to use it: [Vercel chat client](../getting-started/Vercel%20chat%20client.md).

### D34: One answer is one message

**Decision.** `history` folds the assistant and tool turns of one answer, up to the next user turn, into one assistant message with a `step-start` part before each model step. Tools are `dynamic-tool` parts, rendered by their name.

**Why.** A chat screen shows one bubble per answer: "looked up invoice 4521" and the answer text together, not three bubbles for the tool request, its result and the text. The gateway's tools are registered at runtime, so a client cannot know their types at compile time.

**Consequence.** The id of a streamed answer and the id of the same answer read back from `history` differ (the first turn's id): reload the thread with `history` when you reopen it, never merge the two.

### D35: The approval card is the SDK's own

**Decision.** A tool call that waits for a human is streamed as the SDK's `tool-approval-request` and drawn as a `dynamic-tool` part in state `approval-requested`; the approval id is the pause's `pauseId` (D110). The client's Approve / Reject comes back to the `chat` endpoint as an `approval-responded` part, and the module resumes the run with one decision per card. `EDIT`, `ANSWER` (the form of a user question) and a `REJECT` with the asker's own text go through `AIGatewayVercelUi.resume`.

**Why.** `useChat` ships the approval flow (`addToolApprovalResponse`, `sendAutomaticallyWhen`); the module speaks it instead of inventing a second one. The pause id, not the run id, because a run can pause twice under the same run id and the same approval must not decide both.

**Consequence.** The module finds the pause among the calling user's own paused runs: an approval id of nobody's pause, or of another user's, is a 404. Everything the SDK's card cannot show (the allowed actions, the question form, the expiry) is in the message's `metadata.pause`.

