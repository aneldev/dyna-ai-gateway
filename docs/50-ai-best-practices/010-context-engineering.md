---
sidebar_label: Context engineering
description: "Context engineering for LLM apps in TypeScript: put each piece of information in its own layer of the system prompt (rules, per-call instructions, the record on screen as data, memory, documents) instead of one growing prompt."
keywords: [context engineering, prompt engineering, system prompt, LLM context, TypeScript, AI gateway]
---

# Context Engineering for LLM Apps: Give the Model the User's Screen, Not a Bigger Prompt

A model answers well when it sees the right information, labelled for what it is. Context engineering is the practice of
choosing what goes into each call and where: the product's rules, the rule of this one call, the record the user is
looking at, what the model should remember, and the documents. This page shows how to place each of them in its own layer
with `dyna-ai-gateway`.

## 1. The problem

The usual first version of an AI feature has one system prompt that grows with every request from the product team. The
invoice on screen is pasted into the user's question, a rule for one button is appended to the prompt of every call, and a
policy document is copied into the prompt "so the model knows it". The result:

- Every call pays for text that only a few calls need.
- The model cannot tell the application's rules from the data a user typed, so a value such as "ignore your rules" inside
  a pasted record reads like an instruction.
- A rule for one screen leaks into every other screen.
- The prompt changes on every call, so the provider's prompt cache never hits.

## 2. The practice

Give each kind of information its own layer. The gateway assembles the system prompt from these layers, in this order,
stable first:

| What you want the model to know                   | Where it goes               | Lifetime                                                                | The model reads it as |
|---------------------------------------------------|-----------------------------|-------------------------------------------------------------------------|-----------------------|
| The rules of the product or tenant, the tone      | `IAIProfile.promptAddendum` | every call of the profile                                               | instructions          |
| Long procedures that few calls need               | `skills`                    | a `run()` loads the body when a task needs it; an `ask()` gets it whole | instructions          |
| A rule for this one call ("at most five bullets") | `instructions`              | this call                                                               | instructions          |
| What the user is looking at (the open record)     | `context`                   | this call                                                               | data                  |
| Facts that hold across calls (the user's name)    | memory                      | the thread, the user                                                    | data                  |
| Documents to search (policies, manuals)           | the knowledge base          | searched per call                                                       | data, cited           |

The user's own words stay in `prompt`. They are the message, not part of the system prompt.

1. **One profile per behaviour.** A behaviour that differs (support, accounting, a classifier) is another profile, chosen
   per call with `profileId`, not an `if` in one prompt.
2. **The screen sends what it shows.** The code that renders the invoice also builds `context` from the same record. The
   model then answers about the invoice the user sees, not about an invoice it guessed.
3. **Data is labelled as data.** `context`, memory and knowledge-base excerpts reach the model under a label that says
   they are not instructions.
4. **Per-call text after the stable text.** The profile's layers come first and are the same on every call, so the
   provider can cache them. The per-call layers follow. The order is in
   [System prompt layers](../60-architecture/40-system-prompt-production-layers.md).

## 3. In code

The samples run on your `gateway` and the caller's `userContext`. The setup they need is in the learning path
[Answer a question](../24-learning-paths/010-answer-a-question.md).

The profile holds what is true for every call of this use case:

```ts
import {AIGateway, EGatewayResponseKind, IAIProfile, IUserContext} from "dyna-ai-gateway";

declare const gateway: AIGateway;        // your gateway, built once at startup
declare const userContext: IUserContext; // who asks, from your authentication

const accounting: IAIProfile = {
  id: "accounting",
  tenantId: "acme",
  name: "Accounting assistant",
  modelId: "gpt-5-mini",
  promptAddendum: "You assist the accounting team of a Norwegian company. Amounts are in NOK.", // every call
  allowedTools: [],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
};

await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: accounting});
```

The invoice screen sends the record it renders, and the rule of its button:

```ts
declare const invoice: {invoiceNo: string; lines: {lineNo: number; text: string; vatCode: string | null}[]}; // the record on screen

const result = await gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Is anything wrong with this invoice?",                                // the user's words
  context: JSON.stringify(invoice),                                             // what the user sees, as data
  instructions: "Answer in at most five bullet points. Name the line numbers.", // this button only
  kbFilters: {libraryIds: [], bookIds: []},                                     // no documents for this call
}).response;

if (result.kind === EGatewayResponseKind.ANSWER) console.log(result.text);
```

Neither `context` nor `instructions` is stored on the thread. A follow-up that still needs the invoice passes it again:

```ts
const followUp = await gateway.ask({
  userContext,
  profileId: "accounting",
  threadId: result.threadId,        // the earlier turns stay in view
  prompt: "And how do I fix line 3?",
  context: JSON.stringify(invoice), // the record again: context is per call
  kbFilters: {libraryIds: [], bookIds: []},
}).response;
```

## 4. Pitfalls

- **Documents to search in `context` or `instructions`.** They cost tokens on every call, are not searched and are not
  cited. Put them in the [knowledge base](../20-learn-the-gateway/070-knowledge-base.md). The one document a call is
  about (a contract to summarise) goes with the call as `context` or a file.
- **A rule that must always apply, as a skill.** The model may not load the skill. A rule for every call belongs in
  `promptAddendum`.
- **Expecting `context` to stay on the thread.** It is per call. The follow-up that needs it sends it again.
- **Per-call values in the addendum.** A date, a user name or a record in `promptAddendum` changes the stable layers on
  every call and turns the prompt cache off in practice. Per-call values go into `instructions` or `context`
  ([Prompt caching](110-prompt-caching.md)).
- **Trusting the label.** The "data, not instructions" label is wording, not a barrier. What an injected text can do is
  limited by the tools and the approvals ([Prompt injection defense](090-prompt-injection-defense.md)).
- **One profile with branches.** "If the user is on the invoice screen, …" in one prompt grows without limit. A second
  profile, or `instructions` from that screen, keeps each behaviour separate.

## 5. Checklist

- [ ] The product's rules are in the profile's `promptAddendum`, once.
- [ ] Each screen sends its record as `context` and its own rule as `instructions`.
- [ ] Documents are in the knowledge base, scoped per call with `kbFilters`.
- [ ] Nothing per call is in the profile.
- [ ] A different behaviour is a different profile.

## 6. Go further

- [System prompt layers](../60-architecture/40-system-prompt-production-layers.md): every layer, its slot and its label.
- [Example: ask](../10-getting-started/30-example-ask.md#the-parts-of-the-call): the fields of a call.
- [Generate content](../24-learning-paths/110-generate-content.md): emails and replies written from the screen's data.
