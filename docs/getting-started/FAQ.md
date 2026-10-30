# FAQ

## How can the user change the model?

The model is chosen **per call**, through the profile. A thread is not bound to a model or a profile, so the next call of
any thread can run on another model.

1. **One profile per model the user may pick.** A profile (`IAIProfile`) bundles the model with what goes with it: the cheap
   helper model, the tools, the approvals, the prompt addendum and the limits. Create them once per tenant:

   ```ts
   await gateway.aiProfileStore.upsertProfile({
     tenantId,
     profile: {
       id: "claude",
       tenantId,
       name: "Claude",
       modelId: "claude-sonnet-5-5",
       allowedTools: ["get_invoice"],
       approvals: [],
       promptAddendum: "",
       limits: {/* … */},
     },
   });
   ```

2. **The application remembers the user's choice** — per user or per thread, in its own database — and passes it on every call:

   ```ts
   const response = await gateway.ask({
     userContext,
     threadId,
     profileId: "claude", // the user's choice, or the application's own fallback when the user has not picked one
     prompt,
     kbFilters,
   }).response;
   ```

That is all. There is no `switchModel`: switching is the application's decision, the gateway just answers with the
profile it is given.

**What carries over to the new model**

- The conversation and the thread's memory: they are stored in the gateway's own format, not a provider's.
- The user's facts (user memory).

**Good to know**

