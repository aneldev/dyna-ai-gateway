# What is the AI gateway

A server-side TypeScript library between your application (or your agent) and the model providers. Your code calls it;
it calls the providers through the [Vercel AI SDK](https://ai-sdk.dev) and stores what a conversation needs behind
interfaces you implement or take in-memory.

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

## What it does

| Part              | What the gateway does                                                                                         |
|-------------------|---------------------------------------------------------------------------------------------------------------|
| Calls             | `ask()` for one answer, `run()` for an agent loop, `resume()` after a pause; text or a typed object; streamed |
| Prompt            | the template, the profile's addendum, the call's instructions and context, the history, the cached block      |
| Tools             | your functions with a zod schema; a policy per call allows, denies or holds it for a human                    |
| Human in the loop | approval of a tool call, the model's questions as a form, review of the answer before the user sees it        |
| Memory            | the thread's history as a sliding window or a summary, the user's facts across threads                        |
| Knowledge base    | Markdown documents chunked, embedded and searched per tenant, library and book; citations                     |
| Usage and trace   | your adapter asked before every model call and told what it used; one trace entry per model call              |
| Guardrails        | built-in input and output rules, your own rules, a judge on the cheap model                                   |

## What stays in your application

- **Authentication.** Every call carries the `userContext` your host authenticated: tenant, user, permissions, locale.
  The gateway knows no HTTP route, no session and no UI.
- **The transport.** A call returns its `events` and its `response`; how they reach a screen is your code. The
  [Vercel chat client](50-vercel-chat-client.md) is one ready-made transport.
- **The data.** Every store is an interface (`IAIGatewayConfig.<store>.repository` or `.adapter`). In-memory
  implementations ship with the package for tests and small deployments.
- **The spend.** The gateway holds no budget, plan or quota; your [usage adapter](Usage%20adapter.md) decides every call.

## How it is built

Every part of the gateway is a class with one job, held behind an interface. The second constructor argument takes your
own instance in place of any of them; the rest of the gateway does not notice the swap.

```ts
const gateway = new AIGateway(config, {kbRetriever: new MyKbRetriever()});
```

Not needed to start. The details: [Live adjustment and dependency injection](../30-architecture/Live%20adjustment%20and%20dependency%20injection.md),
the reasons behind each behaviour: [Decisions](../30-architecture/Decisions.md).

Next: [Installation](20-installation.md).
