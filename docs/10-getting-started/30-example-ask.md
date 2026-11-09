# Example: ask

`ask()` returns one answer on a thread. The application hands the gateway what the user asked and what the screen knows;
the answer comes back as text or as a typed object. The `gateway` is the one of [Installation](20-installation.md).

```ts
import {z} from "zod";
import {EGatewayResponseKind, ELLMClientEventKind, IUserContext} from "dyna-ai-gateway";

const userContext: IUserContext = {
  tenantId: "acme",
  userId: "u-17",
  permissions: [],
  locale: "en-GB",
  timezone: "Europe/Oslo",
  now: new Date(),
};

const {events, response} = gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Which lines of this invoice are missing a VAT code?",
  context: JSON.stringify(invoice), // what the user is looking at
  outputSchema: z.object({lines: z.array(z.object({lineNo: z.number(), reason: z.string()}))}),
  kbFilters: {libraryIds: [], bookIds: []}, // no knowledge base for this call
});

for await (const event of events) {
  if (event.kind === ELLMClientEventKind.TEXT_DELTA) process.stdout.write(event.text ?? "");
}

const result = await response;
if (result.kind === EGatewayResponseKind.ANSWER) {
  result.structured; // {lines: [...]}, validated against the schema
  result.citations;  // the ids of the knowledge-base chunks the model was given
  result.threadId;   // pass it on the next call to continue the conversation
  result.usage;      // the tokens of the call and their cost
}
if (result.kind === EGatewayResponseKind.FAILED) {
  result.issues;     // why: a usage adapter that refused, a guardrail, a timeout, the provider
}
```

## What happens in the call

1. The gateway loads the profile `accounting`, its model and the thread (a new one, since no `threadId` was given).
2. It asks the usage adapter whether the call may run.
3. It assembles the system prompt (template, profile addendum, the call's `context`) and sends it with the question.
4. The model's answer streams as `TEXT_DELTA` events, is validated against `outputSchema`, stored on the thread and traced.

## The parts of the call

| Field          | Why                                                                                         |
|----------------|---------------------------------------------------------------------------------------------|
| `userContext`  | who calls, as your host authenticated them; every store is keyed by its `tenantId`          |
| `profileId`    | the model, the addendum and the limits of the use case                                      |
| `prompt`       | what the user asked                                                                         |
| `context`      | what the screen knows; the model reads it, the thread does not keep it                      |
| `outputSchema` | optional: a zod schema; the answer is then `structured`, typed and validated                |
| `kbFilters`    | where the knowledge base may search; empty lists when the call needs none                   |
| `threadId`     | optional: continue a conversation; the gateway adds the history the profile's memory allows |

Streaming is optional: a call that does not read `events` awaits `response` alone.

Next: [Example: run](40-example-run.md).
