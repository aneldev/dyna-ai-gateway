# Example: a human in the loop

A tool that changes something gets a **policy**. The policy decides, on the parsed input of each call, whether the tool
runs, is denied, or waits for a human. A call that waits pauses the run; nothing has run yet. A person decides later,
from another request, and the run resumes where it stopped. The `gateway` configuration is the one of
[Installation](20-installation.md).

```ts
import {z} from "zod";
import {AIGateway, defineTool, EGatewayResponseKind, EResumeAction, EToolCallVerdict} from "dyna-ai-gateway";

const postCreditNote = defineTool({
  name: "post_credit_note",
  description: "Posts a credit note against an invoice.",
  inputSchema: z.object({invoiceNo: z.string(), amount: z.number(), reason: z.string()}),
  tags: ["billing"],
  // Small amounts post at once; above the threshold the run pauses until a human decides
  policy: ({input}) => ({verdict: input.amount > 5_000 ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW}),
  execute: async ({input, userContext}) => ledger.postCreditNote(userContext.tenantId, input),
});

const gateway = new AIGateway({...config, toolRegistry: {tools: [getInvoice, postCreditNote]}});

const paused = await gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "Credit invoice 2024-1187 in full, the goods came back damaged.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

// paused.kind === EGatewayResponseKind.PAUSED: the model read the invoice, then asked to post 12 400 NOK.
// The application shows the card to an approver; nothing has been posted. Later, from another request:
if (paused.kind === EGatewayResponseKind.PAUSED) {
  const done = await gateway.resume({
    userContext: approverContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.pauseId,
    decisions: [{action: EResumeAction.APPROVE}], // or EDIT with a new input, or REJECT with a reason the model reads
  }).response;

  if (done.kind === EGatewayResponseKind.ANSWER) {
    done.text; // the model's closing answer, after the credit note was posted
  }
}
```

`getInvoice` is the tool of [Example: run](40-example-run.md).

## What happens

1. The model reads the invoice with `get_invoice`, then asks for `post_credit_note` with `amount: 12400`.
2. The policy returns `NEEDS_APPROVAL`. The run stops, is stored, and `response` settles as `PAUSED` with one envelope per
   waiting call: the tool call (name and input), the `runId`, the decisions allowed and when the pause expires.
3. Your application shows the envelope as a card. The paused run is stored, so it survives a restart of the server.
4. `resume()` with the approver's decision runs the tool (or not) and the loop goes on to the answer.

## The three decisions

| Decision  | What happens                                                             |
|-----------|--------------------------------------------------------------------------|
| `APPROVE` | the tool runs with the input the model asked for                         |
| `EDIT`    | the tool runs with the input the approver changed                        |
| `REJECT`  | the tool does not run; the model reads the reason and answers without it |

## The verdicts of a policy

| Verdict          | Effect                                      |
|------------------|---------------------------------------------|
| `ALLOW`          | the tool runs; the default without a policy |
| `DENY`           | the tool does not run; the model reads why  |
| `NEEDS_APPROVAL` | the run pauses until a human decides        |

A policy can also be a plain verdict (`policy: EToolCallVerdict.NEEDS_APPROVAL`) for a tool that always waits, and a
profile can require approval per tenant (`IAIProfile.approvals`). More: the [FAQ](90-faq.md#how-do-i-control-whether-a-tool-call-runs),
[several cards at once](90-faq.md#the-run-paused-with-several-cards-how-do-i-answer-them),
[a review of the answer](90-faq.md#how-do-i-have-a-human-review-the-answer-before-the-user-sees-it).

Next: [Vercel chat client](50-vercel-chat-client.md).
