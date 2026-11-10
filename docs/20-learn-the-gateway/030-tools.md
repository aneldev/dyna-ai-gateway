# Tools

A tool is a function of your application that the model may ask for: look up an invoice, post a credit note, hand the case
to a human. The model only asks, with a name and a JSON input. The gateway checks the request, runs your `execute` and
hands the result back to the model, which reads it and goes on. Tools exist in `run()` only; `ask()` offers none.

## 1. About

A tool is data plus one function ([`IToolDef`](../30-api/index/interfaces/IToolDef.md)), written with
[`defineTool`](../30-api/index/functions/defineTool.md) so that `execute`, `policy` and `endsRun` get a typed `input`.

| Field            | Required | Who reads it       | What it does                                                                              |
|------------------|----------|--------------------|-------------------------------------------------------------------------------------------|
| `name`           | yes      | the model          | the name the model calls it by; unique, snake_case                                        |
| `description`    | yes      | the model          | when to call it and what it returns; the only manual the model has                        |
| `inputSchema`    | yes      | the model, gateway | a zod schema: sent to the model as the input's schema, then used to parse its input       |
| `tags`           | yes      | your code          | free labels (`"billing"`); the gateway does not read them                                 |
| `execute`        | yes      | gateway            | does the work, with the parsed input, the `userContext`, the `threadId`, an `abortSignal` |
| `policy`         | no       | gateway            | allow, deny or hold each call for a human, before it runs                                 |
| `endsRun`        | no       | gateway            | a successful call ends the run                                                            |
| `visibleWhen`    | no       | gateway            | in which steps of the run the tool is offered                                             |
| `timeoutMs`      | no       | gateway            | overrides `toolRegistry.toolTimeoutMs` for this tool                                      |
| `maxOutputChars` | no       | gateway            | overrides `toolRegistry.maxOutputChars` for this tool                                     |

The model receives `name`, `description` and `inputSchema`, nothing else. A tool's `policy`, tags and limits never reach it.

A tool comes from two places:

| Source       | Property                                                                         | Lifetime                      | Typical content                                                |
|--------------|----------------------------------------------------------------------------------|-------------------------------|----------------------------------------------------------------|
| The registry | [`IToolRegistryConfig.tools`](../30-api/index/interfaces/IToolRegistryConfig.md) | the gateway instance, fixed   | the actions of your domain (`get_invoice`, `refund`)           |
| The call     | `additionalTools` of [`run()`](../30-api/index/interfaces/IGatewayRunInput.md)   | this call, and its paused run | a tool bound to what the screen holds (the draft being edited) |

