# Example: run

`run()` is an agent loop: the model may call your tools, read their results and call again, until it answers or the
profile's step limit is reached. The application does not write the loop. The `gateway` configuration is the one of
[Installation](20-installation.md); the `userContext` is the one of [Example: ask](30-example-ask.md).

```ts
import {z} from "zod";
import {AIGateway, defineTool, EGatewayResponseKind} from "dyna-ai-gateway";

const getInvoice = defineTool({
  name: "get_invoice",
  description: "Returns an invoice by its number.",
  inputSchema: z.object({invoiceNo: z.string()}),
  tags: ["billing"],
  execute: async ({input, userContext}) => invoices.load(userContext.tenantId, input.invoiceNo),
});

const gateway = new AIGateway({...config, toolRegistry: {tools: [getInvoice]}});

const result = await gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "What is the total of invoice 2024-1187, and is it paid?",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.ANSWER) {
  result.text; // the model's answer, written from what get_invoice returned
}
```

## What happens in the run

1. The model reads the question and the tools the profile allows (`allowedTools: ["get_invoice", ...]`).
2. It asks for `get_invoice` with `{invoiceNo: "2024-1187"}`. The gateway parses the input against the schema and runs
   `execute` with the caller's `userContext`.
3. The result goes back to the model, which answers. Each step is a model call: usage-checked, traced, streamed as events
   (`TOOL_REQUEST`, `TOOL_RESULT`, `TEXT_DELTA`, `STEP_END`).

## A tool

| Field         | Why                                                                                                     |
|---------------|---------------------------------------------------------------------------------------------------------|
| `name`        | what the model calls; the profile's `allowedTools` lists it                                             |
| `description` | what the model reads to decide when to call it                                                          |
| `inputSchema` | a zod schema; the model's input is parsed against it before `execute` runs                              |
| `tags`        | free tags for your own code (grouping, an admin list), e.g. `"billing"`; the gateway does not read them |
| `execute`     | your function; it receives the parsed input and the caller's `userContext`                              |
| `policy`      | optional: allow, deny or hold each call for a human (next chapter); without one, a call runs            |

A tool that reads is safe to run on its own. A tool that changes something needs a policy:
[Example: a human in the loop](45-example-HITL.md).
