# Human in the loop

A `run()` can stop for a person and continue later, from another request, often by another user. Three things stop it: a
tool call that waits for an approval, a question the model asks the user, and a final answer that waits for a reviewer.
The run is stored while it waits, so the decision can come minutes or hours later, after a restart of the server.
`resume()` takes the decision and continues the run from where it stopped.

## 1. About

| Pause kind (`EPauseKind`) | What waits                                                         | Who causes it                                                      | Decisions                   |
|---------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------|-----------------------------|
| `TOOL_APPROVAL`           | a tool call, before it runs                                        | the tool's `policy` or the profile's `approvals`                   | `APPROVE`, `EDIT`, `REJECT` |
| `USER_QUESTION`           | the model's questions to the user                                  | the model, through the built-in tool `dyna_aigw_ask_user_question` | `ANSWER`                    |
| `RESULT_REVIEW`           | the final answer, after the output checks, before the user sees it | the profile's `reviewAnswers: true`                                | `APPROVE`, `EDIT`, `REJECT` |

Only `run()` pauses. An `ask()` offers no tools, so it never waits for an approval or a question. On a profile with
`reviewAnswers` an `ask()` is a 400. How tools are defined and offered is on [Tools](030-tools.md).

`resume()` answers a pause, and nothing else. A follow-up message of the user is a new `ask()` or `run()` on the same
thread ([Resume is only for a paused run](../60-architecture/90-decisions.md#resume-is-only-for-a-paused-run)).

The human gate has two settings, in `humanGate` of the gateway's config:

| Key                     | What it does                                                       | Default              |
|-------------------------|--------------------------------------------------------------------|----------------------|
| `timeoutMs`             | how long a pause waits before `expirePausedRuns` cancels it        | `86_400_000` (a day) |
| `userQuestions.enabled` | offers `dyna_aigw_ask_user_question` to the model in every `run()` | required             |

The paused runs live in `runStore.repository`, an `IRunRepository` (chapter 2.9).

## 2. Logic

### 2.1 Who decides an approval

Two layers decide whether a tool call waits for a human: one rule on the tool, one floor on the profile.

| Layer   | Where                  | Says                                                                                                                                                                              |
|---------|------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Tool    | `IToolDef.policy`      | `NEEDS_APPROVAL`: every call waits for a human. `DENY`: the tool is switched off. A predicate `({input, userContext})`: a verdict per call on the parsed input. Omitted: `ALLOW`. |
| Profile | `IAIProfile.approvals` | in this tenant these tools wait for a human, whatever the tool says. It turns an `ALLOW` into `NEEDS_APPROVAL`. It does not apply to the built-in tools.                          |

The gateway decides each call in this order:

1. The input is parsed with the tool's `inputSchema`. An input the schema rejects never reaches the policy: the tool
   reports the 400 to the model, and the call neither pauses nor counts as denied.
2. The tool's `policy` gives a verdict (`EToolCallVerdict`).
3. The profile's `approvals` are the floor: an `ALLOW` of a listed tool becomes `NEEDS_APPROVAL`.
4. `DENY` wins over the floor. A human is never asked to approve a call that would be refused.

Nothing removes a pause the tool or the profile demands. The three verdicts mirror the `needsApproval` field of the Vercel
AI SDK, with `DENY` added. A predicate's `NEEDS_APPROVAL` result may carry a `rejectionText` (what the model reads if the
human rejects) and a `reasonCode` (why the call waits, for the card; the model never sees it). The full policy, with an
example, is in the [FAQ](../10-getting-started/90-faq.md#how-do-i-control-whether-a-tool-call-runs) and in
[D87](../60-architecture/90-decisions.md#d87-d67-d50-one-policy-on-the-tool-allow-deny-needs-approval).

### 2.2 The model asks the user

With `humanGate.userQuestions.enabled`, every `run()` offers the built-in tool `dyna_aigw_ask_user_question`
(`BUILT_IN_TOOL_NAMES.ASK_USER_QUESTION`). The profile's `allowedTools` does not select it. The model puts every open
question into one call, an `IUserQuestions`: a `title`, an optional `description` and the `questions`. Each question has a
`mode` (`EUserQuestionMode`):

| `mode`      | The user                     | The answer (`IUserAnswer`)     |
|-------------|------------------------------|--------------------------------|
| `RADIO`     | picks one of `options`       | one entry in `selected`        |
| `CHECK`     | picks several of `options`   | the entries in `selected`      |
| `FREE_TEXT` | types the answer, no options | `freeText`, and `selected: []` |

`freeOption: true` on a `RADIO` or `CHECK` question lets the user type an own answer next to the options. The call never
executes: its policy is `NEEDS_APPROVAL`, so the run pauses with a `USER_QUESTION` envelope. The answers become the
tool's result, and the thread stores the question and the answers as a tool call and its result.

### 2.3 The review of the answer

On a profile with `reviewAnswers: true`, a `run()` pauses after its answer passed the output checks, with one
`RESULT_REVIEW` envelope. The draft is the reviewer's: it is not streamed, and the asker's `PAUSED` response carries the
card without its `result`. The reviewer reads it with `getPausedRun`. The decision calls no model. The details are in the
[FAQ](../10-getting-started/90-faq.md#how-do-i-have-a-human-review-the-answer-before-the-user-sees-it).

### 2.4 The PAUSED response

A paused `run()` or `resume()` settles `response` as an `IPausedResponse`:

| Field       | What it is                                                                            |
|-------------|---------------------------------------------------------------------------------------|
| `kind`      | `EGatewayResponseKind.PAUSED`                                                         |
| `threadId`  | the run's thread; it refuses new calls until the run is resumed, cancelled or expired |
| `pauseId`   | names this pause; `resume()` requires it                                              |
| `envelopes` | the cards, never empty (`TPauseEnvelopes`)                                            |

Every envelope (`TPauseEnvelope`) has `kind`, `runId`, `pauseId`, `allowed` (the decisions the card may offer) and
`expiresAt`. The rest depends on `kind`:

| Envelope                | `kind`          | Carries                                                                     |
|-------------------------|-----------------|-----------------------------------------------------------------------------|
| `IToolApprovalEnvelope` | `TOOL_APPROVAL` | `callId`, `toolCall` (`toolName`, `input`), `rejectionText?`, `reasonCode?` |
| `IUserQuestionEnvelope` | `USER_QUESTION` | `callId`, `userQuestions`                                                   |
| `IResultReviewEnvelope` | `RESULT_REVIEW` | `result?` (`IReviewedAnswer`), only on the stored run                       |

An envelope holds data, no text. The application renders the card, in its own language, from `toolCall.toolName` and
`input` ([D51, D52](../60-architecture/90-decisions.md#d51-d52-the-pause-envelope-is-a-discriminated-union-without-text)).

A step can hold several calls back at once: two approvals, or an approval and a question. The pause then carries one
envelope per waiting call, in the order the model asked, all with the same `expiresAt`. A `RESULT_REVIEW` is always alone.
The `events` stream says `RUN_PAUSED` once, with the waiting calls in `toolCalls`.

### 2.5 The decisions

`resume()` takes `decisions`, one `IResumeDecision` per envelope. The `action` (`EResumeAction`) must be among the
envelope's `allowed`:

| Action    | `TOOL_APPROVAL`                                                         | `RESULT_REVIEW`                                              | `USER_QUESTION`                        |
|-----------|-------------------------------------------------------------------------|--------------------------------------------------------------|----------------------------------------|
| `APPROVE` | the tool runs with the model's input                                    | the answer is delivered as written                           | not allowed                            |
| `EDIT`    | the tool runs with `editedInput`; the policy decides again on it        | the reviewer's `editedInput`, a string, is delivered instead | not allowed                            |
| `REJECT`  | the tool does not run; the model reads the `rejectionText`, then `text` | the answer is dropped; the response is `FAILED` with `text`  | not allowed                            |
| `ANSWER`  | not allowed                                                             | not allowed                                                  | the `answers` become the tool's result |

- **`callId`.** Each decision names its envelope by the envelope's `callId`. A pause of one envelope takes one decision
  without it. A `RESULT_REVIEW` has no `callId`.
- **All or nothing.** A card without a decision, a decision for no card, two decisions for one card, or an action the
  card does not allow is a 400, and the run stays paused with every card
  ([D102](../60-architecture/90-decisions.md#d102-one-pause-carries-every-pending-call-of-the-step)).
- **`EDIT` of a tool call.** The tool's policy decides again on the edited input. `DENY` refuses it, and the model reads
  the refusal. `NEEDS_APPROVAL` runs it: the human just approved that input
  ([D109](../60-architecture/90-decisions.md#d109-an-edited-tool-input-goes-through-the-policy-again)).
- **`REJECT` of a tool call.** Without a `rejectionText` from the policy, the model reads `DEFAULT_TOOL_REJECTION_TEXT`.
  The run goes on, and the model answers without the tool.
- **`ANSWER`.** The answers must fit the card: one per question, in order, `selected` only the question's options,
  `freeText` only where the question takes typed text. A misfit is a 400. The model reads the card's own question text
  ([D117](../60-architecture/90-decisions.md#d117-an-answer-must-fit-its-card)). The typed text of every answer runs
  through the input rules once, together; a blocked text returns `FAILED` and the run stays paused
  ([D71](../60-architecture/90-decisions.md#d71-a-users-free-text-answer-is-screened-like-a-prompt)).

### 2.6 Resume

`resume({userContext, runId, pauseId, decisions, profileId?, additionalTools?, outputSchema?, debug?, abortSignal?, timeoutMs?})`
returns an `IGatewayCall`, like `run()`: `events` and `response`. The gateway checks the decisions before anything runs:

| The run                                     | Status |
|---------------------------------------------|--------|
| does not exist in the tenant                | 404    |
| is not paused, or already left the pause    | 409    |
| waits on another pause than `pauseId`       | 409    |
| has a pause past its `expiresAt`            | 410    |
| gets decisions that do not answer the pause | 400    |

Leaving the pause is one atomic step in the repository. Of two resumes at once (a double click, two tabs), one wins and
the other gets the 409, so a side-effect tool runs once
([D69, D78](../60-architecture/90-decisions.md#d69-d78-leaving-a-pause-is-one-atomic-step)).

The run continues with what it started with:

- **The tools.** The run keeps the names of its tools, not their code. Pass the same `additionalTools` again; a run tool
  that is in neither the registry nor `additionalTools` is a 400.
- **The schema.** A stored run keeps no `outputSchema`, since a zod schema is code. Pass it again, or the resumed answer
  is plain text ([D36](../60-architecture/90-decisions.md#d36-a-stored-run-carries-what-a-resumed-run-needs)).
- **The skills.** The skills the call brought travel with the run ([Skills](020-skills.md#26-a-paused-run)).
- **The user.** The tools run with the `userContext` of the user who resumes. The run stays the asker's: its memory and
  its trace go to the user who started it.

A resumed run answers like one that never paused: it cites the knowledge-base chunks of its first step.

### 2.7 A resume may pause again

The decision continues the loop, and the loop can stop again: a later step asks for a tool that needs an approval, the
model asks the user another question, or the answer waits for a review. The `response` of `resume()` is then `PAUSED`
again, with the same `runId` and a new `pauseId`. A decision sent for the earlier pause (a retry, a second click) is a
409, so it never decides the next one
([D110](../60-architecture/90-decisions.md#d110-a-decision-names-the-pause-it-is-for)). Handle the `response` of
`resume()` as you handle the one of `run()`.

On a profile with `parallelToolCalls: false` the calls of a step are decided one by one, so two approvals in one step
pause the run twice, one card each.

### 2.8 Expiry and cancel

| Way out                           | Who calls it                       | What happens                                                                               |
|-----------------------------------|------------------------------------|--------------------------------------------------------------------------------------------|
| `cancelRun({userContext, runId})` | the user dismisses the card        | the run is `CANCELLED`, every waiting call is closed as rejected, the thread is open again |
| `expirePausedRuns({tenantId})`    | a scheduled job of the application | the same for every pause past its `expiresAt`; returns how many runs it closed             |

A closed tool call gets its own `rejectionText`, so the model reads why it did not run on the next call of the thread. A
cancelled or expired review drops the answer. A pause past `expiresAt` refuses `resume()` with a 410 even before the job
runs; the job is what opens the thread again
([D75, D80](../60-architecture/90-decisions.md#d75-d80-pauses-expire)).

`cancelRun` on a run that is not paused is a 409. Like `resume()`, it is open to every user of the tenant: the approver is
often not the asker, and your application decides who may approve
([Who may read a paused run](../10-getting-started/90-faq.md#who-may-read-a-thread-a-file-or-a-paused-run)).

### 2.9 Resume on another profile

`resume({profileId})` continues the run on another profile: its model, its output cap, its tools and its limits. The
system prompt and the messages so far stay. The review and the approvals are those of both profiles, so a switch adds
guards and never removes them. A waiting tool the new profile does not allow is a 400, and the run stays paused. See
[Resume on another profile](../60-architecture/50-live-adjustment-and-dependency-injection.md#32-resume-on-another-profile)
and [D113](../60-architecture/90-decisions.md#d113-a-profile-switch-on-resume-keeps-the-review-and-the-approvals).

A profile that a paused run started on cannot be removed: `removeProfile` is a 409 that names the runs
([decision](../60-architecture/90-decisions.md#a-profile-a-paused-run-waits-on-cannot-be-removed)).

### 2.10 Listing paused runs

| Method                            | Returns                                                       | For                                       |
|-----------------------------------|---------------------------------------------------------------|-------------------------------------------|
| `listPausedRuns({userContext})`   | an `IPausedRunSummary` per paused run of the calling user     | the asker's inbox: "waiting", "in review" |
| `getPausedRun({tenantId, runId})` | the whole stored run (`IRun`), the draft of a review included | the reviewer's or approver's screen       |

A summary has `runId`, `threadId`, `profileId`, `pauseId`, `envelopes`, `createdAt` and `expiresAt`. It holds no system
prompt, no messages and no draft. `getPausedRun` takes raw ids and checks no user: it is an admin surface, like `trace`
([D111](../60-architecture/90-decisions.md#d111-the-draft-of-a-review-is-the-reviewers)).

### 2.11 Storage and restarts

Only a run that pauses is stored. The `RunStore` keeps it in `runStore.repository`, an `IRunRepository`: the request as
built for the first step, the messages so far, the tool names, the call's skills and the waiting envelopes (`IRun`).
Everything a resume needs is in the record, so any instance of your server can resume a run another instance paused.

`InMemoryRunRepository` keeps the runs in the process: nothing survives a restart and nothing is shared between
instances. In production, implement `IRunRepository` over your database
([D28, D29](../60-architecture/90-decisions.md#d28-d29-every-store-has-a-seam-and-the-names-of-its-tables-are-configuration)):

| Method            | Contract                                                                                                                           |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------|
| `save`            | creates or replaces the whole run, by `id` within the tenant                                                                       |
| `load`            | the run, or `null` when it is missing or of another tenant                                                                         |
| `listByStatus`    | the tenant's runs in one `ERunStatus`, one user's when `userId` is given                                                           |
| `transition`      | moves a run from `from` to `to` atomically; `null` when it is missing or not in `from`; clears `pending` when `to` is not `PAUSED` |
| `delete`          | hard-deletes the runs of the listed threads, or of all of them for `"all"`                                                         |
| `anonymizeByUser` | replaces the user with a pseudonym and empties what the user said; an open run becomes `CANCELLED`                                 |

`transition` is one conditional update, never a load followed by a save: the condition on the status in the filter is
what lets exactly one of two racing resumes through.

A server that dies inside a call leaves its run `RUNNING`. `recoverStuckRuns({tenantId})`, scheduled next to
`expirePausedRuns`, fails such runs and opens their threads
([FAQ](../10-getting-started/90-faq.md#what-happens-to-the-runs-a-crashed-server-left-behind)).

## 3. Examples

The `config` and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md). The installation config already sets
`humanGate: {userQuestions: {enabled: true}}`. `getInvoice` and `postCreditNote` are the tools of
[Example: run](../10-getting-started/40-example-run.md) and [Example: a human in the loop](../10-getting-started/45-example-HITL.md).

### 3.1 A tenant that approves every credit note

The tool posts small amounts at once. This tenant wants a human on every call, so its profile lists the tool in
`approvals`.

```ts
import {AIGateway, IAIProfile} from "dyna-ai-gateway";

const strictAccounting: IAIProfile = {
  id: "accounting-strict",
  tenantId: "acme",
  name: "Accounting assistant, every credit note approved",
  modelId: "gpt-5-mini",
  promptAddendum: "You assist the accounting team of a Norwegian company. Amounts are in NOK.",
  allowedTools: ["get_invoice", "post_credit_note"],
  approvals: ["post_credit_note"], // the floor: the policy's ALLOW for small amounts becomes NEEDS_APPROVAL
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
};

const gateway = new AIGateway({...config, toolRegistry: {tools: [getInvoice, postCreditNote]}});
await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: strictAccounting});
```

A policy that returns `DENY` still refuses the call on this profile: the floor never turns a `DENY` into an approval.

### 3.2 Render the cards and resume

One handler for every kind of card. The decisions come from your UI; here they are fixed.

```ts
import {
  EGatewayResponseKind,
  EPauseKind,
  EResumeAction,
  IResumeDecision,
  TGatewayResponse,
} from "dyna-ai-gateway";

const call = gateway.run({
  userContext,
  profileId: "accounting-strict",
  prompt: "Credit 300 NOK on invoice 2024-1187, the customer was charged twice for shipping.",
  kbFilters: {libraryIds: [], bookIds: []},
});
const paused: TGatewayResponse = await call.response;

if (paused.kind === EGatewayResponseKind.PAUSED) {
  const decisions: IResumeDecision[] = paused.envelopes.map((envelope): IResumeDecision => {
    switch (envelope.kind) {
      case EPauseKind.TOOL_APPROVAL:
        // envelope.toolCall.toolName === "post_credit_note", envelope.toolCall.input: the amount and the reason
        return {callId: envelope.callId, action: EResumeAction.APPROVE};
      case EPauseKind.USER_QUESTION:
        return {callId: envelope.callId, action: EResumeAction.ANSWER, answers: answersFor(envelope.userQuestions)};
      case EPauseKind.RESULT_REVIEW:
        return {action: EResumeAction.APPROVE}; // always the only card, no callId
    }
  });

  const resumed = await gateway.resume({
    userContext: approverContext, // the approver: the tools run with this context, the run stays the asker's
    runId: paused.envelopes[0].runId,
    pauseId: paused.pauseId,
    decisions,
  }).response;
}
```

`approverContext` is the `IUserContext` of the approver. `answersFor` is the form of chapter 3.4.

### 3.3 Edit or reject a tool call

```ts
// The approver lowers the amount: the policy decides again on the edited input, then the tool runs with it
await gateway.resume({
  userContext: approverContext,
  runId,
  pauseId,
  decisions: [{action: EResumeAction.EDIT, editedInput: {invoiceNo: "2024-1187", amount: 150, reason: "Double shipping fee"}}],
}).response;

// Or refuses it: the tool does not run, the model reads the policy's rejectionText (or the default), then this text
await gateway.resume({
  userContext: approverContext,
  runId,
  pauseId,
  decisions: [{action: EResumeAction.REJECT, text: "Shipping was charged once; check the bank statement."}],
}).response;
```

`runId` and `pauseId` are those of the `PAUSED` response. A single card takes its decision without `callId`.

### 3.4 Answer the model's question

The model could not tell which invoice the user meant, and asked with `dyna_aigw_ask_user_question`.

```ts
import {
  EGatewayResponseKind,
  EPauseKind,
  EResumeAction,
  EUserQuestionMode,
  IUserAnswer,
  IUserQuestions,
} from "dyna-ai-gateway";

// One answer per question, in order, each in the question's mode. Your form collects them; here the first option is picked.
const answersFor = (form: IUserQuestions): IUserAnswer[] => form.questions.map((question): IUserAnswer => (
  question.mode === EUserQuestionMode.FREE_TEXT
    ? {question: question.text, selected: [], freeText: "The one from March"}
    : {question: question.text, selected: question.options?.slice(0, 1) ?? []}
));

if (paused.kind === EGatewayResponseKind.PAUSED) {
  const [card] = paused.envelopes;
  if (card.kind === EPauseKind.USER_QUESTION) {
    // card.userQuestions: {title: "Which invoice?", questions: [{text: "Pick the invoice", mode: RADIO, options: ["4521", "4522"], freeOption: true}]}
    const resumed = await gateway.resume({
      userContext, // the asker answers their own question
      runId: card.runId,
      pauseId: card.pauseId,
      decisions: [{action: EResumeAction.ANSWER, answers: answersFor(card.userQuestions)}],
    }).response;
  }
}
```

`freeText` on a `RADIO` or `CHECK` question is a 400 unless the question has `freeOption: true`.

### 3.5 Follow the run until it settles

A resume can pause again. The loop below asks the UI for each new pause; `decide` is your code.

```ts
import {EGatewayResponseKind, IPausedResponse, IResumeDecision, TGatewayResponse} from "dyna-ai-gateway";

const settle = async (
  first: TGatewayResponse,
  decide: (pause: IPausedResponse) => Promise<IResumeDecision[]>,
): Promise<TGatewayResponse> => {
  let response = first;
  while (response.kind === EGatewayResponseKind.PAUSED) {
    response = await gateway.resume({
      userContext,
      runId: response.envelopes[0].runId,
      pauseId: response.pauseId, // a new one on every pause of the same run
      decisions: await decide(response),
    }).response;
  }
  return response; // ANSWER or FAILED
};
```

In a web application the pause and the decision are two requests. Store nothing yourself: `listPausedRuns` gives the
`runId`, the `pauseId` and the cards back.

### 3.6 The approval inbox and the dismiss button

```ts
const inbox = await gateway.listPausedRuns({userContext});
for (const summary of inbox) {
  // summary.runId, summary.pauseId, summary.envelopes, summary.expiresAt: render one row per run
}

// The user gives up on a run: the waiting calls are closed as rejected, the thread takes calls again
const [oldest] = inbox;
if (oldest) await gateway.cancelRun({userContext, runId: oldest.runId});
```

### 3.7 Expire the pauses nobody answered

```ts
import {AIGateway} from "dyna-ai-gateway";

const gateway = new AIGateway({
  ...config,
  humanGate: {timeoutMs: 15 * 60_000, userQuestions: {enabled: true}}, // a live chat: fifteen minutes
});

setInterval(async () => {
  for (const tenantId of tenantIds) {
    await gateway.expirePausedRuns({tenantId}); // returns how many runs it closed
    await gateway.recoverStuckRuns({tenantId});
  }
}, 60_000);
```

### 3.8 Approve on another profile

The approver works on a stronger model. The run continues on the approver's profile; the approvals and the review of both
profiles still apply.

```ts
await gateway.resume({
  userContext: approverContext,
  runId,
  pauseId,
  decisions: [{action: EResumeAction.APPROVE}],
  profileId: "accounting-senior", // must allow post_credit_note, or the resume is a 400 and the run stays paused
}).response;
```

### 3.9 A run repository over a database

`transition` is the method that matters. In SQL it is one statement with the status in the condition:

```sql
UPDATE ai_runs
SET status = $to, updated_at = now(), pending = CASE WHEN $to = 'PAUSED' THEN pending ELSE NULL END
WHERE tenant_id = $tenantId AND id = $runId AND status = $from
RETURNING *;
-- no row returned: transition() returns null, and the gateway refuses the second caller with a 409
```

The repository goes into the config like the in-memory one:

```ts
const gateway = new AIGateway({...config, runStore: {repository: new MyRunRepository(db)}}); // your IRunRepository
```

## 4. Pitfalls

- **`resume()` for a follow-up message.** It answers a pause only. A new message is a new `ask()` or `run()` on the
  thread. A call on a thread whose run is paused is a 409: resume or cancel the run first.
- **Dropping the `pauseId`.** `resume()` requires the `pauseId` of the response the UI rendered. A cached or hard-coded
  one is a 409 as soon as the run paused again.
- **Answering only some cards.** A pause with two cards takes two decisions in one call. One decision is a 400, and the
  run stays paused with both.
- **Forgetting `additionalTools` or `outputSchema` on resume.** The stored run keeps neither. A missing tool is a 400; a
  missing schema turns a structured run into plain text.
- **Treating the approval as a permission check.** The gateway does not know who may approve. `resume()` and `cancelRun`
  are open to every user of the tenant; check the approver's role in your endpoint before you call them.
- **Handing `getPausedRun` to the asker.** It holds the draft of a review, the system prompt and every tool output.
- **A pause without an expiry job.** A paused run blocks its thread. Without `expirePausedRuns` on a schedule an
  unanswered pause blocks it for good.
- **`InMemoryRunRepository` in production.** A restart loses every paused run, and a second instance cannot see the
  first one's runs.
- **A `transition` written as load-then-save.** Two approvals at once both pass, and the side-effect tool runs twice.
- **Wording the card from `rejectionText`.** It is for the model. The card renders from `toolCall` and `reasonCode`.
- **Expecting a question in `ask()`.** `ask()` has no tools, so the model cannot ask the user there.
- **Rendering every `USER_QUESTION` blindly.** An input of `dyna_aigw_ask_user_question` that its schema rejects pauses
  as a `TOOL_APPROVAL` with the raw call, so the human sees what the model asked for. Render the approval card for it.
- **Switching profile to skip a guard.** A switch on `resume()` keeps the approvals and the review of the profile the run
  started on. To drop one, change that profile.

## 5. Summary

- A `run()` pauses for a tool approval, a question to the user, or a review of the answer. `ask()` never pauses.
- A tool call waits when its `policy` says `NEEDS_APPROVAL` or the profile lists it in `approvals`. `DENY` wins.
- A pause is a `PAUSED` response with a `pauseId` and `envelopes`. `resume()` takes one decision per envelope:
  `APPROVE`, `EDIT`, `REJECT` or `ANSWER`, as the envelope allows.
- A resume may pause again under the same `runId`, with a new `pauseId`. `cancelRun` and `expirePausedRuns` close a pause
  without a decision.
- A paused run is stored in an `IRunRepository`. With a database adapter it survives a restart and any instance resumes
  it.

## 6. FAQ

**Does a paused run hold a server process or a connection?**
No. The run is a record in the repository. The process that paused it can stop; any instance resumes it from the record.

**Can the asker and the approver be different users?**
Yes. Any user of the tenant can resume. The tools run with the approver's `userContext`; the memory and the trace stay
the asker's.

**How do I show why a call waits?**
Return a `reasonCode` from the tool's predicate with `NEEDS_APPROVAL`. The envelope carries it as `reasonCode`; your card
translates it. The model never sees it.

**What does the model read after a cancel or an expiry?**
The closed tool call gets its `rejectionText`, or `DEFAULT_TOOL_REJECTION_TEXT`. The next call on the thread reads it as
history.

**Can the user keep chatting while a run waits for an approval?**
Not on that thread. A call on it is a 409 until the run is resumed, cancelled or expired. A new thread works.

**Does the model see the user's answer as a message?**
It sees it as the result of its `dyna_aigw_ask_user_question` call. Nothing is typed into the prompt.

**Several cards at once: how do I answer them?**
One decision per card, named by `callId`, in one `resume()`. See
[the FAQ entry](../10-getting-started/90-faq.md#the-run-paused-with-several-cards-how-do-i-answer-them).

**How long does a pause wait?**
`humanGate.timeoutMs`, a day by default. The pause expires at `expiresAt`; your scheduled `expirePausedRuns` closes it.

## 7. API reference

| Symbol                                                                                    | What it is                                                                                      |
|-------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| [`AIGateway`](../30-api/index/classes/AIGateway.md)                                       | `resume`, `cancelRun`, `listPausedRuns`, `getPausedRun`, `expirePausedRuns`, `recoverStuckRuns` |
| [`IHumanGateConfig`](../30-api/index/interfaces/IHumanGateConfig.md)                      | `timeoutMs`, `userQuestions.enabled`                                                            |
| [`EPauseKind`](../30-api/index/enumerations/EPauseKind.md)                                | `TOOL_APPROVAL`, `USER_QUESTION`, `RESULT_REVIEW`                                               |
| [`EResumeAction`](../30-api/index/enumerations/EResumeAction.md)                          | `APPROVE`, `EDIT`, `REJECT`, `ANSWER`                                                           |
| [`IResumeDecision`](../30-api/index/interfaces/IResumeDecision.md)                        | one decision: `action`, `callId`, `editedInput`, `text`, `answers`                              |
| [`IPausedResponse`](../30-api/index/interfaces/IPausedResponse.md)                        | the `PAUSED` response: `threadId`, `pauseId`, `envelopes`                                       |
| [`TPauseEnvelope`](../30-api/index/type-aliases/TPauseEnvelope.md)                        | the union of the three envelopes                                                                |
| [`TPauseEnvelopes`](../30-api/index/type-aliases/TPauseEnvelopes.md)                      | the non-empty list of a pause                                                                   |
| [`IToolApprovalEnvelope`](../30-api/index/interfaces/IToolApprovalEnvelope.md)            | a tool call that waits                                                                          |
| [`IUserQuestionEnvelope`](../30-api/index/interfaces/IUserQuestionEnvelope.md)            | the model's questions                                                                           |
| [`IResultReviewEnvelope`](../30-api/index/interfaces/IResultReviewEnvelope.md)            | the answer that waits for a review                                                              |
| [`IReviewedAnswer`](../30-api/index/interfaces/IReviewedAnswer.md)                        | the draft the reviewer reads                                                                    |
| [`IUserQuestions`](../30-api/index/interfaces/IUserQuestions.md)                          | the form: `title`, `description`, `questions`                                                   |
| [`IUserQuestion`](../30-api/index/interfaces/IUserQuestion.md)                            | one question: `text`, `mode`, `options`, `freeOption`                                           |
| [`EUserQuestionMode`](../30-api/index/enumerations/EUserQuestionMode.md)                  | `RADIO`, `CHECK`, `FREE_TEXT`                                                                   |
| [`IUserAnswer`](../30-api/index/interfaces/IUserAnswer.md)                                | one answer: `question`, `selected`, `freeText`                                                  |
| [`EToolCallVerdict`](../30-api/index/enumerations/EToolCallVerdict.md)                    | `ALLOW`, `DENY`, `NEEDS_APPROVAL`                                                               |
| [`TToolCallPolicyResult`](../30-api/index/type-aliases/TToolCallPolicyResult.md)          | a predicate's verdict, with `reason`, `rejectionText`, `reasonCode`                             |
| [`IToolDef`](../30-api/index/interfaces/IToolDef.md)                                      | `policy` of a tool                                                                              |
| [`IAIProfile`](../30-api/index/interfaces/IAIProfile.md)                                  | `approvals`, `reviewAnswers`, `parallelToolCalls`                                               |
| [`IPausedRunSummary`](../30-api/index/interfaces/IPausedRunSummary.md)                    | a row of `listPausedRuns`                                                                       |
| [`IRun`](../30-api/index/interfaces/IRun.md)                                              | the stored run                                                                                  |
| [`ERunStatus`](../30-api/index/enumerations/ERunStatus.md)                                | `RUNNING`, `PAUSED`, `DONE`, `FAILED`, `CANCELLED`                                              |
| [`IRunRepository`](../30-api/index/interfaces/IRunRepository.md)                          | the persistence seam to implement over your database                                            |
| [`IRunStoreConfig`](../30-api/index/interfaces/IRunStoreConfig.md)                        | `repository`                                                                                    |
| [`InMemoryRunRepository`](../30-api/index/classes/InMemoryRunRepository.md)               | the in-memory repository, for tests and development                                             |
| [`BUILT_IN_TOOL_NAMES`](../30-api/index/variables/BUILT_IN_TOOL_NAMES.md)                 | `ASK_USER_QUESTION`: `"dyna_aigw_ask_user_question"`                                            |
| [`DEFAULT_TOOL_REJECTION_TEXT`](../30-api/index/variables/DEFAULT_TOOL_REJECTION_TEXT.md) | what the model reads after a rejection without `rejectionText`                                  |
| [`IHumanGate`](../30-api/index/interfaces/IHumanGate.md)                                  | the contract to pass in `overrides` to replace the gate                                         |
