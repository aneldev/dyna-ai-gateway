![dyna AI Gateway logo](assets/dyna-ai-gateway%20banner.png)

<p align="center">
  <a href="https://aneldev.github.io/dyna-ai-gateway/"><strong>Documentation</strong></a>
  &nbsp;·&nbsp;
  <a href="https://aneldev.github.io/dyna-ai-gateway/docs/getting-started/README">Getting started</a>
  &nbsp;·&nbsp;
  <a href="https://aneldev.github.io/dyna-ai-gateway/docs/api/index/classes/AIGateway">API reference</a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/dyna-ai-gateway">npm</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dyna-ai-gateway"><img alt="npm version" src="https://img.shields.io/npm/v/dyna-ai-gateway"></a>
  <a href="https://aneldev.github.io/dyna-ai-gateway/"><img alt="docs" src="https://img.shields.io/badge/docs-aneldev.github.io-blue"></a>
  <a href="https://github.com/aneldev/dyna-ai-gateway/blob/main/LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>


# dyna-ai-gateway


A server-side TypeScript library that puts a language model inside a business application. The application calls
`ask()` for an answer or `run()` for an agent with tools; the gateway does the rest: prompt assembly, conversation
history, memory, knowledge base, tool policies, human approval, usage control, guardrails and tracing. Every provider is reached
through the [Vercel AI SDK](https://ai-sdk.dev); every store is behind an interface, with in-memory implementations
included.

```
 Application / Agent                 dyna-ai-gateway                              LLM providers
┌──────────────────┐   ask()    ┌───────────────────────────────────────┐        ┌─────────────┐
│  business logic  │   run()    │  prompt assembly · history · memory   │  AI    │  OpenAI     │
│  HTTP, UI, jobs  │ ────────▶  │  knowledge base · tools · policies    │  SDK   │  Anthropic  │
│                  │ ◀────────  │  human gate · usage · guardrails      │ ─────▶ │  Google     │
│  userContext     │  events    │  trace                                │        │  Mistral    │
│  (authenticated) │  response  └──────────────────┬────────────────────┘        │  Bedrock    │
└──────────────────┘                               │ repository / adapter        └─────────────┘
                                                   ▼ interfaces
                                    in-memory · MongoDB · PostgreSQL · S3
```

**No weirdos!**

> Nothing here is invented. It is the code every application around a model has to write anyway, written once and
> tested.

**Status: beta.** The API is considered stable and keeps improving; the documentation is being completed. Versions follow
[semver](https://semver.org); while the version is `0.x` a release may contain a breaking change, listed under *Breaking
changes* in the package's `CHANGELOG.md` with what breaks, the migration and an AI prompt that performs it. Every exported
symbol carries its JSDoc, so the editor shows the contract of each option.

| Quality             |                                                                    |
|---------------------|--------------------------------------------------------------------|
| Deterministic tests | 1000+, on a scripted model, no key needed                          |
| Real-provider tests | 30+, against OpenAI, Anthropic, Google, Mistral and Amazon Bedrock |
| Types               | `tsc` over sources and tests; non-null assertions are a lint error |

## Before you adopt it

| Question                          | Answer                                                                                                                                                                                                                                 |
|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Am I locked into one provider?    | No. Five providers; the model is chosen per call through the profile, so a thread can switch model between two calls.                                                                                                                  |
| Where does my data live?          | In your database. Every store is an interface (`IAIGatewayConfig.<store>.repository`); in-memory implementations are included.                                                                                                         |
| How does the model reach my code? | `defineTool`: a function with a zod schema and a policy that allows, denies or holds each call on its parsed input.                                                                                                                    |
| Can a human step in?              | Yes. A run pauses on a tool call or on the final answer; `resume()` takes approve, edit or reject.                                                                                                                                     |
| How do I control the spend?       | In your code. The gateway asks your usage adapter before every model call, with the tenant, user, profile, model, purpose and a token estimate, and reports what the call used after it. It holds no budget, plan or quota of its own. |
| Can I test without a real model?  | Yes. The agent loop runs on a scripted model; 1,086 of the tests do exactly that.                                                                                                                                                      |
| Does it fit my auth and tenants?  | The call carries the `userContext` your host authenticated; every store is keyed by its `tenantId`.                                                                                                                                    |

Every part of the gateway is a class with one job, held behind an interface. The second constructor argument takes your
own instance in place of any of them: a knowledge-base retriever on your search engine, a trace that writes to your
observability stack, a scripted model in a test. The rest of the gateway does not notice the swap.

```ts
const gateway = new AIGateway(config, {kbRetriever: new MyKbRetriever()});
```

The seams: [Live adjustment and dependency injection](docs/60-architecture/50-live-adjustment-and-dependency-injection.md).

## Install

```bash
pnpm add dyna-ai-gateway zod
```

Node.js 24 or newer. `zod` 4 is a peer dependency: the tools and the structured answers are typed with it.

## Ask: an answer on the application's data

The application hands the gateway what the user asked and what the screen knows; the answer comes back as text or as a
typed object.

```ts
import {z} from "zod";
import {AIGateway, EGatewayResponseKind} from "dyna-ai-gateway";

const gateway = new AIGateway(config); // the config: next section

const {response} = gateway.ask({
  userContext: {tenantId: "acme", userId: "u-17", permissions: [], locale: "en-GB", timezone: "Europe/Oslo", now: new Date()},
  profileId: "accounting",
  prompt: "Which lines of this invoice are missing a VAT code?",
  context: JSON.stringify(invoice), // what the user is looking at
  outputSchema: z.object({lines: z.array(z.object({lineNo: z.number(), reason: z.string()}))}),
  kbFilters: {libraryIds: ["vat-rules"], bookIds: []}, // the knowledge base this call may search
});

const result = await response;
if (result.kind === EGatewayResponseKind.ANSWER) {
  result.structured; // {lines: [...]}, validated against the schema
  result.citations;  // the ids of the knowledge-base chunks the model was given
  result.threadId;   // pass it on the next call to continue the conversation
}
```

A call that should stream reads `events` before awaiting `response`: text deltas, tool calls and results, the pause of a
human gate. The application owns the transport.

### The configuration

One object: the stores, the providers and the switches. The in-memory stores ship with the package; a database adapter
implements the same interface.

```ts
import {
  IAIGatewayConfig,
  IAIProfile,
  EModelProvider,
  InMemoryAIProfileRepository,
  InMemoryBlobAdapter,
  InMemoryModelRegistryRepository,
  InMemoryPromptTemplateRepository,
  InMemoryRunRepository,
  InMemoryThreadRepository,
  InMemoryTraceRepository,
  InMemoryUsageAdapter,
  InMemoryUserMemoryRepository,
  InMemoryVectorIndexAdapter,
} from "dyna-ai-gateway";

const config: IAIGatewayConfig = {
  llmClient: {providers: {[EModelProvider.OPENAI]: {apiKey: process.env.OPENAI_API_KEY ?? ""}}},
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [gpt5Mini, textEmbedding3Small]})},
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [accountingProfile]})},
  promptTemplateStore: {repository: new InMemoryPromptTemplateRepository()},
  threadStore: {repository: new InMemoryThreadRepository()},
  fileStore: {adapter: new InMemoryBlobAdapter(), path: "ai-files"},
  workingMemory: {enabled: true},
  userMemoryStore: {repository: new InMemoryUserMemoryRepository(), enabled: true},
  embedder: {embeddingModelId: "text-embedding-3-small", dimensions: 1536},
  vectorStore: {adapter: new InMemoryVectorIndexAdapter({embeddingModelId: "text-embedding-3-small", dimensions: 1536})},
  queryRewriter: {enabled: true},
  runStore: {repository: new InMemoryRunRepository()},
  humanGate: {userQuestions: {enabled: true}},
  usageGuard: {adapter: new InMemoryUsageAdapter()},
  contextAssembler: {promptCaching: true, sharePromptCacheAcrossTenants: false},
  trace: {repository: new InMemoryTraceRepository()},
  defaultCheapModelId: "gpt-5-mini",
};
```

A **model** (`IModelInfo`) is registered with its provider, its capabilities and its price. A **profile** (`IAIProfile`) is
what a tenant's use case runs on: the model, the tools it may call, the approvals, a prompt addendum and the limits.
Each call names its profile, so one thread can switch model between two calls. Both are data in a store and can be changed
while the server runs.

```ts
const accountingProfile: IAIProfile = {
  id: "accounting",
  tenantId: "acme",
  name: "Accounting assistant",
  modelId: "gpt-5-mini",
  promptAddendum: "You assist the accounting team of a Norwegian company. Amounts are in NOK.",
  allowedTools: ["get_invoice", "post_credit_note"],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
};
```

## Agent: tools, a policy per tool, a human in the loop

A tool is a function with a zod input schema and a policy. The policy decides, on the parsed input of each call, whether
the tool runs, is denied, or waits for a human. The application does not write a loop: `run()` is the loop.

```ts
import {z} from "zod";
import {defineTool, EToolCallVerdict, EGatewayResponseKind, EResumeAction} from "dyna-ai-gateway";

const getInvoice = defineTool({
  name: "get_invoice",
  description: "Returns an invoice by its number.",
  inputSchema: z.object({invoiceNo: z.string()}),
  tags: ["billing"],
  execute: async ({input, userContext}) => invoices.load(userContext.tenantId, input.invoiceNo),
});

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
}
```

What else a run gives: tools for one call only, a tool that ends the run, a tool offered only after another one ran, a
question the model asks the user as a form, a review of the final answer by a human before the user sees it, timeouts and
output caps per tool, a cap on steps and daily tokens per tenant. A paused run survives a restart of the server.

## A chat screen in one module

`dyna-ai-gateway/vercel-ui` speaks the UI message protocol of the Vercel AI SDK's `useChat`: the approval cards, the
history of a thread and the resume of a paused run included.

```ts
import {AIGatewayVercelUi} from "dyna-ai-gateway/vercel-ui";

const supportChat = new AIGatewayVercelUi({
  mode: "run",
  userContext: async ({request}) => sessionOf(request), // the application's authentication
  call: {profileId: "support", kbFilters: {libraryIds: ["help-center"], bookIds: []}},
}, {gateway});

export const POST = (request: Request): Promise<Response> => supportChat.chat({request});
```

The guide: [Vercel chat client](docs/10-getting-started/50-vercel-chat-client.md).

## What is inside

|                   |                                                                                                                               |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Calls             | `ask()`, `run()`, `resume()`; text or structured answer; streaming; `abortSignal` and `timeoutMs` on every call               |
| Knowledge base    | Markdown documents chunked, embedded and searched per tenant, library and book; query rewrite; citations                      |
| Memory            | The thread's summary and facts, the user's facts across threads; both optional, both editable                                 |
| Files             | Images and PDFs sent to a model that reads them                                                                               |
| Skills            | Instructions the model loads only when a task needs them, on the profile or on the call; inlined in an `ask()`                |
| Human in the loop | Approval of a tool call, the model's questions as a form, review of the answer, expiry of unanswered pauses                   |
| Guardrails        | Built-in input and output rules, the application's own rules with evidence, a judge on the cheap model                        |
| Usage and trace   | Your adapter asked before every model call and told what it used after it; one trace entry per model call with usage and cost |
| Operations        | Graceful shutdown, recovery of the runs a crashed server left behind, deletion or anonymisation of a user's data              |
| Providers         | OpenAI, Anthropic, Google, Mistral, Amazon Bedrock                                                                            |

## Design

- **The application keeps control.** The gateway knows no HTTP route, no UI and no session: it receives a `userContext`
  the host authenticated and returns events and a response.
- **Data is passed, services are injected.** A call loads its profile, memory and history once and hands them on as plain
  data; only the stores and the provider client are injected. One class per job.
- **Nothing is hidden in the model.** Every decision a tool policy, a guardrail or the usage adapter makes is code the
  application wrote, logged in the trace.
- **Persistence is a contract.** Every store is an interface; in-memory for tests and small deployments, MongoDB,
  PostgreSQL and S3 adapters as separate packages.

The reasons behind each behaviour: [Decisions](docs/60-architecture/90-decisions.md). The composition of the classes:
[Architecture and trade-offs](docs/60-architecture/10-architecture-and-trade-offs.md).

## Documentation

|                                                         |                                                                                                                                                     |
|---------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| [Docs site](https://aneldev.github.io/dyna-ai-gateway/) | these docs and the API reference from the JSDoc, with navigation                                                                                    |
| [Getting started](docs/10-getting-started/00-README.md) | first steps, the examples, the [FAQ](docs/10-getting-started/90-faq.md), the [Vercel chat client](docs/10-getting-started/50-vercel-chat-client.md) |
| [Roadmap](docs/70-roadmap.md)                           | what works today, what is planned, what is not                                                                                                      |
| [Terminology](docs/90-terminology.md)                   | the terms of the docs and where they come from                                                                                                      |
| [Architecture](docs/60-architecture/90-decisions.md)    | the composition, the trade-offs, one chapter of decisions per class                                                                                 |
| [Practices](docs/50-ai-best-practices/index.md)         | how to apply the library well                                                                                                                       |
| [Workspace](docs/85-workspace.md)                       | building and testing the packages of this repository                                                                                                |

## Packages

| Package                                                                   | What                                                   | Status  |
|---------------------------------------------------------------------------|--------------------------------------------------------|---------|
| [`dyna-ai-gateway`](packages/dyna-ai-gateway)                             | the gateway, in-memory stores included                 | beta    |
| [`dyna-ai-gateway-mongodb`](packages/dyna-ai-gateway-mongodb/README.md)   | MongoDB repositories and the Atlas Vector Search index | planned |
| [`dyna-ai-gateway-postgres`](packages/dyna-ai-gateway-postgres/README.md) | PostgreSQL repositories                                | planned |
| [`dyna-ai-gateway-s3`](packages/dyna-ai-gateway-s3/README.md)             | S3 blob store for the files                            | planned |

## About

Built by [Anel](http://anel.co), a small Norwegian software company working in accounting, billing, payments and AI
integration in complex environments. The gateway is the piece those systems share.

MIT license.