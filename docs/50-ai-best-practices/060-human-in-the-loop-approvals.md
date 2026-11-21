---
sidebar_label: Human-in-the-loop approvals
description: "Human-in-the-loop for AI agents in TypeScript: decide per tool call whether it runs, waits for a human or is refused, render the approval card from data, resume from another request, and expire the pauses nobody answered."
keywords: [human in the loop, HITL, AI agent approval, tool approval, agentic AI, LLM agent safety, TypeScript]
---

# Human-in-the-Loop AI Agents: Approve Risky Tool Calls Before They Run

An agent that can post a credit note, send an email or delete a record will one day do it with the wrong input. The
practice is to decide, for each call and on its actual input, whether it runs, waits for a person or is refused, and to
make the wait a stored state that any server instance can continue hours later.

## The problem

- Approving every call invites approval fatigue: people click "approve" without reading. Approving none lets a wrong call through.
- A wait implemented as an open request or a process in memory is lost at the next deploy.
- The approver is often not the asker, and two approvers who click at once can run the call twice.

## The practice

1. **Decide on the input.** The tool's `policy` is a function of the parsed input: a small amount runs, a large one waits
   for a human, an impossible one is refused with a reason the model reads. The decision runs before `execute`, outside
   the tool's own code.
2. **A floor per profile.** The profile's `approvals` lists the tools that wait on this profile even when their
   policy allows the call; a profile without the entry runs them as their policy says. A refusal still wins: a human is never asked to approve a call that would be refused.
3. **The card is data.** A pause returns envelopes with the tool name, the input and your `reasonCode`. Your UI renders the
   card in its own language.
4. **The approver may edit.** An edited input goes through the policy again, so an edit cannot push through what the
   policy refuses.
5. **The wait is stored.** A paused run is a record in your run repository. Any instance resumes it with the `pauseId` of
   the pause; of two resumes at once, one wins and the other gets a 409, so the call runs once.
6. **Your endpoint checks who approves.** `resume()` checks the tenant, and that the approver's permissions unlock the
   pending tool (otherwise a 400, and the run stays paused). It knows no roles: the approver's role is checked in your
   code before the call.
7. **One decision per card.** A step can hold several calls back at once (two refunds), so a pause can carry several
   cards. `resume()` takes one decision per card, named by its `callId`.
8. **Pauses expire.** A scheduled job closes the pauses past their expiry, so a thread is never blocked for good.

## In code

The samples run on your configuration and on the asker's and the approver's `IUserContext`. The setup they need is in the
learning path [Keep a human in control](../24-learning-paths/030-keep-a-human-in-control.md).

The policy of a refund tool, decided on the amount:

```ts
import {z} from "zod";
import {
  AIGateway,
  EGatewayResponseKind,
  EPauseKind,
  EResumeAction,
  EToolCallVerdict,
  IAIGatewayConfig,
  IUserContext,
  TToolCallPolicyResult,
  defineTool,
} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;       // your configuration, with a database run repository
declare const userContext: IUserContext;      // the asker
declare const approverContext: IUserContext;  // the approver
declare const payments: {refund(args: {tenantId: string; orderId: string; amountCents: number}): Promise<{refundId: string}>};

const refundOrder = defineTool({
  name: "refund_order",
  description: "Refunds an amount in cents on one order. Returns {refundId}.",
  inputSchema: z.object({orderId: z.string(), amountCents: z.number().int().positive()}),
  tags: ["billing", "write"],
  policy: ({input}): TToolCallPolicyResult => {
    if (input.amountCents > 100_000) {
      return {verdict: EToolCallVerdict.DENY, reason: "Refunds above 1000 EUR are handled by finance. Tell the customer."};
    }
    if (input.amountCents > 10_000) {
      return {
        verdict: EToolCallVerdict.NEEDS_APPROVAL,
        reasonCode: "amountOverLimit", // a key of your translations, for the card
        rejectionText: "The support agent declined the refund; nothing was refunded.",
      };
    }
    return {verdict: EToolCallVerdict.ALLOW};
  },
  execute: async ({input, userContext: caller}) => payments.refund({tenantId: caller.tenantId, ...input}),
});

const gateway = new AIGateway({...config, toolRegistry: {tools: [refundOrder]}});
```

The asker's request pauses; the screen renders the card from the envelope:

```ts
const asked = await gateway.run({
  userContext,
  profileId: "support", // allows refund_order
  prompt: "Order 88231 arrived broken, refund the 240 EUR.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (asked.kind === EGatewayResponseKind.PAUSED) {
  for (const card of asked.envelopes) {
    if (card.kind === EPauseKind.TOOL_APPROVAL) console.log(card.callId, card.toolCall.toolName, card.toolCall.input, card.reasonCode);
  }
}
```

The approver's endpoint, a separate request, possibly on another server instance:

```ts
declare function mayApproveRefunds(user: IUserContext): boolean; // your roles

const approve = async (runId: string, pauseId: string, callIds: string[]): Promise<void> => {
  if (!mayApproveRefunds(approverContext)) throw new Error("Not allowed to approve refunds"); // the gateway does not know your roles
  const resumed = await gateway.resume({
    userContext: approverContext, // the tool runs with the approver's context
    runId,
    pauseId,                      // the pause the cards were rendered for
    decisions: callIds.map(callId => ({callId, action: EResumeAction.APPROVE})), // one per card
  }).response;
  // resumed can be PAUSED again: handle it like the response of run()
};
```

The expiry job, in your scheduler (one instance runs it, and one run at a time):

```ts
declare const tenantIds: string[]; // your tenants

const closeStalePauses = async (): Promise<void> => {
  for (const tenantId of tenantIds) {
    try {
      await gateway.expirePausedRuns({tenantId}); // closes the pauses past humanGate.timeoutMs
      await gateway.recoverStuckRuns({tenantId}); // fails the resumed runs a crashed server left RUNNING
    } catch (error) {
      console.error("pause cleanup failed", {tenantId, error}); // the next tenant still runs
    }
  }
};
```

## Pitfalls

- **Approval on every call.** People stop reading. Let small, reversible calls run; hold the large ones.
- **Authorisation in the description.** "Only for admins" in the text does not stop the model. Use the policy, the
  profile's `allowedTools` and `toolPolicy.permissionsToTools`.
- **The in-memory run repository in production.** A restart loses every paused run, and a second instance cannot see them.
- **A stale `pauseId`.** A resume may pause again with a new `pauseId`. Use the one of the card the user saw.
- **No expiry job.** A paused run blocks its thread until it is resumed, cancelled or expired.
- **The card worded from `rejectionText`.** That text is for the model. The card renders from the tool name, the input and
  `reasonCode`.

## Checklist

- [ ] Every tool with a side effect has a `policy`.
- [ ] Tenants that want a human on a tool list it in the profile's `approvals`.
- [ ] Paused runs are stored in a database `IRunRepository`.
- [ ] The approve endpoint checks the approver's role before `resume()`.
- [ ] `expirePausedRuns` and `recoverStuckRuns` run on a schedule.

## Go further

- [Human in the loop](../20-learn-the-gateway/040-human-in-the-loop.md): the pause kinds, the decisions, the run
  repository.
- [Make the agent ask instead of guess](100-ask-instead-of-guess.md): the pause for a question to the user.
- [How do I have a human review the answer before the user sees it?](../10-getting-started/90-faq.md#how-do-i-have-a-human-review-the-answer-before-the-user-sees-it)
