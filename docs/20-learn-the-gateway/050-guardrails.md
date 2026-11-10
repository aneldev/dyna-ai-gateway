# Guardrails

Guardrails are the checks around a model call. Input rules screen the prompt before anything is stored or sent to the
model. Output rules screen the answer before it is stored or delivered. A rule is plain code or a judge, a short
classification call on the profile's cheap model. Every rule returns issues, and the severity of an issue is the verdict.

## 1. About

| Stage  | Built-in rules (always on)                                                    | The application's rules                                                                              | Runs                                              |
|--------|-------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|---------------------------------------------------|
| Input  | prompt not empty, not over `maxPromptChars`, no prompt-injection marker       | [`IInputRule`](../30-api/index/interfaces/IInputRule.md)[]: moderation, topic scope, PII             | before a thread is created or a turn is stored    |
| Output | answer not truncated, answer matches the `outputSchema` when the call has one | [`IOutputRule`](../30-api/index/interfaces/IOutputRule.md)[]: business checks, grounding, moderation | after the model call, before the answer is stored |

The rules live in the gateway's config, `IAIGatewayConfig.guardrails`
([`IGuardrailsConfig`](../30-api/index/interfaces/IGuardrailsConfig.md)):

| Key              | What it sets                                                  | Default   |
|------------------|---------------------------------------------------------------|-----------|
| `inputRules`     | the application's rules on the prompt                         | none      |
| `outputRules`    | the application's rules on the answer                         | none      |
| `maxPromptChars` | the length cap of the built-in input rule `prompt_max_length` | 20 000    |
| `ruleTimeoutMs`  | the time a rule may take; a rule's own `timeoutMs` wins       | 10 000 ms |
| `onRuleError`    | one handler for every rule that threw or timed out            | none      |

The rules are fixed when the gateway is constructed. A profile has no rules of its own, and a call cannot add any.
A rule acts per use case by reading `evidence.profile`.

## 2. Logic

### 2.1 The input check

1. The gateway sanitises the prompt: it trims it and normalises the line endings to `\n`. The call goes on with the
   sanitised prompt.
2. The built-in input rules run:

   | Rule name           | Issue `code`      | When                                                                  |
   |---------------------|-------------------|-----------------------------------------------------------------------|
   | `prompt_not_empty`  | `prompt_empty`    | the prompt is blank and the call has no files                         |
   | `prompt_max_length` | `prompt_too_long` | the prompt is longer than `maxPromptChars`                            |
   | `prompt_injection`  | `prompt_blocked`  | the prompt matches a known marker ("ignore previous instructions", …) |

   All three are `ERROR`. None of them calls a model.
3. Only when no built-in rule returned an `ERROR`, the `inputRules` run, in parallel. Their issues come back in rule
   order.
4. An `ERROR` issue fails the call. The response is `FAILED` with the reason "The prompt was rejected" and the issues.
   Nothing is stored: no thread, no user turn, no run. The model is never called.
5. With no `ERROR`, the call goes on. The `WARNING` and `INFO` issues travel to the answer's `issues`.

An input rule gets [`IInputEvidence`](../30-api/index/interfaces/IInputEvidence.md): the sanitised `prompt`, the `files`
(pointers) and the same files with their bytes (`inlineFiles`), the `userContext`, the `profile`, and the `threadId`,
which is `undefined` when the call creates a new thread.

### 2.2 The output check

1. A model that stopped at its output token limit adds the `WARNING` `output_truncated`. The answer is still checked
   and delivered.
