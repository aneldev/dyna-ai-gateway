# Skills

A skill is a block of instructions that the model reads only when a task needs it: a refund policy, an escalation
procedure, the steps of a wizard. The system prompt carries a one-line description of every skill. The model loads the
full text, the body, only for the calls that need it. Long rules that only a few calls need therefore stop costing tokens
on every call.

## 1. About

| Field         | What the model does with it                                            | Cost                             |
|---------------|------------------------------------------------------------------------|----------------------------------|
| `name`        | loads the skill by it                                                  | a few tokens, every `run()` call |
| `description` | decides from it whether the task needs the skill                       | one line, every `run()` call     |
| `body`        | follows it once loaded: Markdown instructions, as long as they need be | only the calls that load it      |

A skill is data ([`ISkill`](../30-api/index/interfaces/ISkill.md)), not a file and not code. It comes from two places:

| Source      | Property                                                                                                                            | Lifetime                          | Typical content                                        |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------|--------------------------------------------------------|
| The profile | [`IAIProfile.skills`](../30-api/index/interfaces/IAIProfile.md)                                                                     | every call on the profile, stored | the procedures of the role (refunds, escalation)       |
| The call    | `skills` of [`ask()`](../30-api/index/interfaces/IGatewayAskInput.md) and [`run()`](../30-api/index/interfaces/IGatewayRunInput.md) | this call, and its paused run     | what the screen the user is on knows (a wizard's help) |

The gateway's config holds no skills, only the caps that apply to all of them (`skillRegistry`, chapter 2.4).

## 2. Logic

### 2.1 In a `run()`: listed, then loaded

1. The gateway merges the skills, the profile's first and then the call's, into one list.
2. The `{skills}` slot of the system prompt lists them, one `- name: description` line each. A short header tells the
   model to load a skill before it acts on the topic.
3. The call gets the built-in tool `dyna_aigw_load_skill`. Its `name` input is an enum of the call's skill names, so the
   model can only ask for a skill the call has.
4. The model calls `dyna_aigw_load_skill({name})`. The result is `{name, body}`
   ([`ILoadSkillResult`](../30-api/index/interfaces/ILoadSkillResult.md)) and is stored in the thread like any tool result.
5. The model follows the body and goes on: it calls other tools or answers.

A load is one model step and counts toward the profile's `limits.maxStepsPerRun`. The tool always runs: it never pauses,
never ends the run and is offered on every step.

### 2.2 In an `ask()`: inlined

An `ask()` offers no tools, so the model cannot load anything. The bodies of every skill are written into the system
prompt, each one under a `## name` heading. The call costs the full bodies, and the model reads all of them.

### 2.3 Without skills

When neither the profile nor the call has skills, the `{skills}` slot renders to nothing and `dyna_aigw_load_skill` is
not offered.

### 2.4 Validation and caps

The gateway checks the merged list at two points: when a profile is saved (`upsertProfile`, the profile's skills) and when
a call starts (the profile's and the call's skills together). A failed check is a 400, and nothing is stored.

| Rule                                                                      | Error `data`                      |
|---------------------------------------------------------------------------|-----------------------------------|
| Every `name` is non-empty after a trim                                    | `emptyNames` (a count)            |
| Every `name` is unique across the profile's and the call's skills         | `duplicates` (the names)          |
| At most `skillRegistry.maxSkills` skills (default 50)                     | `maxSkills`, `count`              |
| At most `skillRegistry.maxBodyChars` characters per body (default 50 000) | `maxBodyChars`, `skill`, `length` |

### 2.5 The prompt cache

The `{skills}` slot is in the stable block of the system prompt, before `{cacheBreakpoint}`, so a profile's skills are
cached with the template and the addendum. When a call passes its own `skills`, the stable block changes: calls with the
same skill set share one cache entry, and a different set writes a new one. See
[System prompt layers](../60-architecture/40-system-prompt-production-layers.md#the-layers-in-the-order-the-model-reads-them).

### 2.6 A paused run

A run that pauses for a human stores the skills its call brought. `resume()` takes no `skills`. It offers the stored ones
again, together with the skills of the profile the run resumes on. When the run resumes on another profile, a name that
is in both lists is a 400, and the run stays paused. The stored system prompt keeps the list the run started with. If the
model loads a name that is listed there but no longer offered, it gets an invalid-input tool result, and the call goes on.

## 3. Examples

The `config` and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md).

### 3.1 Skills on a profile

```ts
import {AIGateway, IAIProfile, ISkill} from "dyna-ai-gateway";

const refundPolicy: ISkill = {
  name: "refund_policy",
  description: "The refund rules of the shop: deadlines, amounts, who approves. Load it before you promise or refuse a refund.",
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
  description: "When and how to hand a case to a human agent. Load it when the customer asks for a manager or threatens legal action.",
  body: "# Escalation\n\nApologise once, summarise the case in three lines, and give the ticket number of the hand-over.",
};

const supportProfile: IAIProfile = {
  id: "support",
  tenantId: "acme",
  name: "Customer support",
  modelId: "gpt-5-mini",
  promptAddendum: "You answer the customers of the Acme web shop. Be brief.",
  allowedTools: ["get_order"],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
  skills: [refundPolicy, escalation],
};

const gateway = new AIGateway(config);
await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: supportProfile});

const {response} = gateway.run({
  userContext,
  profileId: "support",
  prompt: "Order 88231 arrived broken. I want my 640 EUR back.",
  kbFilters: {libraryIds: [], bookIds: []},
});
// The model reads the two descriptions, calls dyna_aigw_load_skill({name: "refund_policy"}),
// then answers with the 14-day rule and the team-lead approval.
```

### 3.2 A skill on the call

The screen knows which flow the user is in, and the profile does not. The skill travels with this call only.

```ts
import {ISkill} from "dyna-ai-gateway";

const exportWizard: ISkill = {
  name: "export_wizard",
  description: "The steps and limits of the CSV export the user is in.",
  body: "# CSV export\n\nStep 1 picks the columns (at most 40), step 2 the delimiter, step 3 starts the export by email.",
};

const {response} = gateway.run({
  userContext,
  profileId: "support",
  prompt: "Why can't I add more columns?",
  skills: [exportWizard], // listed after the profile's refund_policy and escalation
  kbFilters: {libraryIds: [], bookIds: []},
});
```

### 3.3 The same skills in an `ask()`

```ts
const {response} = gateway.ask({
  userContext,
  profileId: "support",
  prompt: "Why can't I add more columns?",
  skills: [exportWizard],
  kbFilters: {libraryIds: [], bookIds: []},
});
// No tool and no extra step. The bodies of refund_policy, escalation and export_wizard are in the system prompt.
```

### 3.4 The caps

```ts
import {AIGateway} from "dyna-ai-gateway";

const gateway = new AIGateway({
  ...config,
  skillRegistry: {
    maxSkills: 10,         // the profile's and the call's skills together
    maxBodyChars: 10_000,  // one body; split a longer procedure into skills the model loads separately
  },
});
```

### 3.5 A refused list

`upsertProfile` throws the 400. A call rejects its `response` with it before anything is stored, so no thread or run is
created.

```ts
try {
  await gateway.run({
    userContext,
    profileId: "support",
    prompt: "Refund order 88231",
    skills: [{...refundPolicy, description: "Another text under the same name"}], // refund_policy is on the profile
    kbFilters: {libraryIds: [], bookIds: []},
  }).response;
} catch (error) {
  // error.status === 400, error.data.duplicates: ["refund_policy"]
}
```

## 4. Pitfalls

- **A vague description.** The model chooses a skill only from its description. "Refunds" gets loaded too often or too
  rarely. Say what the skill covers and when to load it, in one or two sentences.
- **A rule for every call as a skill.** The model may skip the load, and the rule is then missing. A rule that must apply
  to every call belongs in `promptAddendum`. A rule for this one call belongs in `instructions`
  ([Which layer to use](../60-architecture/40-system-prompt-production-layers.md#which-layer-to-use)).
- **Data as a skill.** A skill holds instructions. What the user is looking at belongs in `context`, and documents belong
  in the knowledge base.
- **Many bodies in an `ask()`.** Every body is inlined on every `ask()`. A profile with long skills used mainly through
  `ask()` pays for all of them on every call.
- **No room for the load.** A load is a step. With `maxStepsPerRun: 1` the model can load a skill, but it has no step
  left to act on it.
- **Naming `dyna_aigw_load_skill` in `activeTools`.** It is a built-in: it is offered whenever the call has skills, and
  `activeTools` does not select it. Naming it there is a 400, the same as for any tool the profile does not allow.
- **A stored `CHAT_MAIN` template without `{skills}`.** The skills of the call are dropped, and the response carries the
  WARNING issue `skills_slot_missing`. Keep the placeholder after `{addendum}` and before `{cacheBreakpoint}`.
- **Showing the load as an action.** A chat screen that renders every `TOOL_REQUEST` also shows
  `dyna_aigw_load_skill`. Every built-in tool name starts with `BUILT_IN_TOOL_NAME_PREFIX` (`"dyna_aigw_"`), so a UI can
  filter on it.

## 5. Summary

- A skill is `{name, description, body}`, on the profile (stored) or on the call (this call and its paused run).
- `run()`: the description is in the prompt, and the body is loaded with `dyna_aigw_load_skill`, one step per load.
- `ask()`: the bodies are inlined. There is no tool and no extra step.
- Names are unique and non-empty across both lists, within `maxSkills` and `maxBodyChars`. A failed check is a 400 before
  anything is stored.
- The decision behind the feature is
  [D124](../60-architecture/90-decisions.md#d124-skills-instructions-the-model-loads-on-demand).

## 6. FAQ

**Does the model always load the skill it needs?**
It loads a skill when the description matches the task, and the tool description tells it not to guess a skill's content.
The model decides, not the gateway. A rule that must never be skipped goes in `promptAddendum`.

**Can the model load the same skill twice?**
Yes. Each load returns the body again, and each one is a step. The tool description asks the model to load a skill once
per run.

**Can the model load a skill of another profile or tenant?**
No. The tool's input is an enum of this call's skill names. A different name fails the schema, and the model gets an
invalid-input tool result.

**Are skills stored in the thread?**
The body that a load returns is stored as the tool result, so later turns of the thread can still read it within the
working memory's window. The skill list itself is not stored in the thread.

**How do I change a profile's skills?**
Save the whole profile again with `upsertProfile`. Other instances see the change after their profile cache expires. A
paused run resumes with the skills of the profile as it is stored at that time.

**Skills or tools?**
A tool does something: it reads or changes data. A skill tells the model how to behave. A refund needs both: the
`refund_policy` skill says when a refund is allowed, and the `refund` tool posts it.

## 7. API reference

| Symbol                                                                             | What it is                                                  |
|------------------------------------------------------------------------------------|-------------------------------------------------------------|
| [`ISkill`](../30-api/index/interfaces/ISkill.md)                                   | the skill: `name`, `description`, `body`                    |
| [`IAIProfile.skills`](../30-api/index/interfaces/IAIProfile.md)                    | the profile's skills                                        |
| [`IGatewayAskInput.skills`](../30-api/index/interfaces/IGatewayAskInput.md)        | the call's skills, `ask()` and `run()`                      |
| [`IAIGatewayConfig.skillRegistry`](../30-api/index/interfaces/IAIGatewayConfig.md) | the caps                                                    |
| [`ISkillRegistryConfig`](../30-api/index/interfaces/ISkillRegistryConfig.md)       | `maxSkills`, `maxBodyChars`                                 |
| [`ILoadSkillInput`](../30-api/index/interfaces/ILoadSkillInput.md)                 | the input of `dyna_aigw_load_skill`                         |
| [`ILoadSkillResult`](../30-api/index/interfaces/ILoadSkillResult.md)               | its result, `{name, body}`                                  |
| [`ISkillRegistry`](../30-api/index/interfaces/ISkillRegistry.md)                   | the contract to pass in `overrides` to replace the registry |
