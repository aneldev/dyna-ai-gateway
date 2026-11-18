---
sidebar_label: Structured output with zod
description: "Get reliable JSON from an LLM in TypeScript: describe the answer as a zod schema, receive a typed object validated before it is stored, and route a schema miss to a fallback instead of parsing text."
keywords: [LLM JSON output, structured output, zod, TypeScript, typed LLM response, LLM classification]
---

# Reliable JSON from LLMs: Structured Output with Zod Schemas

When code acts on the answer (route a ticket, mark invoice lines, fill a form), the answer must be data, not a paragraph.
Asking the model for "JSON only" and parsing the text breaks on the first answer that adds a sentence or renames a field.
The practice is to declare the shape as a schema, let the provider produce it, validate it before anything is stored, and
handle the answer that does not fit.

## 1. The problem

- A regular expression over the answer text breaks when the model changes its wording.
- `JSON.parse` succeeds on an object with a missing field or a value outside the expected set, and the error surfaces
  later, far from the call.
- A classifier forced to choose among the expected classes picks one even when none fits.

## 2. The practice

1. **The schema is the contract.** Pass a zod schema as `outputSchema`. The gateway asks the provider for output in that
   shape, validates the answer against it, and returns it typed as `structured`.
2. **Closed sets are enums.** A class, a priority or a team is a `z.enum`, so the answer can only be one of the values your
   code handles.
3. **Give the model a way out.** Add an `other` or `unknown` value, so a request that fits no class is not forced into one.
4. **Describe the fields.** `.describe()` on a field tells the model what the field means, as a field description of the
   schema.
5. **Handle the miss.** An answer that is not JSON or does not match ends the call as `FAILED` with the issue
   `output_invalid_json` or `output_schema`. Route it to a fallback, such as a human queue, instead of guessing.
6. **Check what the schema cannot.** A schema checks the shape, not the business rule ("no line listed twice"). An output
   rule reads the parsed value and blocks an answer that breaks the rule.

## 3. In code

The samples run on your `gateway` and the caller's `userContext`. The setup they need is in the learning path
[Classify and route requests](../24-learning-paths/090-classify-and-route-requests.md).

Classify a message and route it:

```ts
import {z} from "zod";
import {AIGateway, EGatewayResponseKind, IUserContext} from "dyna-ai-gateway";

declare const gateway: AIGateway;        // your gateway
declare const userContext: IUserContext; // who asks
declare const message: string;           // the customer's text
declare const queues: {refunds(text: string): Promise<void>; orders(text: string): Promise<void>; humans(text: string): Promise<void>};

const triage = z.object({
  intent: z.enum(["refund", "order_status", "other"]).describe("What the customer wants; `other` when nothing fits"),
  summary: z.string().max(200).describe("One line for the agent who picks up the message"),
});

const result = await gateway.ask({
  userContext,
  profileId: "triage",
  prompt: message,
  outputSchema: triage,
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.ANSWER && result.structured) {
  const {intent} = result.structured; // typed: "refund" | "order_status" | "other"
  if (intent === "refund") await queues.refunds(message);
  else if (intent === "order_status") await queues.orders(message);
  else await queues.humans(message);
}

if (result.kind === EGatewayResponseKind.FAILED) await queues.humans(message); // output_schema, output_invalid_json, or another failure
```

A business rule on the parsed value, as an output rule in the gateway's configuration:

```ts
import {EIssueSeverity, IIssue, IOutputRule} from "dyna-ai-gateway";

const missingVat = z.object({lines: z.array(z.object({lineNo: z.number(), reason: z.string()}))});

const uniqueLines: IOutputRule = {
  name: "unique_lines",
  check: async ({evidence}): Promise<IIssue[]> => {
    const parsed = missingVat.safeParse(evidence.output);
    if (!parsed.success) return []; // another call's answer: not this rule's shape
    const lineNos = parsed.data.lines.map(line => line.lineNo);
    return new Set(lineNos).size === lineNos.length
      ? []
      : [{code: "duplicate_line", message: "The answer lists a line twice", severity: EIssueSeverity.ERROR, field: "lines"}];
  },
};
```

A run that pauses for a human stores no schema, because a zod schema is code. The resume passes it again:

```ts
import {EResumeAction, IPausedResponse} from "dyna-ai-gateway";

declare const paused: IPausedResponse; // the PAUSED response of a run with outputSchema: missingVat

const resumed = await gateway.resume({
  userContext,
  runId: paused.envelopes[0].runId,
  pauseId: paused.pauseId,
  decisions: [{action: EResumeAction.APPROVE}], // one envelope; several need one decision each, by `callId`
  outputSchema: missingVat, // without it, the resumed answer is plain text
}).response;
```

## 4. Pitfalls

- **No way out in the enum.** A classifier without `other` puts the unclassifiable message into a real queue.
- **Treating `FAILED` as an exception.** A schema miss is a normal outcome. Give it a path in your code.
- **Forgetting `outputSchema` on `resume()`.** The resumed answer is then plain text.
- **A schema that only the model could fill.** A field that needs data the model was not given is invented. Pass the
  data in `context`, or leave the field to your code.
- **`outputFormat` with a schema.** It is ignored: the schema fixes the shape.

## 5. Checklist

- [ ] The answer your code acts on has an `outputSchema`.
- [ ] Closed sets are `z.enum`, with a value for "none of these".
- [ ] Fields whose meaning is not obvious carry `.describe()`.
- [ ] A `FAILED` answer has a fallback path.
- [ ] Business rules on the value are output rules.

## 6. Go further

- [Guardrails: Structured output](../20-learn-the-gateway/050-guardrails.md#24-structured-output): how the answer is
  validated, and the issues of a miss.
- [Fill a form by conversation](../24-learning-paths/120-fill-a-form-by-conversation.md): a schema filled over several
  messages.
- [Extract data from files](../24-learning-paths/070-extract-data-from-files.md): a schema over an uploaded PDF or image.
