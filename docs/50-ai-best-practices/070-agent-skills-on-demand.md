---
sidebar_label: Agent skills on demand
description: "Progressive disclosure for LLM prompts: keep long procedures out of the system prompt as agent skills, list only their descriptions, and let the model load a skill's instructions when a task needs them. TypeScript examples."
keywords: [agent skills, progressive disclosure, system prompt size, prompt tokens, LLM agent instructions, TypeScript]
---

# Progressive Disclosure for LLM Prompts: Agent Skills Loaded on Demand

An assistant collects procedures: the refund policy, the escalation steps, the help of each wizard. Put all of them in
the system prompt and every call pays for all of them, and the model reads pages of rules that have nothing to do with the
question. The practice is progressive disclosure: the prompt carries one line per procedure, and the model loads the full
text only when the task needs it.

## 1. The problem

- The system prompt grows with every procedure, and so does the cost of every call.
- The rule that matters for this question is buried among rules that do not.
- A procedure that only one screen needs is sent with the calls of every screen.

## 2. The practice

1. **A skill per procedure.** A skill is a `name`, a `description` and a `body` of Markdown instructions.
2. **The description decides the load.** In a `run()` on a model that calls tools, the system prompt lists each skill as one `name: description`
   line. The model calls the built-in tool `dyna_aigw_load_skill` with the name and receives the body. Write the
   description as "what it covers, and when to load it".
3. **Role procedures on the profile, screen procedures on the call.** The profile's `skills` are the procedures of the
   use case. A call's `skills` are what the current screen knows, such as the steps of the wizard the user is in.
4. **Rules that always apply stay in the prompt.** A skill may not be loaded. A rule for every call belongs in the
   profile's `promptAddendum`; a rule for this call in `instructions`.
5. **Room for the load.** A load is one model step. Size the profile's `limits.maxStepsPerRun` so the model can load a
   skill and still act on it.

## 3. In code

The samples run on your `gateway` and the caller's `userContext`. The setup they need is in the learning path
[Let the model act](../24-learning-paths/020-let-the-model-act.md).

Two procedures of a support profile:

```ts
import {AIGateway, IAIProfile, ISkill, IUserContext} from "dyna-ai-gateway";

declare const gateway: AIGateway;        // your gateway
declare const userContext: IUserContext; // who asks

const refundPolicy: ISkill = {
  name: "refund_policy",
  description: "The refund rules: deadlines, amounts, who approves. Load it before you promise or refuse a refund.",
  body: [
    "# Refund policy",
    "",
    "- A refund is possible within 14 days of delivery.",
    "- Above 500 EUR a team lead approves; tell the customer it takes one working day.",
    "- Digital goods are refunded only when the download never started.",
  ].join("\n"),
};

const escalation: ISkill = {
  name: "escalation",
  description: "When and how to hand a case to a human agent. Load it when the customer asks for a manager.",
  body: "# Escalation\n\nApologise once, summarise the case in three lines, and give the ticket number of the hand-over.",
};

const support: IAIProfile = {
  id: "support",
  tenantId: "acme",
  name: "Customer support",
  modelId: "gpt-6.1-terra",
  promptAddendum: "You answer the customers of the Acme web shop. Be brief.", // applies to every call
  allowedTools: [],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000}, // room for a load and the answer
  skills: [refundPolicy, escalation],
};

await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: support});
```

The screen adds what only it knows:

```ts
const exportWizard: ISkill = {
  name: "export_wizard",
  description: "The steps and limits of the CSV export the user is in.",
  body: "# CSV export\n\nStep 1 picks the columns (at most 40), step 2 the delimiter, step 3 starts the export by email.",
};

const {response} = gateway.run({
  userContext,
  profileId: "support",
  prompt: "Why can't I add more columns?",
  skills: [exportWizard], // this call only, next to the profile's two
  kbFilters: {libraryIds: [], bookIds: []},
});
```

## 4. Pitfalls

- **A vague description.** "Refunds" is loaded too often or too rarely. Say what the skill covers and when to load it.
- **Skills in an `ask()`.** An `ask()` offers no tools, so the bodies of every skill are written into its prompt. A
  profile with long skills used mostly through `ask()` pays for all of them on every call.
- **Data as a skill.** A skill holds instructions. The record on screen is `context`; documents belong in the knowledge
  base.
- **A one-step run.** With `maxStepsPerRun: 1` the model can load a skill but has no step left to act on it.
- **Many different call skill sets on a cached profile.** A call's `skills` are part of the cached stable block. Each
  different set writes its own cache entry, so keep the sets per screen fixed.
- **Showing the load as an action.** A UI that renders every tool call also shows `dyna_aigw_load_skill`. Filter the
  built-in tools by `BUILT_IN_TOOL_NAME_PREFIX`.

## 5. Checklist

- [ ] Each long, occasional procedure is a skill with a "when to load it" description.
- [ ] Rules for every call are in `promptAddendum`, not in a skill.
- [ ] Screen-specific procedures come with the call's `skills`.
- [ ] `maxStepsPerRun` leaves a step for the load.

## 6. Go further

- [Skills](../20-learn-the-gateway/020-skills.md): the lifecycle, the caps, a paused run.
- [Context engineering](010-context-engineering.md): which layer each kind of information goes into.
- [Prompt caching](110-prompt-caching.md): the skills are cached with the stable part of the prompt; each different
  set of call skills writes its own cache entry.
