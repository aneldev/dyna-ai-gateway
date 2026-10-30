# Skills: instructions the model loads when a task needs them

A skill is a named block of instructions the model reads only when the task at hand calls for it: a refund policy, an
escalation procedure, the steps of the wizard the user is in. The system prompt carries every skill's name and a one-line
description; the body stays out of the prompt until the model asks for it
([D124](../architecture/Decisions.md#d124-skills-instructions-the-model-loads-on-demand)).

```ts
import {ISkill} from "dyna-ai-gateway";

const refundPolicy: ISkill = {
  name: "refund_policy",
  description: "The refund rules of the shop: deadlines, exceptions, who approves",
  body: "# Refund policy\n\nA refund is granted within 14 days of delivery. Above 500 EUR …",
};
```

## 1. Where a skill lives

| On                                  | For                                                             | Example                                                           |
|-------------------------------------|-----------------------------------------------------------------|-------------------------------------------------------------------|
| the profile, `IAIProfile.skills`    | every call of the profile: the procedures of a role             | the refund policy and the escalation procedure of a support agent |
| the call, `IGatewayAskInput.skills` | this one call: what the screen or the flow the user is in knows | the steps and limits of the export wizard the user has open       |

The model reads one list: the profile's skills first, then the call's. The profile's skills are stored with the profile:

```ts
await gateway.aiProfileStore.upsertProfile({
  tenantId: "acme",
  profile: {
    ...profile,
    skills: [refundPolicy, escalationProcedure],
  },
});
```

The call's skills travel with the call:

```ts
const {response} = gateway.run({
  userContext,
  profileId: "support",
  prompt: "The export stops at step 2, what now?",
  skills: [exportWizard],
  kbFilters: {libraryIds: [], bookIds: []},
});
```

Skills are not a rule of every call: what the model must always follow is `promptAddendum` on the profile and
`instructions` on the call. A skill is what it should read **only when the task needs it**.

## 2. `run()` and `ask()` read a skill differently

| Call    | In the system prompt                                     | How the body reaches the model                                                                                                   |
|---------|----------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `run()` | a list: one `- name: description` line per skill         | the built-in tool `load_skill` (`{name}` in, `{name, body}` out); one model step per load, counted under `limits.maxStepsPerRun` |
| `ask()` | every skill as a `## name` section with its body, inline | an `ask()` has no tools, so there is nothing to load from; the body is paid on this call                                         |

Without skills nothing is listed and no tool is offered. `load_skill` is a built-in: it is offered whenever the call has skills,
the profile's `allowedTools` does not list it and `activeTools` cannot name it (a 400, as for any tool the profile does not
list). Its result is a tool result like any other: in the thread, in the events, in the trace.

## 3. What a skill costs

- **The description is paid on every call** of the profile, as one line of the system prompt. The list sits in the cached
  block of the prompt ([prompt caching](FAQ.md#is-the-system-prompt-cached-and-what-does-it-cost)), so on a provider that
  caches it is read from the cache.
- **The body is paid only by the calls that load it**: one model step for the load, then the body in the context of every
  later step of that run. In an `ask()` the body is paid on the call.
- A run that loads a skill it does not need wastes a step; the `load_skill` description tells the model to load only the
  skill the task needs, once per run. Keep the description honest about what the body covers: that is what the model
  decides on.

## 4. Names and limits

- A name is what the model loads the skill by. Unique across the profile's and the call's skills together, not empty;
  `snake_case` reads best for a model, as a tool name does.
- A duplicate or empty name is a 400 before anything is stored: at `upsertProfile` for the profile's list, and when the call
  starts for the profile's and the call's together. The error's `data` names the `duplicates` and counts the `emptyNames`.
- `IAIGatewayConfig.skillRegistry` holds two caps, checked at the same two moments: `maxSkills` (default 50, the profile's
  and the call's together; `data.maxSkills`, `data.count`) and `maxBodyChars` (default 50 000 characters of one body;
  `data.maxBodyChars`, `data.skill`, `data.length`). A long procedure splits into skills the model loads separately.

```ts
const config: IAIGatewayConfig = {
  ...rest,
  skillRegistry: {maxSkills: 10, maxBodyChars: 10_000},
};
```

## 5. A paused run keeps its skills

A run that pauses for a human stores the skills its call brought. On `resume()` the model can load them again, together with
the skills of the profile the run continues on, the one it started with or
[another one](FAQ.md#how-can-the-user-change-the-model). The system prompt of a run is fixed at its first step, so its list
stays the one of the start: a name listed there but no longer offered is an invalid-input tool result the model reads and
goes on from, not an error of the call.

## 6. The prompt template

The seed `CHAT_MAIN` template renders the skills in its `{skills}` slot, right after the addendum and inside the cached block
([the layers of the system prompt](../architecture/System%20prompt%20production%20layers.md)). An application that stores
its own `CHAT_MAIN` version must carry the placeholder: a version without it drops the skills of every call that has some,
and the response carries the WARNING issue `skills_slot_missing` naming the template version.

## 7. What a skill is not

- Not a file: a skill is three strings. The gateway reads nothing from disk and runs no script.
- Not a tool: a skill changes what the model knows, not what it can do. A procedure that needs an action still needs a tool.
- Not an allow-list: every skill of the profile and of the call is loadable by the model; what the model may not read does
  not belong in a skill.
