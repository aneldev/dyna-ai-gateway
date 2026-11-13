# Learning paths

A learning path is the reading list of one goal. It names the pages to open, in order, says how their parts work together,
and shows each case of the goal in a short example. Every other fact is on the page it links.

**You don't have to know everything, only the parts you need.** Each path accomplishes its goal on its own: follow
the one of your goal, its chapters, its examples and the pages it links, and you need no other page of the
documentation, and no other path. Skip the others until your application needs them.

Every path starts with the same four pages of [Getting started](../10-getting-started/00-README.md):

| Page                                                                         | What it gives you                     |
|------------------------------------------------------------------------------|---------------------------------------|
| [What is the AI gateway](../10-getting-started/10-what-is-the-ai-gateway.md) | where the library sits                |
| [Installation](../10-getting-started/20-installation.md)                     | the configuration, a model, a profile |
| [Example: ask](../10-getting-started/30-example-ask.md)                      | one answer                            |
| [Example: run](../10-getting-started/40-example-run.md)                      | one agent with a tool                 |

A **Prerequisites** line follows them: the API keys the examples of the path need, and the front end it assumes, where
it has one.

## The paths

| Path                                                              | Your goal                                                                      |
|-------------------------------------------------------------------|--------------------------------------------------------------------------------|
| [Answer a question](010-answer-a-question.md)                     | one answer, as text or as a typed object                                       |
| [Let the model act](020-let-the-model-act.md)                     | the model calls your functions to read or change data                          |
| [Keep a human in control](030-keep-a-human-in-control.md)         | a person approves a tool call, answers the model's question, reviews an answer |
| [Protect the conversation](040-protect-the-conversation.md)       | some input never reaches the model, some output never reaches the user         |
| [Remember the user](050-remember-the-user.md)                     | long conversations, and facts about the user across them                       |
| [Answer from your documents](060-answer-from-your-documents.md)   | answers grounded in your documents, with citations                             |
| [Extract data from files](070-extract-data-from-files.md)         | typed fields out of a PDF or an image                                          |
| [Run it in production](080-run-it-in-production.md)               | cancel, timeouts, shutdown, recovery, trace, cost                              |
| [Classify and route requests](090-classify-and-route-requests.md) | an intent or a triage decision your code acts on                               |
| [Summarize a document](100-summarize-a-document.md)               | a plain or structured summary of a file or a text                              |
| [Generate content](110-generate-content.md)                       | emails, descriptions, replies from the data of a screen                        |
| [Fill a form by conversation](120-fill-a-form-by-conversation.md) | the model asks the missing fields, then returns the form                       |
| [Automate a back-office task](130-automate-a-back-office-task.md) | an agent that runs as a job, without a chat screen                             |
| [Build a chat screen](140-build-a-chat-screen.md)                 | threads, streaming and a `useChat` client                                      |

## The chapters of a path

| Chapter                     | What it holds                                                                                                                                                                                                                                                                                                       |
|-----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| About                       | the goal in one paragraph                                                                                                                                                                                                                                                                                           |
| Description                 | the use case, and where it ends                                                                                                                                                                                                                                                                                     |
| What you will be able to do | the result, as a checklist; each item links the examples that show it                                                                                                                                                                                                                                               |
| The parts                   | the pages to read, in order                                                                                                                                                                                                                                                                                         |
| How the parts connect       | the path of one call through those parts: a diagram, then the text; numbered steps carry the same numbers in both                                                                                                                                                                                                   |
| API you should know         | the reference pages of the symbols you will write, grouped by the step of your code where you meet them (set up, make the call, read the result, what follows); each group links the examples that use it                                                                                                           |
| Advanced API                | the contracts to replace a part with your own class, grouped by the part, then how your class is plugged in                                                                                                                                                                                                         |
| Examples                    | 8.0, the configuration the examples run on (the required keys the path does not use collapsed in `baseConfig`), then short code for every case of the goal in the order your application meets them, each with what it does and the bigger picture: where it sits in your application; compiled against the package |
| Pitfalls                    | the mistakes of this goal, linked to where each is explained                                                                                                                                                                                                                                                        |
| Summary                     | the path in a few lines                                                                                                                                                                                                                                                                                             |
| FAQ                         | the questions of this goal, linked to their answers                                                                                                                                                                                                                                                                 |

The examples run on the `gateway` of the path's 8.0, built from the stores of [Installation](../10-getting-started/20-installation.md),
and on the `userContext` of [Example: ask](../10-getting-started/30-example-ask.md). Names such as `invoices.load` or `ledger`
stand for your application's own code.

Each part, with all its options, is in [Learn the Gateway](../20-learn-the-gateway/000-intro.md). How the parts are
built is in [Architecture](../60-architecture/10-architecture-and-trade-offs.md); reading it is optional.
