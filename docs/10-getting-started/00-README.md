![dyna AI Gateway logo](../../assets/dyna-ai-gateway%20banner.png)

# Getting started

`dyna-ai-gateway` puts a language model inside a business application. The application calls `ask()` for an answer or
`run()` for an agent with tools; the gateway assembles the prompt, keeps the conversation, applies the tool policies,
pauses for a human when a policy says so, asks your code before every model call, and traces each one.

**You don't need to know everything, only what you need.** A first answer takes one configuration object and one call.
Tools, approvals, memory, the knowledge base and the class replacements are there when a use case asks for them, and not
before.

| Chapter                                                | What you get                                                           |
|--------------------------------------------------------|------------------------------------------------------------------------|
| [What is the AI gateway](10-what-is-the-ai-gateway.md) | where the library sits between your application and the providers      |
| [Installation](20-installation.md)                     | the package, the configuration, a model and a profile                  |
| [Example: ask](30-example-ask.md)                      | a structured answer on the data of the screen, streamed                |
| [Example: run](40-example-run.md)                      | an agent that calls your function to answer                            |
| [Example: a human in the loop](45-example-HITL.md)     | a tool call that waits for an approver, then resumes                   |
| [Vercel chat client](50-vercel-chat-client.md)         | a `useChat` screen on the gateway, through `dyna-ai-gateway/vercel-ui` |
| [FAQ](90-faq.md)                                       | the questions of the first weeks, answered with code                   |

Every exported symbol carries its JSDoc, so the editor shows the contract of each option; the
[API reference](https://aneldev.github.io/dyna-ai-gateway/docs/api/index/classes/AIGateway) is the same JSDoc as pages.