2. With an `outputSchema`, the gateway validates the answer against it (chapter 2.4).
3. Only when steps 1 and 2 gave no `ERROR`, the `outputRules` run, in parallel.
4. An `ERROR` issue blocks the answer. The response is `FAILED` with the reason "The answer did not pass the checks".
   The answer text is not stored and no memory update runs. In a run, the tool calls and their results stay in the
   thread: the tools did run. The architecture decision is
   [D70, D74](../60-architecture/90-decisions.md#d70-d74-a-blocked-answer-is-not-stored-and-the-stream-learns-it-was-withdrawn).
5. With no `ERROR`, the answer is stored and delivered with the `WARNING` and `INFO` issues in `response.issues`. On a
   profile that reviews its answers, a passed answer pauses for the reviewer; a blocked answer is never reviewed
   ([Human in the loop](040-human-in-the-loop.md)).

An output rule gets [`IOutputEvidence`](../30-api/index/interfaces/IOutputEvidence.md): the user's `prompt`, the
`output` (the parsed value with an `outputSchema`, the text otherwise), the knowledge-base `chunks` that were in the
request, the `toolResults` of the run, the `userContext`, the `profile` and the `threadId`. The thread exists by now.

The output check runs on the answer of every `ask()` and of every run that ended with text, `resume()` included.

### 2.3 Issues and severity

A rule returns [`IIssue`](../30-api/index/interfaces/IIssue.md)[]. An empty array is a pass.

| [`EIssueSeverity`](../30-api/index/enumerations/EIssueSeverity.md) | Effect                                                                    |
|--------------------------------------------------------------------|---------------------------------------------------------------------------|
| `ERROR`                                                            | the prompt is rejected or the answer is blocked; the response is `FAILED` |
| `WARNING`                                                          | the call goes on; the issue is on the answer's `issues` for the UI        |
| `INFO`                                                             | the call goes on; the issue is on the answer's `issues`                   |

The severity is the only verdict: there is no other switch
([D47, D49](../60-architecture/90-decisions.md#d47-d49-one-class-with-rules-and-the-severity-is-the-only-verdict)).

| `IIssue` field | Set by             | Content                                                                                           |
|----------------|--------------------|---------------------------------------------------------------------------------------------------|
| `ruleName`     | the gateway        | the rule's `name`; on the issues of every input rule, built-in included, and of the `outputRules` |
| `code`         | the rule           | the machine code, e.g. `out_of_scope`                                                             |
| `message`      | the rule           | the developer's text, in English                                                                  |
| `severity`     | the rule           | the verdict                                                                                       |
| `field`        | the rule, optional | the field path the issue concerns                                                                 |
| `userMessage`  | the rule, optional | the text for the end user, in the user's language                                                 |
| `data`         | the rule, optional | machine-readable details                                                                          |

The built-in output issues (`output_truncated`, `output_invalid_json`, `output_schema`) carry no `ruleName`.

### 2.4 Structured output

With an `outputSchema` on `ask()` or `run()`, the output check validates the answer before any rule sees it. It takes the
structured value the model returned, or parses the text as JSON, and validates it with the zod schema.

| Issue `code`          | Severity | When                                                                   |
|-----------------------|----------|------------------------------------------------------------------------|
| `output_invalid_json` | `ERROR`  | the text is not JSON                                                   |
| `output_schema`       | `ERROR`  | the value does not match the schema; `field` is the first failing path |

A passed answer carries the parsed value in `response.structured`, and the output rules get it as `evidence.output`.

### 2.5 The judge

`check` receives a `judge`. One `judge` call is one completion: a fixed classifier system prompt, the rule's
`instruction`, the evidence, and structured output in the issue shape. It returns the issues the model found; the rule
returns them as they are or maps them.

| Argument      | Input judge ([`IInputJudgeArgs`](../30-api/index/interfaces/IInputJudgeArgs.md)) | Output judge ([`IOutputJudgeArgs`](../30-api/index/interfaces/IOutputJudgeArgs.md)) |
|---------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `instruction` | what to check, required                                                          | what to check, required                                                             |
| `model`       | `EJudgeModel.CHEAP` (default) or `EJudgeModel.MAIN`                              | the same                                                                            |
| always sent   | the sanitised prompt                                                             | the question and the answer (a structured value as JSON)                            |
| `fileFilter`  | required: which files of the prompt go with their bytes                          | —                                                                                   |
| `chunks`      | —                                                                                | required: `true` sends the knowledge-base chunks (grounding)                        |
| `toolResults` | —                                                                                | required: `true` sends the tool results of the run                                  |

- `EJudgeModel.CHEAP` is the profile's `cheapModelId`. A profile without one uses its `modelId`.
- The temperature is 0 where the model takes one
  ([D82](../60-architecture/90-decisions.md#d82-a-model-says-whether-it-takes-a-temperature)).
- The call goes through the usage adapter and the trace like every model call. Its trace entry has the kind
  `ETraceKind.GUARDRAIL_JUDGE`, and the gateway adds the check's issues to it, so a rejected prompt is readable in the
  trace ([D73](../60-architecture/90-decisions.md#d73-a-checks-issues-are-on-the-trace-entries-of-its-judge-calls)).
- The judge touches no thread, no memory, no template and no tool, and no guardrail runs on it.
- The judge call is aborted with the rule's timeout.
- A model that does not answer in the issue shape fails the rule as `rule_error`. It never passes
  ([D57, D59](../60-architecture/90-decisions.md#d57-d59-a-rule-gets-a-judge)).

### 2.6 Rule errors

A rule that throws, or gives no answer within its timeout, becomes the `ERROR` issue `rule_error`, stamped with the
rule's name. A broken rule therefore blocks the call; it never lets anything pass.

- The error itself never reaches the caller. It is logged on the server, and the issue carries a short message only.
- `onRuleError` receives one [`IRuleErrorReport`](../30-api/index/interfaces/IRuleErrorReport.md) per failed rule:
  the `stage` ([`ERuleStage`](../30-api/index/enumerations/ERuleStage.md) `INPUT` or `OUTPUT`), the `ruleName`, the
  `failure` ([`ERuleFailure`](../30-api/index/enumerations/ERuleFailure.md) `THREW` or `TIMED_OUT`), the `error` as
  thrown, the `issue` the caller got, the `evidence`, the `traceIds` of the rule's judge calls, `timeoutMs`,
  `durationMs` and more. The full list is in the
  [FAQ](../10-getting-started/90-faq.md#how-do-i-add-moderation-or-other-safety-checks).
- The handler is fire-and-forget. The check never waits for it, and a handler that throws is logged and ignored
  ([D107](../60-architecture/90-decisions.md#d107-how-the-developer-is-told-that-a-rule-failed)).

Two stops are not rule errors and are not reported to `onRuleError`:

| What stopped the rule                                | Response                                                                                                                                         |
|------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| the caller's `abortSignal` or the call's `timeoutMs` | `FAILED` with `call_aborted` or `call_timed_out` ([D90](../60-architecture/90-decisions.md#d90-a-call-can-be-stopped-abortsignal-and-timeoutms)) |
| the usage adapter refused a judge call               | input: `FAILED` with `usage_denied`; output: the answer is withdrawn with `usage_denied`                                                         |

### 2.7 A streamed answer that is blocked

The answer streams on `events` (`TEXT_DELTA`) while the model writes it. The output rules run when it is complete. A
blocked answer has therefore already streamed. The stream then ends with `DONE` followed by one last event,
`ELLMClientEventKind.ANSWER_WITHDRAWN`, whose `issues` are those of the `FAILED` response. A client drops or greys the
text it rendered. The [Vercel chat client](../10-getting-started/50-vercel-chat-client.md#3-what-the-client-receives)
receives it as `metadata.withdrawn`.

### 2.8 Prompt injection

The gateway rejects a prompt that contains a known injection phrase (`prompt_injection`, issue `prompt_blocked`). This
is a cheap first filter, easy to get around. The judge's own system prompt tells the model not to follow instructions
inside the evidence. The real defence is layered: see
[How do I protect against prompt injection?](../10-getting-started/90-faq.md#how-do-i-protect-against-prompt-injection).

### 2.9 Answers a user types on a resume

When the model asks the user a question and the user answers with free text, `resume()` screens that text with the input
rules, as a prompt without files. A rejected answer returns `FAILED` with the reason "The answer was rejected" and the
issues, and the run stays paused for another answer
([D71](../60-architecture/90-decisions.md#d71-a-users-free-text-answer-is-screened-like-a-prompt)). An answer a reviewer
edits is validated against the `outputSchema` again, but the output rules do not run on it: the reviewer's text is the
application's own ([Human in the loop](040-human-in-the-loop.md)).

## 3. Examples

The `config` and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md).

### 3.1 A deterministic input rule

A support chat never holds account numbers. A regular expression decides, and no model is called.

```ts
import {AIGateway, EIssueSeverity, IIssue, IInputRule} from "dyna-ai-gateway";

const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/;

const noPaymentData: IInputRule = {
  name: "no_payment_data",
  check: async ({evidence}): Promise<IIssue[]> =>
    IBAN.test(evidence.prompt)
      ? [{
        code: "payment_data",
        message: "The prompt contains an IBAN",
        severity: EIssueSeverity.ERROR,
        field: "prompt",
        userMessage: "Please do not send account numbers in the chat.",
      }]
      : [],
};

const gateway = new AIGateway({
  ...config,
  guardrails: {inputRules: [noPaymentData]},
});
```

### 3.2 A judge rule on the cheap model

The accounting assistant answers accounting questions only. The judge classifies the prompt.

```ts
import {EJudgeModel, IIssue, IInputRule} from "dyna-ai-gateway";

const accountingScope: IInputRule = {
  name: "accounting_scope",
  timeoutMs: 5_000,
  check: async ({evidence, judge}): Promise<IIssue[]> => {
    if (evidence.profile.id !== "accounting") return []; // the rule applies to one use case
    return judge({
      instruction: [
        "This assistant answers questions about invoices, payments and bookkeeping.",
        "Report one issue with code `out_of_scope` and severity `ERROR` when the prompt is about anything else.",
      ].join(" "),
      model: EJudgeModel.CHEAP,
      fileFilter: file => file.mime.startsWith("image/"), // a photo of a receipt goes with the prompt
    });
  },
};
```

### 3.3 An output rule on the structured answer

The answer of [Example: ask](../10-getting-started/30-example-ask.md) lists invoice lines. A line listed twice blocks
the answer.

```ts
import {z} from "zod";
import {EIssueSeverity, IIssue, IOutputRule} from "dyna-ai-gateway";

const missingVatAnswer = z.object({lines: z.array(z.object({lineNo: z.number(), reason: z.string()}))});

const uniqueLines: IOutputRule = {
  name: "unique_lines",
  check: async ({evidence}): Promise<IIssue[]> => {
    const parsed = missingVatAnswer.safeParse(evidence.output);
    if (!parsed.success) return []; // another call's answer: not this rule's shape
    const lineNos = parsed.data.lines.map(line => line.lineNo);
    return new Set(lineNos).size === lineNos.length
      ? []
      : [{code: "duplicate_line", message: "The answer lists a line twice", severity: EIssueSeverity.ERROR, field: "lines"}];
  },
};
```

### 3.4 A grounding judge that only warns

The answer should rest on the knowledge base. An unsupported claim is flagged, not blocked.

```ts
import {EIssueSeverity, IIssue, IOutputRule} from "dyna-ai-gateway";

const grounding: IOutputRule = {
  name: "grounding",
  check: async ({evidence, judge}): Promise<IIssue[]> => {
    if (evidence.chunks.length === 0) return []; // no knowledge base in this call
    const issues = await judge({
      instruction: "Report one issue with code `ungrounded` for every claim of the answer that the knowledge-base chunks do not support.",
      chunks: true,
      toolResults: false,
    });
    return issues.map(issue => ({...issue, severity: EIssueSeverity.WARNING}));
  },
};
```

### 3.5 Reading the verdict

```ts
import {AIGateway, EGatewayResponseKind, ELLMClientEventKind} from "dyna-ai-gateway";

const gateway = new AIGateway({
  ...config,
  guardrails: {
    inputRules: [noPaymentData, accountingScope],
    outputRules: [uniqueLines, grounding],
  },
});

const {events, response} = gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Which lines of invoice 4521 are missing a VAT code?",
  kbFilters: {libraryIds: [], bookIds: []},
});

let shown = "";
for await (const event of events) {
  if (event.kind === ELLMClientEventKind.TEXT_DELTA) shown += event.text ?? "";
  if (event.kind === ELLMClientEventKind.ANSWER_WITHDRAWN) shown = ""; // the streamed text is not kept
}

const result = await response;
if (result.kind === EGatewayResponseKind.FAILED) {
  // e.g. [{ruleName: "no_payment_data", code: "payment_data", severity: "ERROR", ...}]
  const forTheUser = result.issues.map(issue => issue.userMessage).filter(Boolean);
}
if (result.kind === EGatewayResponseKind.ANSWER) {
  result.issues; // the WARNING and INFO issues, e.g. grounding's `ungrounded`
}
```

### 3.6 Being told that a rule broke

```ts
import {AIGateway, ERuleFailure, IRuleErrorReport} from "dyna-ai-gateway";

const gateway = new AIGateway({
  ...config,
  guardrails: {
    inputRules: [accountingScope],
    ruleTimeoutMs: 8_000,
    onRuleError: (report: IRuleErrorReport): void => {
      console.error("guardrail rule failed", {
        rule: report.ruleName,
        stage: report.stage,
        timedOut: report.failure === ERuleFailure.TIMED_OUT,
        error: report.error,         // absent on a timeout
        traceIds: report.traceIds,   // a judge that answered out of shape is read there
      });
    },
  },
});
```

## 4. Pitfalls

- **Vendor details in `message`.** `response.issues` goes back to the application, and UIs often display it. Put the
  end user's text in `userMessage`. Throw a service error instead of returning it: it reaches `onRuleError`, not the user.
- **A minor check that blocks when its service is down.** A rule that throws is `rule_error`, an `ERROR`. When a check
  must not block, catch its failure and return a `WARNING` with your own `code`
  ([FAQ](../10-getting-started/90-faq.md#how-do-i-add-moderation-or-other-safety-checks)).
- **Ignoring `abortSignal`.** The signal a rule receives is aborted at the rule's timeout and when the caller stops the
  call. Pass it to the rule's HTTP call, or the request keeps running after the verdict.
- **A rule for every profile.** The rules are the gateway's, so every call of every profile runs them. Scope a rule with
  `evidence.profile` (example 3.2) or by the shape of `evidence.output` (example 3.3).
- **A judge without the evidence it needs.** `fileFilter`, `chunks` and `toolResults` are required. `() => false` sends
  no file, and a grounding judge with `chunks: false` has nothing to compare the answer with.
- **A judge with a vague instruction.** The judge reports what the instruction asks. Name the `code` and the severity it
  must report, and say when the evidence passes.
- **Many judges on the main model.** Every judge is one model call on every call of the gateway. `EJudgeModel.MAIN`
  costs the main model's price; a profile without `cheapModelId` pays it for `EJudgeModel.CHEAP` too.
- **Two rules with one name.** Names are unique per stage, and the input rules also against the built-in names. A
  duplicate makes the `AIGateway` constructor throw.
- **Relying on `prompt_injection`.** It matches three phrases. Limit what an injected prompt can do with the tools,
  approvals and step limits.
- **Showing the deltas of a strict use case.** A blocked answer has already streamed. Where the user must never see it,
  show only the final `response`.
- **Taking `answer_rejected` for a guardrail.** `ANSWER_REJECTED_ISSUE_CODE` is the issue of an answer a reviewer
  rejected ([Human in the loop](040-human-in-the-loop.md)). A guardrail's issue carries the rule's `ruleName` and code.

## 5. Summary

- Input rules screen the prompt before anything is stored. Output rules screen the answer before it is stored.
- The built-in rules run first. The application's rules run only when those passed, in parallel, each under its timeout.
- A rule returns issues. `ERROR` fails the call or blocks the answer; `WARNING` and `INFO` travel on the answer.
- A blocked answer is not stored, and a streamed one ends with `ANSWER_WITHDRAWN`.
- A rule that throws or times out is the `ERROR` `rule_error`; the details go to the server log and `onRuleError`.
- A judge is one traced, usage-checked classification call on the profile's cheap model.

## 6. FAQ

**Do the application's rules run when the prompt is empty or too long?**
No. A built-in `ERROR` stops the check before the application's rules, so a rejected prompt pays for no judge call.

**Does a blocked answer cost tokens?**
Yes. The model wrote it, and the usage adapter was told. Only the storing and the delivery are skipped.

**Can a rule change the prompt or the answer?**
No. A rule returns issues only. The gateway's only change is the sanitising of the prompt (trim, line endings).

**Where do I see why a prompt was rejected?**
In the `FAILED` response's `issues`, and in the trace: the entries of the judge calls carry the check's issues.

**Can I change the rules at runtime?**
No. They are fixed at construction. A gateway with other rules is a new `AIGateway`. To replace the whole check, pass
a factory of your own [`IGuardrails`](../30-api/index/interfaces/IGuardrails.md) as `guardrails` in the constructor's
`overrides` ([`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md)).

**Does the judge see the files of the prompt?**
Only the ones the rule's `fileFilter` picks. They are sent with their bytes.

## 7. API reference

| Symbol                                                                          | What it is                                                  |
|---------------------------------------------------------------------------------|-------------------------------------------------------------|
| [`IAIGatewayConfig.guardrails`](../30-api/index/interfaces/IAIGatewayConfig.md) | where the rules are configured                              |
| [`IGuardrailsConfig`](../30-api/index/interfaces/IGuardrailsConfig.md)          | the rules, the timeout, the prompt cap, `onRuleError`       |
| [`IInputRule`](../30-api/index/interfaces/IInputRule.md)                        | a rule on the prompt                                        |
| [`IOutputRule`](../30-api/index/interfaces/IOutputRule.md)                      | a rule on the answer                                        |
| [`IInputEvidence`](../30-api/index/interfaces/IInputEvidence.md)                | what an input rule inspects                                 |
| [`IOutputEvidence`](../30-api/index/interfaces/IOutputEvidence.md)              | what an output rule inspects                                |
| [`IIssue`](../30-api/index/interfaces/IIssue.md)                                | what a rule returns                                         |
| [`EIssueSeverity`](../30-api/index/enumerations/EIssueSeverity.md)              | `ERROR`, `WARNING`, `INFO`                                  |
| [`IJudgeArgs`](../30-api/index/interfaces/IJudgeArgs.md)                        | `instruction`, `model`                                      |
| [`IInputJudgeArgs`](../30-api/index/interfaces/IInputJudgeArgs.md)              | the input judge's arguments: `fileFilter`                   |
| [`IOutputJudgeArgs`](../30-api/index/interfaces/IOutputJudgeArgs.md)            | the output judge's arguments: `chunks`, `toolResults`       |
| [`EJudgeModel`](../30-api/index/enumerations/EJudgeModel.md)                    | `CHEAP`, `MAIN`                                             |
| [`TInputJudgeHandler`](../30-api/index/type-aliases/TInputJudgeHandler.md)      | the input rule's `judge`                                    |
| [`TOutputJudgeHandler`](../30-api/index/type-aliases/TOutputJudgeHandler.md)    | the output rule's `judge`                                   |
| [`TOnRuleErrorHandler`](../30-api/index/type-aliases/TOnRuleErrorHandler.md)    | the type of `onRuleError`                                   |
| [`IRuleErrorReport`](../30-api/index/interfaces/IRuleErrorReport.md)            | what `onRuleError` receives                                 |
| [`ERuleStage`](../30-api/index/enumerations/ERuleStage.md)                      | `INPUT`, `OUTPUT`                                           |
| [`ERuleFailure`](../30-api/index/enumerations/ERuleFailure.md)                  | `THREW`, `TIMED_OUT`                                        |
| [`IFailedResponse`](../30-api/index/interfaces/IFailedResponse.md)              | the response of a rejected prompt or a blocked answer       |
| [`ELLMClientEventKind`](../30-api/index/enumerations/ELLMClientEventKind.md)    | `ANSWER_WITHDRAWN`, the last event of a blocked answer      |
| [`ITraceEntry`](../30-api/index/interfaces/ITraceEntry.md)                      | a judge call's entry, kind `GUARDRAIL_JUDGE`, with `issues` |
| [`IGuardrails`](../30-api/index/interfaces/IGuardrails.md)                      | the contract to pass in `overrides` to replace the checks   |
