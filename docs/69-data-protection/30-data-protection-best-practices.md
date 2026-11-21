---
sidebar_label: Data protection best practices
description: "Data protection best practices for LLM apps: sign the provider's terms, send the model less, keep memory and traces lean, delete on a schedule, test erasure."
keywords: [LLM data protection, AI privacy best practices, GDPR LLM, HIPAA AI, data minimisation, data retention, right to erasure, zero data retention, PII redaction, AI gateway]
---

# Data Protection Best Practices for LLM Applications: Minimise, Contract, Retain, Erase

An LLM application copies personal data into places a classic application does not have: the provider's systems, the
system prompt, a memory of the user, a trace of every model call. Each copy is one more place to secure, to answer an
access request from and to erase. The practices below keep those copies few and make every request a routine. They
build on the [tools of the gateway](20-data-protection-tools.md); the duties behind them are on
[GDPR, CCPA and HIPAA](10-gdpr-ccpa-hipaa.md).

## The problem

- Users paste whatever they have into a chat: names, health details, account numbers. The application did not ask for
  them and still holds them.
- One question can reach several models: the answer, a guardrail judge, the memory extraction, a summary, an embedding.
  Each call is a disclosure to the provider and an entry in the trace.
- Data that is kept "for debugging" without a period stays until someone deletes it, and every request to access or erase it grows with it.
- An erasure that runs on one instance while another still serves the user leaves data behind.

## The practice