A registry tool reaches the model only when the profile lists it in `allowedTools`. A call tool needs no profile entry:
the application passed it, so it is allowed
([D66](../60-architecture/90-decisions.md#d66-tools-per-call)). Both go through the same pipeline: permissions, `policy`,
the profile's `approvals`, `requires`, the timeout and the output cap.

### 1.1 Tools, hooks, skills

| Concept | Who calls it                                  | What it is for                                                               |
|---------|-----------------------------------------------|------------------------------------------------------------------------------|
| Tool    | the model asks, the gateway runs it           | read or change data of the application                                       |
| Hook    | the agent loop, at a fixed point of each step | decide: which tools a step offers, whether a call runs, whether the run ends |
| Skill   | the model loads it through a built-in tool    | instructions on how to behave ([Skills](020-skills.md))                      |

The model never sees a hook. The hooks are the gateway's own
([`ILLMClientHooks`](../30-api/index/interfaces/ILLMClientHooks.md)); the application steers them through the fields of the
tool (`policy`, `visibleWhen`, `endsRun`) and through `toolPolicy` in the config.

## 2. Logic

### 2.1 The path of a tool call

1. **Resolve.** At the start of a `run()`, the `ToolPolicy` builds the run's tool set: the registry tools the profile's
   `allowedTools` lists, plus the call's `additionalTools`, minus what the user's permissions do not unlock
   (`toolPolicy.permissionsToTools`), cut to `activeTools` when the call names them. A model whose caps say `tools: false`
   gets none. The built-in tools are added whatever the profile and `activeTools` say (chapter 2.6).
2. **Offer.** Before every model call the set is narrowed for the step: a tool waits until the tools it `requires` have
   run, and a tool with `visibleWhen` shows only when its predicate says so. The model gets the names, descriptions and
   input schemas of what is left.
3. **The model asks.** The model answers with one or more tool calls, each a name and a JSON input. The stream emits
   `TOOL_REQUEST` for each.
4. **Gate.** The `policy` of the tool decides on the parsed input, then the profile's `approvals` act as the floor.
   `ALLOW` runs the call. `DENY` gives the model a refusal and the tool never runs. `NEEDS_APPROVAL` pauses the run for a
   human ([Human in the loop](040-human-in-the-loop.md)).
5. **Execute.** The gateway checks that the tool was offered in this step, parses the input with `inputSchema`, runs
   `execute` under the timeout and checks the size of the output. The stream emits `TOOL_RESULT`.
6. **Loop.** The result is stored in the thread as a tool result and sent to the model with the next step. The loop ends
   when the model answers without a tool call, when a tool that `endsRun` has run, when the profile's
   `limits.maxStepsPerRun` is reached, or when your usage adapter refuses a step
   ([How a run ends](../10-getting-started/90-faq.md#how-does-a-run-end-and-can-a-tool-end-it)).

The loop is the gateway's own, not the SDK's: a run must pause, be stored and continue later in another process
([The agent loop is the gateway's own](../60-architecture/90-decisions.md#the-agent-loop-is-the-gateways-own)). The
classes behind each step are drawn in [Architecture: Execution](../60-architecture/10-architecture-and-trade-offs.md#3-execution).

### 2.2 Input is validated, output is not

The input comes from the model, which can invent or drop fields. `inputSchema` parses it before `policy` and `execute`
see it. A mismatch never runs the tool: the model reads a 400 that names the field and asks it to fix the input, and it
can call again in the next step.

The output comes from your code. The gateway does not check its shape: it serialises it as JSON and the model reads it.
The model learns what a tool returns from the `description`, so say there what the result holds when it matters
([Input is validated, output is not](../60-architecture/90-decisions.md#input-is-validated-output-is-not)).

### 2.3 Narrow, never widen

The registry is fixed when the gateway is constructed; there is no `register()`
([D48](../60-architecture/90-decisions.md#d48-the-tools-are-fixed-at-construction-a-call-can-narrow-them-never-widen-them)).

| Layer                           | Narrows by                                            | Checked                                                          |
|---------------------------------|-------------------------------------------------------|------------------------------------------------------------------|
| `IAIProfile.allowedTools`       | the registry tools of this use case                   | at `upsertProfile`: every name must be registered                |
| `toolPolicy.permissionsToTools` | the tools a user needs a permission for               | at the start of the run                                          |
| `activeTools` of the call       | the tools of this one call; `[]` offers none of yours | at the start: a name outside the set is a 400, nothing is stored |
| `toolPolicy.requires`           | the tools that must have run first in this run        | before every step                                                |
| `IToolDef.visibleWhen`          | the steps the tool belongs to                         | before every step                                                |

A tool hidden for the step cannot run by name either. The model reads a 403 that says the tool is not available in this
step and, when `requires` hid it, which tools to call first
([D72, D79](../60-architecture/90-decisions.md#d72-d79-only-a-tool-the-model-was-offered-can-run),
[D88](../60-architecture/90-decisions.md#d88-a-refused-guarded-tool-names-what-must-run-first)).

### 2.4 When a tool fails

A failure never ends the run. It becomes the tool's result, stored with `failed: true`, and the model reads one line,
`code: <code>, status: <status>, userMessage: <userMessage>`, to recover.

| Failure                                             | Status              | What the model reads                                                   |
|-----------------------------------------------------|---------------------|------------------------------------------------------------------------|
| the input misses the schema                         | 400                 | the field and the schema's message; fix and call again                 |
| the tool was not offered in this step               | 403                 | not available; use another tool, or what to call first                 |
| no answer within the timeout                        | 504                 | it timed out; try a narrower request                                   |
| the output is larger than its cap                   | 413                 | the size and the limit; narrow the request                             |
| `execute` throws a `dynaError` with a `userMessage` | the error's         | your `userMessage`                                                     |
| `execute` throws anything else                      | 500, or the error's | a generic text: the input was not the cause, do not retry it unchanged |

What the model reads, how to write a `userMessage`, and the developer's channel `onToolError` are in the FAQ:
[What does the model read when my tool fails](../10-getting-started/90-faq.md#what-does-the-model-read-when-my-tool-fails-and-how-do-i-get-told).
A denied call is not a failure: the model reads `DEFAULT_TOOL_DENIAL_TEXT` and the policy's `reason`, and the part is
flagged `denied`.

### 2.5 Several calls in one step

When the model asks for several tools in one step, the gateway decides every call first and runs the allowed ones
concurrently. The results are stored in request order. The calls of a tool whose `policy` is a predicate run one by one,
after the others. A profile with `parallelToolCalls: false` runs every call one after the other. Details:
[Do the tools of a step run in parallel](../10-getting-started/90-faq.md#do-the-tools-of-a-step-run-in-parallel-how-do-i-switch-it-off).

### 2.6 Built-in tools

The gateway brings its own tools. Their names start with `BUILT_IN_TOOL_NAME_PREFIX` (`"dyna_aigw_"`) and are listed in
`BUILT_IN_TOOL_NAMES`.

| Name                           | Offered when                       | Page                                          |
|--------------------------------|------------------------------------|-----------------------------------------------|
| `dyna_aigw_ask_user_question`  | `humanGate.userQuestions.enabled`  | [Human in the loop](040-human-in-the-loop.md) |
| `dyna_aigw_remember_user_fact` | `userMemoryStore.enabled`          | [User memory](090-user-memory.md)             |
| `dyna_aigw_forget_user_fact`   | `userMemoryStore.enabled`          | [User memory](090-user-memory.md)             |
| `dyna_aigw_load_skill`         | the profile or the call has skills | [Skills](020-skills.md)                       |

A built-in is offered whatever `allowedTools`, the permissions and `activeTools` say, and the profile's `approvals` do not
apply to it ([D61](../60-architecture/90-decisions.md#d61-built-in-tools-are-always-offered)). It is switched off by its
feature switch. The prefix is reserved: an application tool whose name starts with it is a 400, in `toolRegistry.tools`
when the gateway is constructed and in `additionalTools` when the call starts
([D125](../60-architecture/90-decisions.md#d125-built-in-tools-carry-the-dyna_aigw_-prefix)).

### 2.7 A paused run

A run that pauses stores the names of its tools, not the tools. `resume()` rebuilds the set from those names and resolves
it again for the profile it resumes on, so a paused run continues with the tools it started with, not with today's
`activeTools`. A call tool is code and cannot be stored: `resume()` must receive the same `additionalTools` again, and a
missing one is a 400 that leaves the run paused.

## 3. Examples

The `config` and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md). Its `accountingProfile` allows `get_invoice` and
`post_credit_note`.

### 3.1 A read tool

```ts
import {z} from "zod";
import {dynaError} from "dyna-error";
import {defineTool} from "dyna-ai-gateway";

interface IInvoiceSummary {
  invoiceNo: string;
  customer: string;
  totalCents: number;
  currency: string;
  paid: boolean;
}

export const getInvoiceTool = defineTool({
  name: "get_invoice",
  // What the result holds, so the model reads it right
  description: "Returns one invoice by its number (format 2024-1187): customer, totalCents (an integer, in cents), currency, paid.",
  inputSchema: z.object({invoiceNo: z.string().regex(/^\d{4}-\d+$/)}),
  tags: ["billing", "read"],
  timeoutMs: 5_000,
  execute: async ({input: {invoiceNo}, userContext, abortSignal}): Promise<IInvoiceSummary> => {
    const invoice = await invoices.load({tenantId: userContext.tenantId, invoiceNo, signal: abortSignal}); // the app's own data access
    if (!invoice) {
      throw dynaError({
        code: 82758250,
        status: 404,
        message: `get_invoice: no invoice [${invoiceNo}] in tenant [${userContext.tenantId}]`,
        userMessage: `No invoice ${invoiceNo}. Ask the user for the number printed on the invoice.`,
      });
    }
    return {
      invoiceNo,
      customer: invoice.customerName,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      paid: invoice.paidAt !== null,
    };
  },
});
```

### 3.2 The registry, permissions and an order

```ts
import {z} from "zod";
import {AIGateway, EToolCallVerdict, defineTool} from "dyna-ai-gateway";

export const postCreditNoteTool = defineTool({
  name: "post_credit_note",
  description: "Posts a credit note against an invoice. Call get_invoice first. Returns {creditNoteNo}.",
  inputSchema: z.object({invoiceNo: z.string(), amountCents: z.number().int().positive(), reason: z.string()}),
  tags: ["billing", "write"],
  policy: EToolCallVerdict.NEEDS_APPROVAL, // every credit note waits for a human
  execute: async ({input, userContext}): Promise<{creditNoteNo: string}> =>
    creditNotes.post({tenantId: userContext.tenantId, ...input}),
});

const gateway = new AIGateway({
  ...config,
  toolRegistry: {
    tools: [getInvoiceTool, postCreditNoteTool],
    toolTimeoutMs: 15_000,  // every tool without its own timeoutMs
    maxOutputChars: 20_000, // a larger result is a 413 the model reads, not a cut one
    onToolError: (report): void => {
      console.warn("tool failed", {tool: report.toolName, callId: report.callId, modelText: report.modelText});
    },
  },
  toolPolicy: {
    permissionsToTools: {"billing.credit": ["post_credit_note"]}, // other users never see the tool
    requires: {post_credit_note: ["get_invoice"]},               // offered once get_invoice ran in this run
  },
});
```

A user without the `billing.credit` permission gets a run with `get_invoice` only. For the others, `post_credit_note`
appears in the step after `get_invoice` returned, and its call pauses the run. The approval is the subject of
[Human in the loop](040-human-in-the-loop.md).

### 3.3 One call, fewer tools

The user is on the read-only invoice screen. The call offers `get_invoice` only, whatever the profile allows.

```ts
const {response} = gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "Is invoice 2024-1187 paid?",
  activeTools: ["get_invoice"],
  kbFilters: {libraryIds: [], bookIds: []},
});
```

`activeTools: ["refund"]` is a 400 before anything is stored: the profile does not allow `refund`, and a call never widens
the set. `activeTools: []` offers none of your tools; the built-ins stay.

### 3.4 A tool for one call

The screen holds a draft letter, and the tool is bound to it. It exists for this call only.

```ts
import {z} from "zod";
import {IToolDef, defineTool} from "dyna-ai-gateway";

const makeReplaceDraftTool = (draftId: string): IToolDef<{text: string}, {saved: boolean}> => defineTool({
  name: "replace_draft_text",
  description: "Replaces the whole text of the letter the user is editing. Returns {saved}.",
  inputSchema: z.object({text: z.string().max(20_000)}),
  tags: ["drafts"],
  execute: async ({input: {text}, userContext}): Promise<{saved: boolean}> =>
    drafts.replaceText({tenantId: userContext.tenantId, draftId, text}),
});

const replaceDraftTool = makeReplaceDraftTool("draft-981");

const {response} = gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "Make the letter shorter and more polite.",
  additionalTools: [replaceDraftTool], // not in allowedTools: the app passed it
  kbFilters: {libraryIds: [], bookIds: []},
});
```

If the run pauses, the resume passes the same tool again (`paused` is the `PAUSED` response, `decisions` the human's):

```ts
await gateway.resume({
  userContext,
  runId: paused.envelopes[0].runId,
  pauseId: paused.pauseId,
  decisions,
  additionalTools: [replaceDraftTool],
}).response;
```

### 3.5 A tool switched off

`policy: EToolCallVerdict.DENY` keeps the tool registered and refuses every call; the model reads the refusal and goes on.
A predicate decides per call on the parsed input, and may look something up. Below, the tool of 3.2 with a predicate in
place of its fixed verdict; register one of the two, a name is unique in the registry.

```ts
import {EToolCallVerdict, TToolCallPolicyResult, defineTool} from "dyna-ai-gateway";

export const postCreditNoteDuringClosingTool = defineTool({
  ...postCreditNoteTool,
  policy: async ({input}): Promise<TToolCallPolicyResult> =>
    (await ledger.isPeriodClosed({invoiceNo: input.invoiceNo}))
      ? {verdict: EToolCallVerdict.DENY, reason: "The accounting period of this invoice is closed. Tell the user to contact finance."}
      : {verdict: EToolCallVerdict.NEEDS_APPROVAL},
});
```

The order of the rules and the approval side are in
[How do I control whether a tool call runs](../10-getting-started/90-faq.md#how-do-i-control-whether-a-tool-call-runs).

### 3.6 Showing the tool calls in a UI

```ts
import {BUILT_IN_TOOL_NAME_PREFIX, ELLMClientEventKind} from "dyna-ai-gateway";

const {events, response} = gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "What is the total of invoice 2024-1187?",
  kbFilters: {libraryIds: [], bookIds: []},
});

for await (const event of events) {
  const call = event.toolCall;
  if (event.kind === ELLMClientEventKind.TOOL_REQUEST && call && !call.toolName.startsWith(BUILT_IN_TOOL_NAME_PREFIX)) {
    showProgress(`Looking up: ${call.toolName}`); // the app's own UI
  }
}
```

## 4. Pitfalls

- **A vague description.** The model decides from `description` alone when to call a tool and how to read its result.
  "Gets invoice" says neither. Say when to call it, what the input means and what the result holds.
- **Cryptic or large results.** Every result is sent again with every later step of the run. Return small,
  self-describing plain data (`totalCents`, not `t`). A `Date`, a `Map` or a class instance serialises badly.
- **Relying on the output cap to trim.** A result above `maxOutputChars` is not cut. The call fails with a 413, and the
  model gets no data at all. Page or filter inside `execute`.
- **Letting internal errors through on purpose.** A plain `Error` is safe, since the model reads a generic text, but the
  model then gives up on the call. When the model can recover (a wrong id, a missing field), throw a `dynaError` with a
  `userMessage` that says how.
- **A secret in `userMessage`.** The model repeats it to the user. Hosts, SQL, internal ids and stacks belong in
  `message` and `data`.
- **Authorisation inside the description.** "Only for admins" in the text does not stop the model. Use
  `permissionsToTools`, `allowedTools` or a `DENY` policy.
- **A write without a policy.** A tool without `policy` runs on the model's word. A tool that changes money, sends mail
  or deletes data needs `NEEDS_APPROVAL` or a predicate ([Human in the loop](040-human-in-the-loop.md)).
- **Ignoring `abortSignal`.** After a timeout or a stop the gateway stops waiting, but the tool keeps running for
  nothing. Pass the signal to `fetch` or to the SDK the tool calls.
- **An `additionalTools` name that is also registered, or a name with the `dyna_aigw_` prefix.** Both are 400s before the
  call stores anything.
- **Forgetting `additionalTools` on `resume()`.** The paused run knows only the names. The resume is a 400 and the run
  stays paused.
- **Expecting `requires` or `visibleWhen` to force a call.** They hide a tool until its moment; the model may still
  answer without calling it. Say the order in the description and in the system prompt.

## 5. Summary

- A tool is an `IToolDef` written with `defineTool`. The model asks for it; the gateway validates the input, decides, runs
  `execute` and returns the result.
- Registry tools are fixed at construction and reach the model through `allowedTools`. Call tools come with
  `additionalTools`. Permissions, `activeTools`, `requires` and `visibleWhen` only narrow.
- The input is parsed with `inputSchema`, the output is not checked. The model learns the result from the description.
- A failure, a denial or a timeout becomes the tool's result, and the run goes on. The model reads only the `userMessage`
  side of an error.
- Built-in tools carry the reserved `dyna_aigw_` prefix and are always offered while their feature is on.

## 6. FAQ

**Can I add a tool while the server runs?**
Not to the registry. Pass it on the call as `additionalTools`, or deploy it. A new registry tool reaches a profile once
you add it to `allowedTools`.

**Does `ask()` use tools?**
No. `ask()` is one model call without tools, and `IGatewayAskInput` has no `activeTools` or `additionalTools`. Use
`run()`.

**How does the model know what a tool returns?**
From the `description` and from the data it reads. There is no output schema. Document the fields that matter in the
description.

**Can a tool call another tool, or the model?**
`execute` is your code and may call what it wants, but the gateway does not see those calls: they are not steps, not
traced and not checked by the usage adapter.

**What does the tool get to know about the caller?**
`execute` receives the parsed `input`, the caller's `userContext` (tenant, user, permissions, locale, time), the
`threadId` and an `abortSignal`. Scope every read and write by `userContext.tenantId`.

**What are `tags` for?**
For your own code: grouping tools, building a profile's `allowedTools` or a call's `activeTools`. The gateway does not
filter on them and the model never sees them.

**Can the model call a tool from an earlier turn of the thread?**
Only if it is offered in the current step. Otherwise the call is refused with a 403 the model reads
([D72, D79](../60-architecture/90-decisions.md#d72-d79-only-a-tool-the-model-was-offered-can-run)).

**How do I end the run after a tool, or offer a tool only on the first step?**
With `endsRun` and `visibleWhen`:
[Can a tool end the run](../10-getting-started/90-faq.md#how-does-a-run-end-and-can-a-tool-end-it),
[Can a tool be offered only in some steps](../10-getting-started/90-faq.md#can-a-tool-be-offered-only-in-some-steps-of-a-run).

**Can I name my own tool `ask_user_question`?**
Yes. Every name without the `dyna_aigw_` prefix is yours, the old unprefixed built-in names included.

## 7. API reference

| Symbol                                                                                | What it is                                                  |
|---------------------------------------------------------------------------------------|-------------------------------------------------------------|
| [`defineTool`](../30-api/index/functions/defineTool.md)                               | declares a tool with typed input and output                 |
| [`IToolDef`](../30-api/index/interfaces/IToolDef.md)                                  | the tool                                                    |
| [`IToolRegistryConfig`](../30-api/index/interfaces/IToolRegistryConfig.md)            | `tools`, `toolTimeoutMs`, `maxOutputChars`, `onToolError`   |
| [`IToolPolicyConfig`](../30-api/index/interfaces/IToolPolicyConfig.md)                | `permissionsToTools`, `requires`                            |
| [`IGatewayRunInput`](../30-api/index/interfaces/IGatewayRunInput.md)                  | `activeTools`, `additionalTools` of a call                  |
| [`IAIProfile`](../30-api/index/interfaces/IAIProfile.md)                              | `allowedTools`, `approvals`, `parallelToolCalls`, `limits`  |
| [`IModelCaps`](../30-api/index/interfaces/IModelCaps.md)                              | `tools`: whether the model can call tools                   |
| [`EToolCallVerdict`](../30-api/index/enumerations/EToolCallVerdict.md)                | `ALLOW`, `DENY`, `NEEDS_APPROVAL`                           |
| [`TToolCallPolicyResult`](../30-api/index/type-aliases/TToolCallPolicyResult.md)      | what a `policy` predicate returns                           |
| [`TToolEndsRunHandler`](../30-api/index/type-aliases/TToolEndsRunHandler.md)          | the `endsRun` predicate                                     |
| [`TToolVisibleWhenHandler`](../30-api/index/type-aliases/TToolVisibleWhenHandler.md)  | the `visibleWhen` predicate                                 |
| [`IToolErrorReport`](../30-api/index/interfaces/IToolErrorReport.md)                  | what `onToolError` receives                                 |
| [`TOnToolErrorHandler`](../30-api/index/type-aliases/TOnToolErrorHandler.md)          | the `onToolError` handler                                   |
| [`IToolCallPart`](../30-api/index/interfaces/IToolCallPart.md)                        | a tool call in the thread and in the events                 |
| [`IToolResultPart`](../30-api/index/interfaces/IToolResultPart.md)                    | a tool result: `output`, `failed`, `denied`, `errorCode`    |
| [`ELLMClientEventKind`](../30-api/index/enumerations/ELLMClientEventKind.md)          | `TOOL_REQUEST`, `TOOL_RESULT` in the stream                 |
| [`BUILT_IN_TOOL_NAME_PREFIX`](../30-api/index/variables/BUILT_IN_TOOL_NAME_PREFIX.md) | `"dyna_aigw_"`                                              |
| [`BUILT_IN_TOOL_NAMES`](../30-api/index/variables/BUILT_IN_TOOL_NAMES.md)             | the names of the built-in tools                             |
| [`DEFAULT_TOOL_DENIAL_TEXT`](../30-api/index/variables/DEFAULT_TOOL_DENIAL_TEXT.md)   | what the model reads before a policy's `reason`             |
| [`ILLMClientHooks`](../30-api/index/interfaces/ILLMClientHooks.md)                    | the hooks of the agent loop                                 |
| [`IToolRegistry`](../30-api/index/interfaces/IToolRegistry.md)                        | the contract to pass in `overrides` to replace the registry |
| [`IToolPolicy`](../30-api/index/interfaces/IToolPolicy.md)                            | the contract to pass in `overrides` to replace the policy   |