- Switch between calls, not during one. A call that is still answering keeps its model.
- A model with a smaller context window gets fewer of the older turns; the thread's memory still carries their gist.
- A model without tool support simply gets no tools (`run` behaves like `ask`).
- A paused run resumes on the profile it started with, unless `resume({profileId})` names [another one](../architecture/Decisions.md#d65-resume-continues-a-paused-run-on-another-profile): the
  continuation then runs on that profile's model, tools and limits; the system prompt and the messages so far stay. The
  review of the answer and the approvals stay those of both profiles together, so a switch cannot skip a reviewer or an
  approval the run started under. The [skills](../architecture/Decisions.md#d124-skills-instructions-the-model-loads-on-demand)
  the model can load are the new profile's and the ones the call brought; the list in the system prompt stays the one of the start.
- `profileId` is required on every call, also on an existing thread. The gateway has no default profile: when the user has
  not picked a model, the application passes the profile it chose as its fallback ([D103](../architecture/Decisions.md#d103-a-call-always-names-its-profile)).

## How do I add moderation or other safety checks?

With **Guardrails rules**. The gateway has no moderation of its own: the application plugs in the check it trusts (a
provider's moderation endpoint, a classifier, a topic filter, a business check). Rules are given in the gateway config and
are fixed at construction:

```ts
const gateway = new AIGateway({
  // …
  guardrails: {
    // On the prompt, before anything is stored or sent to the model
    inputRules: [
      {
        name: "moderation",
        timeoutMs: 3_000, // optional; default ruleTimeoutMs (10 s)
        check: async ({evidence, abortSignal}) => (await myModeration(evidence.prompt, {signal: abortSignal})).flagged
          ? [{code: "moderation", message: "The question was blocked", severity: EIssueSeverity.ERROR}]
          : [],
      },
    ],
    // On the answer, after the model call
    outputRules: [
      {
        name: "answer_moderation",
        check: async ({evidence}) => (await myModeration(evidence.output)).flagged
          ? [{code: "moderation", message: "The answer was blocked", severity: EIssueSeverity.ERROR}]
          : [],
      },
    ],
  },
});
```

**What a rule gets**

- Input rules (`IInputEvidence`): the sanitised `prompt`, the `files` of the question (pointers), `userContext`, the call's
  `profile`, and `threadId` — `undefined` when the call starts a new thread (it does not exist yet).
- Output rules (`IOutputEvidence`): the user's `prompt`, `output` (the parsed structured answer, or the text when no
  `outputSchema` was given), `chunks` (the knowledge-base chunks that were in the request — for grounding checks),
  `toolResults` of the run, `userContext`, `profile`, `threadId`.
- Both: an `abortSignal`, aborted when the rule's time is up — pass it to your HTTP call.

The `profile` lets one rule act per use case, e.g. stricter moderation for a "kids" profile.

**What happens**

- The gateway's built-in rules run first (input: not empty, not over `maxPromptChars`, no prompt-injection marker; output:
  schema, truncation). Your rules run only when those passed, and **in parallel**; their issues come back in rule order.
- An `ERROR` issue → the response is `FAILED` with that issue. A rejected prompt is not stored; a rejected answer is not
  stored and gets no memory update.
- A `WARNING` or `INFO` issue → the call goes on and the issue is in `response.issues`.
- Every issue of a rule carries its name in `issue.ruleName`.
- **The severity is the only verdict.** There is no other switch: choose ERROR, WARNING or INFO.
- A rule that **throws** or **does not answer in time** becomes the ERROR issue `rule_error` — the call is blocked. The
  error is logged on the server (`Internal error …: Guardrails: rule [name] …`), the issue carries a short message only.
  To be told, register one handler for all rules (below).
- A **minor** check whose own service fails should not block: catch it and return a WARNING with your own `code` — the
  call passes and the failure stays visible in `response.issues` and the trace:

  ```ts
  check: async ({evidence, abortSignal}) => {
    try {
      return await myStyleCheck(evidence.output, {signal: abortSignal});
    }
    catch {
      return [{code: "style_check_unavailable", message: "The style check was not done", severity: EIssueSeverity.WARNING}];
    }
  },
  ```

- **`message` may be shown to the end user** (`response.issues` goes back to the application, and UIs often display it).
  Keep vendor errors, ids and stack traces out of it — throw them instead, and they reach `onRuleError`, not the user.
- Rule names are unique (also against the built-in ones); a duplicate throws when the gateway is constructed.

**Being told that a rule failed.** Register one handler for all rules, in the guardrails' config:

```ts
const gateway = new AIGateway({
  // …
  guardrails: {
    inputRules: [/* the "moderation" rule above */],
    onRuleError: (report): void => {
      logger.error("guardrail rule failed", {
        rule: report.ruleName,
        stage: report.stage,         // ERuleStage.INPUT or OUTPUT
        failure: report.failure,     // ERuleFailure.THREW or TIMED_OUT
        error: report.error,         // as thrown; absent on a timeout
        threadId: report.threadId,
        traceIds: report.traceIds,   // the rule's judge calls: a judge that answered out of shape is read there
        durationMs: report.durationMs,
      });
    },
  },
});
```

- It is called once for **every** failed rule, built-in ones included, with `IRuleErrorReport`: tenant, user context, thread
  (absent on the input check of a new thread), stage, rule, how it failed, the error as thrown, the `rule_error` issue the
  caller got (`report.issue`), the evidence the rule checked, the trace ids of its judge calls, its timeout and duration.
  A `TIMED_OUT` with a `durationMs` close to `timeoutMs` on every call says the timeout is short for what the rule does.
- It is fire-and-forget: the check never waits for it, and a handler that throws is logged and ignored.
- A call aborted by the caller is not reported: the rule did not fail.

**Streaming: the user may already have seen the answer.** The answer is streamed on the call's `events` (`TEXT_DELTA`)
while the model writes it; the output rules run when it is complete. Decide in the application:

- Show the deltas live (fast) and **replace the streamed text when the final response is `FAILED`**, or
- For strict cases, do not show the deltas; show only the final response.

## How do I control whether a tool call runs?

A tool declares what happens to each of its calls before it runs, with `policy` (D87): the call runs, a human approves it
first, or it is refused and the model is told why. The decision is taken on the parsed input, outside the tool's own code,
so a refund above the charge never reaches `execute` and never reaches a human either:

```ts
import {z} from "zod";
import {
  EToolCallVerdict,
  TToolCallPolicyResult,
  defineTool,
} from "dyna-ai-gateway";

export const refundTool = defineTool({
  name: "refund",
  description: "Refunds an amount in EUR to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: ({input}): TToolCallPolicyResult => {
    if (input.amount > 1_000) {
      return {
        verdict: EToolCallVerdict.DENY,
        reason: `The refund of ${input.amount} EUR is above the charge of 1000 EUR; at most 1000 EUR can be refunded.`,
      };
    }
    if (input.amount > 100) {
      return {
        verdict: EToolCallVerdict.NEEDS_APPROVAL,
        rejectionText: `The refund of ${input.amount} EUR was declined by the support agent; nothing was refunded.`,
        reasonCode: "amountOverLimit",
      };
    }
    return {verdict: EToolCallVerdict.ALLOW};
  },
  execute: async ({input: {amount}}): Promise<{refunded: number}> => ({refunded: amount}),
});
```

- A plain verdict applies to every call: `policy: EToolCallVerdict.NEEDS_APPROVAL` for a tool that always waits for a
  human, `EToolCallVerdict.DENY` to switch a tool off without removing it. Omitted means every call runs.
- The predicate may be async and look something up (the customer's history). It receives the parsed input and the
  `userContext`.
- `DENY` refuses the call before it runs. The model reads a fixed sentence saying the tool was not executed, followed by
  your `reason`, and goes on: the other calls of the same step still run, and the run does not pause or end. Make the
  reason say what would be accepted.
- `NEEDS_APPROVAL` pauses the run: the response is `PAUSED` with the tool call in one of its `envelopes`, and `resume()`
  continues it with the human's decisions ([several cards](#the-run-paused-with-several-cards-how-do-i-answer-them) when
  several calls of the step wait). If the human rejects, the model reads your `rejectionText` followed by the human's
  reason; without one, a default sentence that says the call was declined and not executed.
- `reasonCode` tells your approval card *why* the call waits, as a key of your translations (`"amountOverLimit"`).
  The card shows *what* the call does from `toolCall.toolName` and its input; the code matters when one tool pauses for more
  than one reason. The envelope carries it as `reasonCode`; the model never sees it.
- The profile's `approvals` are the floor: a tool listed there pauses even when its policy says `ALLOW`. A `DENY` wins
  over everything, so a human is never asked to approve a call that would be refused.
- A human who approves with `EDIT` changes the input, and the edited input goes through the policy again: a `DENY` gives the
  model the refusal and the tool does not run, so an edit cannot push through what the policy refuses. `NEEDS_APPROVAL` on
  the edited input does not pause again: the human just approved that input.
- An input the schema rejects never reaches the policy; `execute` reports the mismatch to the model.

## Do the tools of a step run in parallel? How do I switch it off?

Yes (D101). When the model asks for several tools in one step, every call is decided first (its `policy`, in request order),
then the allowed calls run concurrently, and their results are written to the thread in request order once the whole batch
has settled. The calls of one step cannot depend on each other: the model emits them before any result exists, so nothing
is lost by running them at once; a model that needs an order asks in a later step.

Switch it off per profile:

```ts
const profile: IAIProfile = {
  ...sequentialProfile,
  parallelToolCalls: false, // the calls of a step run one after the other, in request order
};
```

- A tool whose `policy` is a predicate is the exception: its calls are decided and run one by one, after the other calls
  of the step, in request order. Such a policy may look at state the step changes ("deny when the charge is already
  refunded"); deciding every call up front would let the same refund through twice.
- With `false` a call is decided right before it runs, so a call that needs a human pauses the run before the calls behind
  it are looked at; the run pauses once per such call, one card each.
- A stop (`abortSignal`, `timeoutMs`) inside a batch keeps the results of the calls that finished; the cut calls get an
  error result.
- The switch does not tell the model to ask for one tool at a time; that is a provider option the library does not set.

## The run paused with several cards. How do I answer them?

On a parallel profile a step can hold several calls back at once: two approvals, or an approval and a question to the
user. The response is one `PAUSED` with every card in `envelopes`, in the order the model asked, all with the same
`expiresAt`; the stream says `RUN_PAUSED` once with the calls in `toolCalls`. `resume()` takes one decision per card, named
by the card's `callId`, in one call (D102):

```ts
if (paused.kind === EGatewayResponseKind.PAUSED) {
  const decisions: IResumeDecision[] = paused.envelopes.map(envelope => {
    if (envelope.kind === EPauseKind.TOOL_APPROVAL) {
      return {callId: envelope.callId, action: EResumeAction.APPROVE};
    }
    if (envelope.kind === EPauseKind.USER_QUESTION) {
      return {callId: envelope.callId, action: EResumeAction.ANSWER, answers: answersFor(envelope.userQuestions)};
    }
    return {action: EResumeAction.APPROVE}; // a RESULT_REVIEW is always the only card
  });
  await gateway.resume({
    userContext, 
    runId: paused.envelopes[0].runId, 
    pauseId: paused.pauseId, 
    decisions,
  }).response;
}
```

- All or nothing: a card without a decision, a decision that names no card of this pause, two decisions for one card, or
  an action the card does not `allow` is a 400, and the run stays paused with every card.
- One card, one decision: when `envelopes` has one entry, the decision needs no `callId`. The sequential profile and the
  review of an answer always pause with one card.
- Every pause has its own `pauseId` (on the response and on each card), and `resume()` requires it. A run can pause again
  under the same `runId` — an approval, then the review of its answer — and a decision sent for an earlier pause (a retry,
  a second click) is a 409: it never decides the next pause.
- The decisions are applied together: the approved and edited calls run (concurrently on a parallel profile), the
  rejected ones get their `rejectionText` with your reason, the answers become the question's result, and the model
  continues once, with every result in request order.
- The free text of every `ANSWER` is screened by the input rules once, together; a blocked text leaves the run paused
  for another set of decisions.
- An `ANSWER` must fit its card: one answer per question, in order; `selected` only options of that question (one on a
  RADIO, none on a FREE_TEXT question); `freeText` only on a FREE_TEXT question or one with `freeOption`. Anything else is
  a 400 and the run stays paused. The model reads the card's own question text, not the `question` your client sent.
- A cancel or an expiry closes every card's call, each with its own `rejectionText`.

## What does the model read when my tool fails, and how do I get told?

A tool that throws does not end the run: the error becomes the tool's result and the model reads it to recover — ask the user
for what is missing, try another way, answer without the tool (D100). The model never reads the error's `message`: it reads
one line built from the fields of a `dynaError` that are safe for the end user, `code`, `status` and `userMessage`. So a tool
that wants the model to recover says what went wrong and how to proceed in `userMessage`, and keeps the developer's detail in
`message` and `data`:

```ts
import {z} from "zod";
import {dynaError} from "dyna-error";
import {defineTool} from "dyna-ai-gateway";

export const lookupOrderTool = defineTool({
  name: "lookup_order",
  description: "Returns one order of the customer by its id.",
  inputSchema: z.object({orderId: z.string()}),
  tags: ["orders"],
  execute: async ({input: {orderId}, userContext}): Promise<{orderId: string; total: number}> => {
    const order = await ordersDb.find({tenantId: userContext.tenantId, orderId}); // the app's own data access
    if (!order) {
      throw dynaError({
        code: 82758244,
        status: 404,
        // For the developer: the log and onToolError
        message: `lookup_order: no order [${orderId}] for tenant [${userContext.tenantId}]`,
        // For the model, and through it the user: safe, and says how to proceed
        userMessage: `No order with id ${orderId}. Ask the customer for the order number on the invoice.`,
        data: {orderId},
      });
    }
    return order;
  },
});
```

The model reads `code: 82758244, status: 404, userMessage: No order with id 4711. Ask the customer for the order number on the
invoice.` — the `status` tells it the class of the failure, the `code` is what the user can quote to support.

- A tool that lets a plain `Error` through (its HTTP client's `ECONNREFUSED 10.0.4.12:5432`) leaks nothing: the model reads a
  generic text — the input was not the cause, do not retry it unchanged — with the gateway's code and status 500; the real
  error is logged on the server and reported to you. The same for a `dynaError` without a `userMessage`.
- `canRetry: false` on the error appends "Do not retry this call." for a failure that repeats with the same input.
- A `userMessage` over 2 000 characters is cut there and marked `[cut]`: the model reads a recovery hint, not a document.
- The gateway's own refusals (an input the schema rejects, a tool the model was not offered, a timeout, an oversized output,
  a guarded tool called before what it requires) read the same way, each with a `userMessage` that says how to recover.
- The stored result (`IToolResultPart`) carries `failed: true` and the error's code as `errorCode`, so a UI that renders the
  thread names the failure without parsing the text.

To be told, register one handler for all tools, in the registry's config:

```ts
const config: IAIGatewayConfig = {
  ...,
  toolRegistry: {
    tools: [lookupOrderTool],
    onToolError: (report): void => {
      logger.warn("tool failed", {
        tool: report.toolName,
        code: (report.error as {code?: number}).code,
        callId: report.callId,     // the id of the call in the thread and in the next step's trace request
        threadId: report.threadId,
        stepIndex: report.stepIndex,
        durationMs: report.durationMs,
        modelText: report.modelText, // the line the model read
      });
    },
  },
};
```

- It is called for **every** failed call, with `IToolErrorReport`: tenant, user context, thread, run (when stored), step, the
  model's `callId`, the tool, the input (parsed, or raw when the schema is the failure), the error as thrown, the text the
  model read, the duration. An invalid input says the tool's description or schema is unclear to the model; a timeout that
  the tool's `timeoutMs` is short for what it does.
- It is fire-and-forget: the run never waits for it, and a handler that throws is logged and ignored.
- A call you aborted (`abortSignal`, `timeoutMs`) is not a failure of the tool and is not reported.
- To find the call later: `report.callId` is on the thread's tool call and tool result, and in `request.messages` of the
  next step's trace entry; `report.threadId` filters the trace.

## How do I have a human review the answer before the user sees it?

Set `reviewAnswers: true` on the profile (D99). Every `run()` on that profile stops after its answer passed the output
checks and before anything is delivered: the response is `PAUSED` with a `RESULT_REVIEW` envelope, and the thread waits for
a human. The draft is the reviewer's: it is not streamed, the asker's `PAUSED` response and `listPausedRuns` leave it out,
and the reviewer's screen reads it with `getPausedRun`.

```ts
const paused = await gateway.run({
  userContext,
  profileId: "reviewed-support",
  prompt: "Where is my order?",
  kbFilters,
}).response;
const [card] = paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes : [];
const {runId, pauseId} = card ?? {runId: "", pauseId: ""};

// on the reviewer's screen (your own check of who may review): the stored run holds the draft
const stored = await gateway.getPausedRun({tenantId: userContext.tenantId, runId});
const [review] = stored.pending ?? [];
if (review?.kind === EPauseKind.RESULT_REVIEW && review.result) {
  const {text, structured, citations, issues} = review.result;
  // render the draft for the reviewer
}

// the reviewer approves it as written (a review is always the only card, so the decision needs no callId)
await gateway.resume({userContext, runId, pauseId, decisions: [{action: EResumeAction.APPROVE}]}).response;
// or delivers a corrected text
await gateway.resume({userContext, runId, pauseId, decisions: [{action: EResumeAction.EDIT, editedInput: "Your order arrives Friday."}]}).response;
// or drops it, with the reason the application receives back
await gateway.resume({userContext, runId, pauseId, decisions: [{action: EResumeAction.REJECT, text: "Wrong delivery date."}]}).response;
```

- No model is called on the decision. `APPROVE` and `EDIT` return the `ANSWER` the run would have returned (usage, citations,
  warnings included) and store it as the assistant turn; `REJECT` stores nothing and returns `FAILED` with your `text` as
  the reason and the issue code `ANSWER_REJECTED_ISSUE_CODE`.
- The reviewer's text is not screened by the output rules: the reviewer is your own person, like `instructions`. A run
  started with an `outputSchema` parses the edited text through the schema again, so hand the schema to `resume()` again
  as `outputSchema` (a stored run keeps none, [D36](../architecture/Decisions.md#d36-a-stored-run-carries-what-a-resumed-run-needs));
  a text that does not match is a 400, and so is an edit without the schema, and the run stays paused for another decision.
- The edited text may be as long as the model's answer may be, `maxOutputTokens` × 4 characters; a longer one is a 400
  and the run stays paused. The edit becomes the assistant's turn, so the model reads it as history on the next call.
- The draft never reaches the asker: on a reviewing profile the model's text is not streamed on `events` (the stream ends
  with `RUN_PAUSED`), the `RESULT_REVIEW` card of the `PAUSED` response has no `result`, and `listPausedRuns` returns a
  summary per run (ids, cards, dates) without the draft, the system prompt or the messages. The asker's UI shows "in
  review" until the decision returns the `ANSWER`.
- `getPausedRun({tenantId, runId})` returns the whole stored run, the draft included: an admin surface, like `trace`.
  Check who may review before you call it, and never hand its result to the asker: it holds the system prompt (memory
  notes, knowledge-base excerpts) and every tool output.
- An answer the output rules block is `FAILED` as on any profile; a reviewer never sees it.
- Cancel and expiry work as for an approval: the answer is dropped and the thread is open again.
- `ask()` on a reviewing profile is refused with a 400: it has no run to pause. Use `run()`, with or without tools.
- The review pauses the thread for every message of the conversation on that profile, so use it for the profiles that need
  it, not as a default.
- A review never shares a pause with a tool approval: it comes after the step, when every tool has finished (D102).

## How much of the conversation does the model see, and how do I choose?

The thread's history reaches the model through the working memory, with one of two strategies ([D122](../architecture/Decisions.md#d122-the-working-memory-owns-the-threads-window)):

| Strategy                                | What the model gets                                                                                              | Pick it for                                                                                                                  |
|-----------------------------------------|------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `EWorkingMemoryStrategy.SLIDING_WINDOW` | The newest turns that fit the model's window, word for word; nothing stored, no helper model call.               | Exact wording (code, documents, quoting the user), short-lived threads, large windows, no "what do you remember" UI.         |
| `EWorkingMemoryStrategy.SUMMARY_BUFFER` | A rolling summary and facts written by the cheap model, then the last `recentTurns` turns verbatim. The default. | Long-lived threads at a flat cost per call, a visible and resettable memory, a thread context for the knowledge-base search. |

The gateway's default strategy is `workingMemory.strategy`; a profile overrides it with `workingMemory`, so one tenant runs a precise chat bot and a cheap long-thread agent side by side:

```ts
import {IAIGatewayConfig, EWorkingMemoryStrategy} from "dyna-ai-gateway";

const config: IAIGatewayConfig = {
  // …
  workingMemory: {
    enabled: true,
    strategy: {
      type: EWorkingMemoryStrategy.SLIDING_WINDOW,
      chatHistoryRatio: 0.5, // half of the room stays for the knowledge-base chunks (default 0.8)
    },
  },
};

await gateway.aiProfileStore.upsertProfile({
  tenantId,
  profile: {
    ...supportAgent,
    workingMemory: {
      type: EWorkingMemoryStrategy.SUMMARY_BUFFER,
      recentTurns: 10,       // the verbatim tail after the summary (default 20)
      updateEveryTurns: 2,   // the cheap model rewrites the summary every second turn (default 1)
    },
  },
});
```

The window is sized in tokens, from what the rendered system prompt leaves of the model's context after the answer's reserve (`contextAssembler.reserveOutputTokens`, default: the call's `maxOutputTokens`). Under `SLIDING_WINDOW` the turns take at most `chatHistoryRatio` of it; the rest is for the knowledge-base chunks. Turns that were left out are reported as the WARNING issue `turns_trimmed` on the response.

- `workingMemory: {enabled: false}` sends the last 20 turns and remembers nothing; no helper model is ever called.
- `getThreadMemory` shows the stored summary and facts; under `SLIDING_WINDOW` it is the empty state, or the summary an earlier `SUMMARY_BUFFER` period left: a switch never wipes it, a switch back resumes from it. `resetThreadMemory` clears it.
- Your own memory model: implement `IWorkingMemory` (`load`, `saveContext`, `getState`, `reset`) and pass it in the constructor's `overrides`; it receives the gateway's `workingMemory` config and the shared children (`threadStore`, `turnBuilder`, `llmClient`, `promptTemplateStore`). See [Dependency injection](../architecture/Live%20adjustment%20and%20dependency%20injection.md#23-what-can-be-injected).

```ts
import {IWorkingMemory, IWorkingMemoryConfig, IWorkingMemoryDeps, AIGateway} from "dyna-ai-gateway";

class GraphMemory implements IWorkingMemory {
  constructor(private readonly config: IWorkingMemoryConfig, private readonly deps: IWorkingMemoryDeps) {}
  // load, saveContext, getState, reset
}

const gateway = new AIGateway(config, {workingMemory: (memoryConfig, deps) => new GraphMemory(memoryConfig, deps)});
```

## How do I control the spend?

In your own code: the gateway asks your usage adapter before every model call and tells it what the call used after it, and
holds no budget, plan or quota itself. The contract, an example adapter and what a refused call does are in
[Usage adapter](Usage%20adapter.md).

## Is the system prompt cached, and what does it cost?

Yes, when `contextAssembler.promptCaching` is `true` ([D123](../architecture/Decisions.md#d123-the-system-prompt-travels-as-blocks)).
The system prompt is sent as two blocks, split at the `{cacheBreakpoint}` placeholder of `CHAT_MAIN`:

| Block    | Holds                                                                                                  | Same on                   |
|----------|--------------------------------------------------------------------------------------------------------|---------------------------|
| Stable   | the template text, the output format, the profile's `promptAddendum`, the skills                       | every call of the profile |
| Per-call | the date, locale and timezone, the call's `instructions` and `context`, the memory, the knowledge base | this call                 |

The stable block is marked for the provider's cache; the `LLMClient` puts the provider's marker on it (Anthropic:
`cache_control`). The first call of a profile writes the entry, the next ones within the cache's lifetime (5 minutes) read
it at the cache-read rate (Anthropic: 0.1× the input price; the write costs 1.25×) and their answer starts sooner. The
history, the question and the answer are never cached. A model caches only a prefix above its minimum (Anthropic: 512
tokens on the Opus 5.5 / Sonnet 5.5 / Haiku 5.5 family, 1 024–4 096 on older ones, e.g. 4 096 on `claude-haiku-4-5`), so a
short stable block is sent with the marker and simply not cached; a long addendum and many tools make it pay.

Claude on Amazon Bedrock gets the same split with Bedrock's cache point on the stable block; Bedrock takes no marker on the
tool definitions. Set `costCacheReadPerMTokUsd` and `costCacheWritePerMTokUsd` on a Bedrock model entry: Bedrock serves
several model families, so the gateway assumes no cache discount there. OpenAI caches a prefix of 1 024 tokens or more on
its own, without a marker; the gateway sends `promptCacheKey`, a hash of the stable block's text, so the calls that share
the block land on the same cache. The other providers get the blocks as one plain string.

- **The cost follows the cache.** `IUsage` of every call reports `inputTokens` (the whole prompt), `cachedInputTokens`
  (read from the cache) and `cacheWriteInputTokens` (written by this call); the usage adapter and the trace get them. The
  cost estimate prices the read tokens at `IModelCaps.costCacheReadPerMTokUsd` and the written ones at
  `costCacheWritePerMTokUsd`, the rest at `costInPerMTokUsd`. Both are optional: on an Anthropic model they default to
  0.1× and 1.25× the input price; on any other provider to the input price itself, so set `costCacheReadPerMTokUsd` on an
  OpenAI model entry if its cached rate should show in the estimate.
- **Skills are in the stable block** ([D124](../architecture/Decisions.md#d124-skills-instructions-the-model-loads-on-demand)):
  a profile's `skills` are the same on every call, so they are cached with the addendum. A call that passes its own `skills`
  changes the block: calls with the same skill set read one entry, a different set writes another.
- **Switch it off:** `contextAssembler: {promptCaching: false, …}`: one block, no marker.
- **A stored template** (`PromptTemplateStore`, a new version of `CHAT_MAIN`) is cached only when it keeps
  `{cacheBreakpoint}` with nothing per-call before it. A per-call slot before it switches the cache off for the call and
  reports the WARNING issue `prompt_cache_off` on the response; a template without the placeholder is sent as one block,
  with no issue. See [System prompt layers](../architecture/System%20prompt%20production%20layers.md).
- **Across tenants:** `sharePromptCacheAcrossTenants` is required. `false`: the stable block opens with
  `[cache scope <hash of the tenant id>]`, so each tenant writes and reads its own entries and the tool definitions get no
  marker. `true`: two tenants whose stable block is identical to the byte (same template, same addendum) read one entry,
  and the tool definitions are marked too. Only that block is shared; the per-call block, the history and the answers
  never are. The tenant that wrote the entry paid the write price; a tenant that reads it pays the read price and gets a
  faster start. Keep `false` when a faster or cheaper call must not reveal that another tenant sent the same profile text
  in the last minutes.

## How does a run end, and can a tool end it?

A run (`run()`) ends when the model answers without asking for a tool, when the profile's `maxStepsPerRun` is reached or
your [usage adapter](Usage%20adapter.md) refuses a step (the answer then carries the truncation warning), or when a tool that
**ends the run** has run.

Some tools are terminal by nature: a hand-over to a human agent, an escalation, a placed order. After them the assistant
has nothing more to do, and a further tool call would be a mistake. Declare it on the tool with `endsRun` (D86):

```ts
import {z} from "zod";
import {defineTool} from "dyna-ai-gateway";

export const handoverToAgentTool = defineTool({
  name: "handover_to_agent",
  description: "Hands the conversation over to a human support agent. Call it when the customer asks for a human.",
  inputSchema: z.object({reason: z.string()}),
  tags: ["support"],
  endsRun: true,
  execute: async ({input: {reason}}): Promise<{ticketId: string; reason: string}> => ({
    ticketId: "T-1",
    reason,
  }),
});
```

- `endsRun: true` ends the run after every successful call. A predicate decides per call on the parsed input and the
  tool's output: `endsRun: ({output}) => output.status === "accepted"`. Write it after `execute` in the tool literal: the
  type of `output` comes from the return type of `execute`, and a predicate written before it sees `unknown`.
- The decision is taken **after the tool returned**: a call that failed, timed out, was refused or was rejected by the
  human never ends the run.
- The run ends **after the step**: when the model asked for several tools together, the others still run. When one of
  them waits for approval, the run pauses first and ends after the resume; the terminal tool does not run again.
- A predicate that throws counts as "does not end the run": the call still succeeded, and its result says so.
- The model then gets **one last step without tools** to phrase the closing sentence. That step counts, is checked with the
  usage adapter and reported to it like any other.
- The call's `events` carry `RUN_ENDED_BY_TOOL` with the tool call before the closing text streams, and the answer
  carries `endedByTool` with the tool's name, so the UI can move the thread on (to the agent's queue, to the order page).

A terminal tool that must come after a lookup combines `endsRun` with `requires` (the guarded workflows of
`IToolPolicyConfig`).

## Can a tool be offered only in some steps of a run?

Yes, with `visibleWhen` on the tool (D89): a predicate on the step index and the tools executed so far in the run, decided
before every model call. Made for agents with many tools: a classifier offered on the first step turns the request into a
stated intent, and the model picks the next tools from that result instead of guessing from the prompt:

```ts
export const classifyIntentTool = defineTool({
  name: "classify_intent",
  description: "Classifies the customer's request. Call it first.",
  inputSchema: z.object({intent: z.enum(["order", "refund", "other"])}),
  tags: ["routing"],
  visibleWhen: ({stepIndex}) => stepIndex === 0,
  execute: async ({input: {intent}}) => ({intent}),
});
```

- `({executed}) => executed.includes("lookup_order")` is the same rule as `requires: {refund: ["lookup_order"]}`, declared
  on the tool instead of the config. A tool must pass both.
- A hidden tool is not in the model's tool list for that step; a call to it by name anyway is refused with a tool error
  that says so, and names the required tools when `requires` hid it.
- Visibility is not a forced call: the model may still answer without calling the tool. Say "call it first" in the tool's
  description and in the system prompt.

## Who may read a thread, a file or a paused run?

- **A thread** is its user's: `ask`, `run`, `getTurns`, `renameThread`, `getThreadMemory` and `resetThreadMemory` on another
  user's thread are a 404, like an unknown one, and `listThreads` lists the calling user's threads only.
- **A file** is its uploader's: a question can carry only the caller's own files, and `deleteFile` touches only the
  caller's file.
- **A paused run** can be resumed or cancelled by any user of the tenant, because the approver is often not the asker; your
  application decides who may approve or review. The run stays the asker's: its memory and trace go to the user who
  started it. `listPausedRuns` shows the calling user's own runs as summaries, without the draft of a reviewed answer;
  the reviewer reads the draft with `getPausedRun`, which takes raw ids like the other admin methods.

The full list of what the gateway checks and what it leaves to your application is in
[What the gateway checks and what it trusts](../architecture/Architecture%20and%20trade-offs.md#5-what-the-gateway-checks-and-what-it-trusts).

## How do I show the user's conversations and open one?

`listThreads` returns the calling user's threads, newest first, in pages; `getTurns` returns the whole history of one thread,
oldest first; `renameThread` sets the title the user typed. The paging is the one of the Vercel chat client: a `limit` of
1–200 and one cursor, which is a thread id ([D37](../architecture/Decisions.md#d37-lists-page-by-cursor)).

```ts
// The sidebar: the newest 20 threads
const first = await gateway.listThreads({
  userContext,
  page: {limit: 20, startingAfter: null, endingBefore: null},
});
// Scrolling down: the 20 threads older than the last one shown, while `hasMore` is true
const next = await gateway.listThreads({
  userContext,
  page: {limit: 20, startingAfter: null, endingBefore: first.items[first.items.length - 1].id},
});
// Opening a thread: every turn, oldest first
const turns = await gateway.getTurns({userContext, threadId: first.items[0].id});
```

`startingAfter` reads the other way: the threads newer than the one given. Both cursors at once, or a `limit` outside 1–200,
is a 400; a cursor that is not one of the user's threads is a 404. The list is ordered by creation, so a thread used again
keeps its place; a title the working memory wrote is replaced by `renameThread`.

## How do I delete conversations?

`delete` removes threads with everything they left in the stores: turns, working memory, files, runs and trace entries ([D119](../architecture/Decisions.md#d119-threads-are-deleted-in-bulk-with-everything-they-left)). It takes raw ids and checks no user, so the host passes the `userId` of the user whose request it serves:

```ts
// The user's "delete selected": only that user's threads among the ids go
const {threads} = await gateway.delete({tenantId, threadIds: selectedIds, userId});
// Everything of one user, the user kept (facts and files of other threads stay)
await gateway.delete({tenantId, threadIds: "all", userId});
// A tenant's reset, or a retention job that lists the old thread ids first
await gateway.delete({tenantId, threadIds: "all"});
```

- Hard delete: a deleted thread is a 404 on `ask`, `run` and `getTurns`, and a second call with the same ids returns 0.
- A thread with a call in flight is skipped and not counted; call again once the call ended. An unknown id, or one of another tenant or user, is ignored.
- The memory updates still running for those threads are awaited first, so nothing is written back after the delete. The user's remembered facts stay: "forget this user" is `deleteUserData` or `anonymizeUserData`.

## How do I protect against prompt injection?

In layers — no single check stops it:

1. **Limit what an injected prompt can do** (the real defence): allow only the tools a profile needs (`allowedTools`),
   require approval for tools with side effects (the tool's `policy`, the profile's `approvals`, `HumanGate`), cap the loop (`maxStepsPerRun`).
2. **The built-in input rule `prompt_injection`**: a cheap regex filter for the classic phrases. Easy to get around.
3. **Your own `inputRules`**: a classifier or a moderation endpoint on the prompt (see above).
4. **What does not come from the prompt**, the application checks where it enters: uploaded files at `uploadFile`, tool
   results inside the tool's own code. Knowledge-base documents are the tenant's own, curated content.
5. **The labels**: knowledge-base excerpts, memory and the call's `context` reach the model marked as "not instructions"
   (the layers: `docs/architecture/System prompt production layers.md`).
6. **`outputRules`** as the last net (e.g. "the answer must not reveal the system prompt").

## Can I cancel a call, or limit how long it takes?

Yes, with two optional fields of the call ([decision](../architecture/Decisions.md#d90-a-call-can-be-stopped-abortsignal-and-timeoutms)):

```ts
const controller = new AbortController();
stopButton.onclick = () => controller.abort();

const response = await gateway.run({
  userContext,
  threadId,
  prompt,
  kbFilters,
  abortSignal: controller.signal, // the "stop" button, or the signal of the incoming HTTP request
  timeoutMs: 60_000,              // a deadline for the whole call, tools included
}).response;

if (response.kind === EGatewayResponseKind.FAILED) {
  const timedOut = response.issues.some(issue => issue.code === CALL_TIMED_OUT_ISSUE_CODE);
  const aborted = response.issues.some(issue => issue.code === CALL_ABORTED_ISSUE_CODE);
}
```

`resume()` takes the same two fields.

**What happens**

- The model call in flight, the agent loop, the tool that is running and the guardrail rules are all stopped through one signal.
- The call returns `FAILED` with the reason ("The call was aborted" / "The call timed out after 60000 ms") and one `ERROR` issue, `call_aborted` or `call_timed_out`. Nothing is thrown.
- What the call stored before the stop stays: the user's turn and, in a `run`, the steps that completed (the tools did run, so their calls and results stay in the thread; a tool call the stop cut gets an error result). No answer is stored; an answer that was already streamed when the stop landed in the output check is withdrawn with `ANSWER_WITHDRAWN`; a stop during the model call itself leaves the deltas so far on the stream with no further event, and a tool call the stream announced (`TOOL_REQUEST`) and the stop cut gets no `TOOL_RESULT` event. A `run` that was aborted never pauses. An aborted `resume` closes the run as `FAILED` and opens the thread again, unless the stop came before the run left `PAUSED` (while a free-text answer was screened, or with a signal already aborted): the run then stays paused for another decision.
- A call made with a signal that is already aborted is answered `FAILED` before anything is stored and before the thread is taken.

**Good to know**

- A tool is stopped cooperatively: it receives the abort on its `abortSignal` and the gateway stops waiting for it. Pass that signal to every HTTP call the tool makes; a tool that ignores it runs to its end, and an abort does not undo what the tool already did.
- `timeoutMs` caps the whole call, with two waits that do not take the signal yet and can overrun it: the knowledge-base search (query rewrite, embedding) and a tool's policy predicate. The per-tool timeout (`IToolDef.timeoutMs`, `IToolRegistryConfig.toolTimeoutMs`) and the per-model-call timeout (`ILLMClientConfig.timeoutMs`) still cap one tool or one model call each. `timeoutMs` is a positive integer of milliseconds, at most 2 147 483 647 (about 24 days); anything else is a 400.
- There is no default deadline; without `timeoutMs` a call runs until it answers. The thread's lease (`IThreadStoreConfig.leaseMs`) only decides when another call may take the thread, it does not stop the running one.
- The text an aborted model call had streamed so far is not returned; the usage adapter is told the call used zero tokens, the provider bills its own count.
- Your own `AbortSignal.timeout(ms)` passed as `abortSignal` is read as a timeout too: "The call timed out" and `call_timed_out`, without the number (the gateway did not set it).

## How do I stop the server cleanly?

Call `shutdown({timeoutMs})` from the signal handler, before the HTTP server and the database connections close ([decision](../architecture/Decisions.md#d96-graceful-shutdown)):

```ts
process.on("SIGTERM", async () => {
  await gateway.shutdown({timeoutMs: 20_000});
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await db.disconnect();
  process.exit(0);
});
```

- From the first call on, every new `ask`, `run` and `resume` rejects with a 503: answer it as such, the client may retry on another instance.
- The calls in flight get `timeoutMs` to answer. The ones still running after it are aborted like a call whose `abortSignal` fired: the response is `FAILED` with the issue `call_aborted` and the reason "The call was aborted: the gateway is shutting down"; the run is closed, the thread is open again, the turns stored so far stay.
- Then the background work lands, as after `whenIdle()`. A paused run is stored and untouched: it resumes on the next instance.
- The promise resolves once all of that is done; a second call returns the same promise. `timeoutMs` takes the values of a call's `timeoutMs`; anything else is a 400, thrown before anything stopped.
- A gateway that was shut down takes no call again: construct a new one. A crash skips all of this: see the next question.

## What happens to the runs a crashed server left behind?

A server that dies inside a call leaves its run marked running and, after a `resume`, its thread waiting for a human: no call on that thread is accepted any more. Schedule `recoverStuckRuns({tenantId})` next to `expirePausedRuns` ([decision](../architecture/Decisions.md#d97-stuck-runs-are-recovered-by-a-job)):

```ts
setInterval(async () => {
  for (const tenantId of tenantIds) {
    await gateway.expirePausedRuns({tenantId});
    await gateway.recoverStuckRuns({tenantId});
  }
}, 60_000);
```

- The job touches a run only when it can take the thread's lease, which every live call holds. A run it recovers is `FAILED`, its cut tool call is answered in the thread with the error "The call was cut off: the server stopped before it finished", and the thread takes calls again.
- A busy thread, and a thread the job cannot close, are skipped and found again next time. The job returns how many runs it recovered.
- Keep every call's `timeoutMs` at or under `IThreadStoreConfig.leaseMs`: a call that outlives its lease looks stuck to the job.

## How do I connect a Vercel chat client (`useChat`)?

Through the module `dyna-ai-gateway/vercel-ui`: one `AIGatewayVercelUi` per chat use case, built on your gateway instance,
and three methods the endpoints call, `chat`, `history` and `resume`. The request body never names the tenant or the user; your
`userContext` hook does. The whole recipe is in [Vercel chat client](Vercel%20chat%20client.md); the decisions behind it in
[Decisions, chapter 17](../architecture/Decisions.md#17-aigatewayvercelui).