1. **Contract before the first real prompt.** Sign the provider's data processing terms (a DPA under the GDPR, service
   provider terms under the CCPA, a BAA under HIPAA when prompts carry PHI). Choose the tier that does not train on API data, the region where
   the data must stay, and zero data retention where the provider offers it and the use case allows it
   ([the providers' terms](10-gdpr-ccpa-hipaa.md#7-the-llm-providers-terms)).
2. **Send the model only what the task needs.** A knowledge-base scope per call, a profile with only the tools the use
   case needs, and tools that return only the fields the answer uses. What the system prompt and the tools never carry
   cannot leak through the model.
3. **Stop the data the contract does not cover.** An input rule blocks a prompt with health data, a Social Security
   number or an account number where no BAA or legal basis covers it; redaction, where it is wanted, happens before the
   call ([block sensitive data](20-data-protection-tools.md#block-sensitive-data-before-the-model)).
4. **Remember only what the product needs.** Turn user memory on only where remembering serves the user, keep
   `rememberNeedsApproval` on, and show the facts on a "what you know about me" screen with the edit and delete actions
   ([decide what is remembered](20-data-protection-tools.md#decide-what-is-remembered)).
5. **Give every store a retention period.** Threads, runs, trace entries and files each get a period written down with
   its purpose, and a scheduled job deletes what is older
   ([delete conversations](20-data-protection-tools.md#delete-conversations)).
6. **Keep the trace lean.** Keep the metadata (model, usage, cost, ids) for as long as billing and audit need it, and the
   content only as long as debugging needs it, or not at all
   ([keep content out of the trace](20-data-protection-tools.md#keep-content-out-of-the-trace)).
7. **Run erasure as a procedure, not a call.** Stop the user's traffic on every instance, let the instances finish their
   work, erase in the gateway, erase in the stores the gateway does not reach, and record what was erased by counts, not
   by content (the code below).
8. **Choose delete or anonymize once, per purpose.** `deleteUserData` when nothing has to stay; `anonymizeUserData` when
   statistics, billing or audit need the rows, with the pseudonym discarded unless a law requires the link.
9. **Lock the administrative surface.** `trace`, `getPausedRun`, `delete`, `removeFilesByUser`, `deleteUserData`,
   `anonymizeUserData` and `kbIngestor` take raw ids and check no user: only an administrator's code path calls them.
10. **Put a person where the decision matters.** A decision made by the model alone with a legal or similarly
    significant effect (GDPR Art. 22), or a significant decision under the CCPA's ADMT rules, gets a human review of the
    answer (`reviewAnswers`) or an approval on the tool that acts (`approvals`)
    ([Data subject rights](10-gdpr-ccpa-hipaa.md#33-data-subject-rights),
    [ADMT](10-gdpr-ccpa-hipaa.md#44-automated-decision-making-risk-assessments-and-audits)).
11. **Tell people.** The interface says that an AI answers, unless the context already makes it obvious
    ([EU AI Act Art. 50](10-gdpr-ccpa-hipaa.md#6-the-eu-ai-act-tell-people-they-talk-to-an-ai)), and the privacy notice
    names the provider, the purposes, what is remembered and for how long.

## In code

An erasure request, end to end. Everything around the gateway's call is the application's: how it suspends an account,
how it knows the instances are idle, which other stores hold the user.

```ts
import {AIGateway, IForgetUserResult} from "dyna-ai-gateway";

declare const gateway: AIGateway; // your gateway
declare function suspendUser(args: { tenantId: string; userId: string }): Promise<void>; // every instance refuses the user from now on
declare function waitForOtherInstances(): Promise<void>; // each instance waits until no call of the user runs on it, then awaits gateway.whenIdle()
declare function eraseOutsideTheGateway(args: { tenantId: string; userId: string }): Promise<void>; // usage records, logs, analytics, backups by policy
declare function recordErasure(args: { tenantId: string; userId: string; result: IForgetUserResult }): Promise<void>; // the evidence
declare function sleep(ms: number): Promise<void>; // your timer

const isConflict = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && error.status === 409;

const handleErasureRequest = async ({tenantId, userId}: { tenantId: string; userId: string }): Promise<void> => {
  await suspendUser({tenantId, userId});

  let result: IForgetUserResult | null = null;
  for (let attempt = 1; result === null; attempt++) {
    try {
      await waitForOtherInstances(); // before every attempt: a call that just ended may have queued a memory update
      result = await gateway.deleteUserData({tenantId, userId});
    } catch (error) {
      if (!isConflict(error) || attempt === 5) throw error;
      await sleep(attempt * 10_000); // a call of the user still runs somewhere
    }
  }

  if (result === null) throw new Error("The erasure returned no result");
  await eraseOutsideTheGateway({tenantId, userId});
  await recordErasure({tenantId, userId, result}); // counts per store, no content
};
```

- The same person in another tenant is another call.
- The documents of the knowledge base have no user: a document that names the person is removed with
  `kbIngestor.removeDocument` and ingested again without the name.
- The provider's copies follow its retention terms; zero data retention reduces them, within the exceptions its terms
  list ([the providers' terms](10-gdpr-ccpa-hipaa.md#7-the-llm-providers-terms)).

## Pitfalls

- **Memory that was never decided.** The extraction stores facts in the background without asking; it is a product
  decision, not a default to accept.
- **The trace as a second chat history.** With the full request kept, the trace holds every prompt and answer, and every
  access and erasure request must cover it.
- **A judge that sees what the rule should stop.** A judge rule sends the prompt to a model. The application's input
  rules run in parallel, so a separate deterministic rule does not stop the judge: the deterministic check goes inside
  the judge rule, before it calls `judge`.
- **An erasure on one instance only.** Without the stop and the wait of the code above, a call or a memory update on another
  instance can write after the erasure.
- **The pseudonym stored next to the user's id.** The kept rows are then pseudonymised personal data, not anonymous.
- **A retention job that ignores busy threads.** `delete` skips a thread with a call running; the job runs again and
  takes it later.

## Go further

- The duties per law and the list of what stays the application's job:
  [What stays the application's job](10-gdpr-ccpa-hipaa.md#8-what-stays-the-applications-job).
- Each tool with its sample: [Data protection tools](20-data-protection-tools.md).
- The memory and its deletion actions: [User memory](../20-learn-the-gateway/090-user-memory.md).
- Rules on the prompt and the answer: [Guardrails](../20-learn-the-gateway/050-guardrails.md).
