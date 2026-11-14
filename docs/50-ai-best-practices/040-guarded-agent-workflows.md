---
sidebar_label: Guarded agent workflows
description: "Enforce the order of an AI agent's tool calls in code: a tool is offered only after the tools it requires have run, a step-based visibility rule, a terminal tool that ends the run, and a step limit. TypeScript examples."
keywords: [AI agent workflow, tool calling, agent guardrails, tool order, LLM agent, function calling, TypeScript]
---

# Guarded Agent Workflows: Enforce the Order of Tool Calls in Code, Not in the Prompt

"Look up the invoice before you post a credit note" is a business rule. Written only in the prompt, it holds as long as
the model follows it. The practice is to state the order in code, so a tool is not even offered before its prerequisites
have run, and to end the run with a terminal tool once the job is done.

## 1. The problem

- An agent with every tool available from the first step can call the write tool first, with an amount it guessed.
- A rule in the prompt is a request. Nothing stops a model that skips it, or a prompt that talks it out of it.
- An agent that has finished its job keeps calling tools, because nothing tells the loop the job is done.

## 2. The practice

1. **Prerequisites in the configuration.** `toolPolicy.requires` names, per tool, the tools that must have run in this run
   before it is offered. Until then the model does not see it, and a call by name is refused with a message that names
   what to call first. A tool held back this way is a guarded workflow.
2. **Steps in the tool.** `visibleWhen` offers a tool only in some steps, for example a classifier on the first step only.
3. **A terminal tool.** `endsRun` on the tool that completes the job (file the report, hand over to a human) ends the run
   after its successful call. The model gets one last step without tools to write the closing sentence.
4. **A bounded loop.** The profile's `limits.maxStepsPerRun` caps the model calls of one run.
5. **The order in words too.** `requires` and `visibleWhen` hide a tool until its moment; they do not force a call. Say the
   order in the tool's description as well, so the model calls the prerequisite instead of answering without it.

## 3. In code

The samples run on your `gateway` configuration and the caller's `userContext`. The setup they need is in the learning
path [Automate a back-office task](../24-learning-paths/130-automate-a-back-office-task.md).

Three tools of a payment-matching job:

```ts
import {z} from "zod";
import {AIGateway, IAIGatewayConfig, IUserContext, defineTool} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;  // your configuration
declare const userContext: IUserContext; // the service user the job runs as
declare const bank: {statement(day: string): Promise<{lineId: string; amountCents: number; text: string}[]>};
declare const ledger: {match(lineId: string, invoiceNo: string): Promise<void>; fileReport(day: string, summary: string): Promise<string>};

const fetchBankStatement = defineTool({
  name: "fetch_bank_statement",
  description: "Returns the bank statement lines of one day (YYYY-MM-DD): lineId, amountCents, text. Call it first.",
  inputSchema: z.object({day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}),
  tags: ["bank", "read"],
  execute: async ({input: {day}}) => bank.statement(day),
});

const matchPayment = defineTool({
  name: "match_payment",
  description: "Matches one statement line to one open invoice. Only for lines returned by fetch_bank_statement.",
  inputSchema: z.object({lineId: z.string(), invoiceNo: z.string()}),
  tags: ["ledger", "write"],
  execute: async ({input: {lineId, invoiceNo}}): Promise<{matched: true}> => {
    await ledger.match(lineId, invoiceNo);
    return {matched: true};
  },
});

const fileReport = defineTool({
  name: "file_reconciliation_report",
  description: "Files the report of the day once every line is matched or explained. Ends the job.",
  inputSchema: z.object({day: z.string(), summary: z.string()}),
  tags: ["ledger", "write"],
  execute: async ({input: {day, summary}}): Promise<{reportId: string}> => ({reportId: await ledger.fileReport(day, summary)}),
  endsRun: true, // the job is done once the report is filed
});
```

The order, in the configuration:

```ts
const gateway = new AIGateway({
  ...config,
  toolRegistry: {tools: [fetchBankStatement, matchPayment, fileReport]},
  toolPolicy: {
    requires: {
      match_payment: ["fetch_bank_statement"],              // no match before the statement is read
      file_reconciliation_report: ["fetch_bank_statement"], // no report before the statement is read
    },
  },
});
```

The job, and how it ended:

```ts
import {EGatewayResponseKind} from "dyna-ai-gateway";

const result = await gateway.run({
  userContext,
  profileId: "reconciliation", // allows the three tools; limits.maxStepsPerRun bounds the loop
  prompt: "Reconcile the bank statement of 2026-11-13.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.ANSWER) {
  console.log(result.endedByTool ?? "the model stopped without filing the report", result.text);
}
```

## 4. Pitfalls

- **Expecting `requires` to force a call.** It hides the tool until its prerequisite ran. The model may still answer
  without calling anything. `endedByTool` tells your job whether the terminal tool ran.
- **A prerequisite from an earlier run.** `requires` counts the tools of this run only. A lookup in yesterday's run on
  the same thread does not unlock today's write.
- **The order only in the prompt.** A prompt rule is the hint; `requires` is the rule.
- **A write tool without a policy.** The order does not decide whether a call may run. A write with a large effect also
  needs an approval ([Human-in-the-loop approvals](060-human-in-the-loop-approvals.md)).
- **No room in the step limit.** Each tool call round is one step, and the closing sentence after a terminal tool is one
  more. Size `maxStepsPerRun` for the longest job.
- **A terminal tool that can fail silently.** A call that failed, timed out or was refused never ends the run. Throw on a
  failure so the model reads it and can recover.

## 5. Checklist

- [ ] Every write tool that depends on a read has a `requires` entry.
- [ ] The tool that completes the job has `endsRun`.
- [ ] The descriptions say the order too.
- [ ] `maxStepsPerRun` fits the longest job.
- [ ] The job reads `endedByTool` to know whether it finished.

## 6. Go further

- [Tools](../20-learn-the-gateway/030-tools.md): the path of a tool call, narrowing, failures.
- [How does a run end, and can a tool end it?](../10-getting-started/90-faq.md#how-does-a-run-end-and-can-a-tool-end-it)
- [Can a tool be offered only in some steps of a run?](../10-getting-started/90-faq.md#can-a-tool-be-offered-only-in-some-steps-of-a-run)
