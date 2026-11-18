---
sidebar_label: LLM-as-a-judge guardrails
description: "LLM-as-a-judge guardrails in TypeScript: deterministic checks first, then a short classification call on a cheap model for topic scope, moderation or grounding, with severities that block or flag, timeouts that fail closed, and every judge call traced."
keywords: [LLM as a judge, AI guardrails, LLM moderation, content moderation, topic guardrails, PII detection, TypeScript]
---

# LLM-as-a-Judge Guardrails: Check Prompts and Answers with a Cheap Model

Some checks need understanding, not a pattern: is this prompt about accounting, does this answer promise something the
policy does not allow, is this photo a receipt. LLM-as-a-judge is the practice of answering such a question with a second,
short model call that classifies instead of answering. Done well, it runs on a cheap model, after the free checks, and
its verdict is part of the response.

## 1. The problem

- A regular expression cannot tell whether a prompt is on topic.
- A judge on the main model adds a call at the main model's price to every call.
- A judge that times out or answers out of shape must not let the call through.
- A judge that the application cannot see is a judge nobody can debug.

## 2. The practice

1. **Deterministic checks first.** A pattern that decides (an IBAN, a length) is plain code and calls no model. The
   built-in input rules run before yours, so a prompt they reject pays for no judge. Your own rules run in parallel: a
   pattern check that must spare the judge goes into the judge's rule, before the `judge` call.
2. **The judge on the cheap model.** A rule calls `judge` with `EJudgeModel.CHEAP`, the profile's `cheapModelId`. The
   temperature is 0 where the model takes one.
3. **A precise instruction.** Name the issue `code` and the severity the judge must report, and when the evidence passes.
4. **Only the evidence it needs.** An input judge chooses which files go with their bytes (`fileFilter`); an output judge
   chooses the knowledge-base excerpts (`chunks`) and the tool results (`toolResults`).
5. **The severity is the verdict.** `ERROR` rejects the prompt or blocks the answer; `WARNING` and `INFO` keep it and
   travel on the response's `issues`, for the UI to flag.
6. **Scope the rule.** The rules are the gateway's and run on every call. A rule for one use case returns early on the
   other profiles.
7. **Every judge is visible.** A judge call is checked by the usage adapter and traced with the kind `GUARDRAIL_JUDGE`,
   with the issues of its check.
8. **Fail closed, and know it.** A rule that throws or passes its timeout is the `ERROR` `rule_error`. `onRuleError`
   reports it to your logs. The timeout is applied outside the rule, so a check that must not block bounds its own
   service call with a shorter timeout (`AbortSignal.timeout`), or races its `judge` call against a shorter timer (the
   judge call then still runs to its end and is billed), catches the failure and returns a `WARNING`. A judge call the usage adapter refuses is
   `usage_denied`, not `rule_error`.

## 3. In code

The samples run on your configuration and the caller's `userContext`. The setup they need is in the learning path
[Protect the conversation](../24-learning-paths/040-protect-the-conversation.md).

A topic judge for one profile, on the cheap model:

```ts
import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
  EJudgeModel,
  IAIGatewayConfig,
  IIssue,
  IInputRule,
  IOutputRule,
  IUserContext,
} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;  // your configuration; the accounting profile has a cheapModelId
declare const userContext: IUserContext; // who asks

const accountingScope: IInputRule = {
  name: "accounting_scope",
  timeoutMs: 5_000,
  check: async ({evidence, judge}): Promise<IIssue[]> => {
    if (evidence.profile.id !== "accounting") return []; // this use case only
    return judge({
      instruction: [
        "This assistant answers questions about invoices, payments and bookkeeping.",
        "Report one issue with code `out_of_scope` and severity `ERROR` when the prompt is about anything else.",
        "Report nothing when it is about accounting.",
      ].join(" "),
      model: EJudgeModel.CHEAP,
      fileFilter: file => file.mime.startsWith("image/"), // a photo of a receipt goes with the prompt
    });
  },
};
```

An answer check that flags instead of blocking:

```ts
const policyPromises: IOutputRule = {
  name: "policy_promises",
  check: async ({judge}): Promise<IIssue[]> => {
    const issues = await judge({
      instruction: "Report one issue with code `unapproved_promise` when the answer promises a refund, a discount or a deadline.",
      chunks: false,
      toolResults: true, // what the tools returned; on a resumed run, only the calls after the resume
    });
    return issues.map(issue => ({...issue, severity: EIssueSeverity.WARNING})); // flag it, keep the answer
  },
};
```

The rules in the configuration, and the channel for a rule that broke:

```ts
const gateway = new AIGateway({
  ...config,
  guardrails: {
    inputRules: [accountingScope],
    outputRules: [policyPromises],
    ruleTimeoutMs: 8_000,
    onRuleError: (report): void => {
      console.error("guardrail rule failed", {rule: report.ruleName, stage: report.stage, failure: report.failure, traceIds: report.traceIds});
    },
  },
});

const result = await gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Can you write me a poem about the sea?",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.FAILED) {
  console.log(result.issues); // e.g. [{ruleName: "accounting_scope", code: "out_of_scope", severity: "ERROR", ...}]
}
```

## 4. Pitfalls

- **A judge where a pattern decides.** Every judge is one model call on every call its rule reaches.
- **No `cheapModelId` on the profile.** `EJudgeModel.CHEAP` then runs on the main model, at its price.
- **A vague instruction.** The judge follows it loosely. Name the code, the severity and when the evidence passes, and
  measure the rule on examples: a judge still misses cases and flags valid ones.
- **A minor check that blocks when its service is down.** A rule that throws or runs past its timeout is an `ERROR`.
  Where a failure must not block, give the service call inside the rule a shorter timeout (a `judge` call takes none: race it against a timer), catch,
  and return a `WARNING`.
- **A pattern rule next to a judge rule.** They run at the same time, so the judge is paid for also when the pattern
  rejects. Put both in one rule, the pattern first.
- **Files for a judge model that cannot read them.** `fileFilter` sends the bytes as they are. Choose a `cheapModelId`
  that reads the images or PDFs you send.
- **Streaming a strict use case.** An answer streams before the output rules run. A blocked answer ends its stream with
  `ANSWER_WITHDRAWN`; where the user must never see it, show only the final `response`.
- **Vendor details in an issue.** Issues go back to the application and into the trace. `message` is the developer's
  text; a text for the user goes in `userMessage`, which the rule sets itself, since a judge's issues have none. A vendor
  error is thrown instead, and reaches `onRuleError`.

## 5. Checklist

- [ ] Pattern checks are plain code; judges only where understanding is needed.
- [ ] Every profile with judges has a `cheapModelId`.
- [ ] Each judge instruction names its code, its severity and when the evidence passes.
- [ ] Rules return early outside their use case.
- [ ] `onRuleError` reports to your logs.

## 6. Go further

- [Guardrails](../20-learn-the-gateway/050-guardrails.md): the input and output checks, the judge, rule errors.
- [Stop hallucinations](020-stop-llm-hallucinations.md): a grounding judge over the knowledge-base excerpts.
- [How do I add moderation or other safety checks?](../10-getting-started/90-faq.md#how-do-i-add-moderation-or-other-safety-checks)
