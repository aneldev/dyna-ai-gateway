# Learn the Gateway

This section explains each part of the gateway: what it does, how it decides, and how to configure it. Each page stands on
its own. You do not need to read them in order, and you do not need all of them: read the page of the part your
application uses, and come back to the others when you need them.

To learn only what one goal needs, follow its [learning path](../24-learning-paths/README.md) instead: it lists the
sections of these pages to read, in order.

Every page has the same chapters:

| Chapter       | What it holds                                             |
|---------------|-----------------------------------------------------------|
| About         | what the part is and what it gives the application        |
| Logic         | how it works, step by step, and the rules it applies      |
| Examples      | real cases with code that compiles against the package    |
| Pitfalls      | what not to do, and what happens when you do              |
| Summary       | the page in five lines                                    |
| FAQ           | the questions developers ask about it                     |
| API reference | links to the generated reference of every symbol it names |

The examples reuse the `config` of [Installation](../10-getting-started/20-installation.md) and the `userContext` of
[Example: ask](../10-getting-started/30-example-ask.md).

## The parts

| Page                                                     | Read it when                                                                      |
|----------------------------------------------------------|-----------------------------------------------------------------------------------|
| [Models and profiles](010-models-and-profiles.md)        | always: every call names a profile, and the profile names the model               |
| [Skills](020-skills.md)                                  | the model needs long instructions that only some calls use                        |
| [Tools](030-tools.md)                                    | the model must read or change data of your application                            |
| [Human in the loop](040-human-in-the-loop.md)            | a person approves a tool call, answers the model's question or reviews the answer |
| [Guardrails](050-guardrails.md)                          | some input must never reach the model, or some output must never reach the user   |
| [Token control with the Usage Guard](060-usage-guard.md) | your application decides who may spend how many tokens                            |
| [Add a knowledge base to the LLM](070-knowledge-base.md) | the model answers from your documents, with citations                             |
| [Thread memory](080-thread-memory.md)                    | a conversation is longer than the model's context, or you tune what it keeps      |
| [User memory](090-user-memory.md)                        | the model remembers facts about the user across threads                           |
| [Chat files and their storage](092-chat-files.md)        | the user attaches images or PDFs to a question                                    |

How the parts connect inside the gateway, and why they are built as they are, is in
[Architecture](../60-architecture/10-architecture-and-trade-offs.md). Reading it is optional.
