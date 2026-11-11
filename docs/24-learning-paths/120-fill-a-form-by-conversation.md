# Fill a form by conversation

**This path is complete for its goal.** Its chapters, its examples and the pages it links are all you need; no other page
of the documentation is required. It starts from four pages of Getting started:
[What is the AI gateway](../10-getting-started/10-what-is-the-ai-gateway.md),
[Installation](../10-getting-started/20-installation.md), [Example: ask](../10-getting-started/30-example-ask.md),
[Example: run](../10-getting-started/40-example-run.md).

## 1. About

A `run()` that collects a form: the model asks the user for the missing fields as a card of questions, the run pauses,
the answers resume it, and the completed form comes back as a typed object or is stored by a tool that ends the run.

## 2. Description

For intake flows written as a conversation: a damage report, a leave request, a booking. The user writes what they know;
the model asks for the rest with radio, check or free-text questions your screen renders. The answers are checked against
their card, and typed text is screened like a prompt.

The run, the question card, the resume and the submit tool are all in this path.

## 3. What you will be able to do

- Switch on the model's questions to the user. Example: [8.0](#80-the-configuration).
- Render a `USER_QUESTION` card and resume with the answers. Example: [8.3](#83-the-screen-renders-the-question-card-and-resumes-with-the-answers).
- Return the completed form as `structured`, or store it with a tool that ends the run. Examples: [8.1](#81-the-form-as-a-zod-schema-and-a-submit-tool-that-ends-the-run), [8.5](#85-the-form-as-the-structured-answer-of-one-message-without-a-tool).
- Require a check tool before the submit tool. Example: [8.0](#80-the-configuration).

## 4. The parts

| # | Read                                                                                                                             | For                                      |
|---|----------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|
| 1 | [Human in the loop: The model asks the user](../20-learn-the-gateway/040-human-in-the-loop.md#22-the-model-asks-the-user)        | the built-in question tool and its modes |
| 2 | [Human in the loop: Answer the model's question](../20-learn-the-gateway/040-human-in-the-loop.md#34-answer-the-models-question) | the resume with `ANSWER`                 |
| 3 | [D117: An answer must fit its card](../60-architecture/90-decisions.md#d117-an-answer-must-fit-its-card)                         | what an answer may hold                  |
| 4 | [Guardrails: Answers a user types on a resume](../20-learn-the-gateway/050-guardrails.md#29-answers-a-user-types-on-a-resume)    | the screening of free text               |
| 5 | [Guardrails: Structured output](../20-learn-the-gateway/050-guardrails.md#24-structured-output)                                  | the completed form as `structured`       |
| 6 | [How does a run end, and can a tool end it?](../10-getting-started/90-faq.md#how-does-a-run-end-and-can-a-tool-end-it)           | a submit tool with `endsRun`             |

## 5. How the parts connect

1. `humanGate.userQuestions.enabled` offers `dyna_aigw_ask_user_question` in every `run()`.
2. The model puts every open field into one call; the run pauses with a `USER_QUESTION` envelope.
3. Your screen renders the questions; `resume()` passes one `ANSWER` decision with the answers. The answers become the
   tool's result, and the run goes on; it may ask again.
4. When the form is complete, the model either answers with the object your `outputSchema` defines, or calls your submit
   tool; with `endsRun` the run then closes with one last sentence. `requires` can make the submit wait for a check tool
   ([D15, D76](../60-architecture/90-decisions.md#d15-d76-guarded-workflows)).

## 6. API you should know

Grouped by the step of your code where you meet them, in the order of the examples.

### 6.1 Set up the form

Examples: [8.0](#80-the-configuration), [8.1](#81-the-form-as-a-zod-schema-and-a-submit-tool-that-ends-the-run).

| Symbol                                                                                                        | What you use it for        |
|---------------------------------------------------------------------------------------------------------------|----------------------------|
| [`IHumanGateConfig`](../30-api/index/interfaces/IHumanGateConfig.md)                                          | `userQuestions.enabled`    |
| [`defineTool`](../30-api/index/functions/defineTool.md), [`IToolDef`](../30-api/index/interfaces/IToolDef.md) | the submit tool, `endsRun` |
| [`IToolPolicyConfig`](../30-api/index/interfaces/IToolPolicyConfig.md)                                        | `requires`                 |
| [`BUILT_IN_TOOL_NAMES`](../30-api/index/variables/BUILT_IN_TOOL_NAMES.md)                                     | `ASK_USER_QUESTION`        |

### 6.2 Start the conversation

Examples: [8.2](#82-the-customer-starts-the-conversation-with-one-message), [8.5](#85-the-form-as-the-structured-answer-of-one-message-without-a-tool).

| Symbol                                                                                                                            | What you use it for     |
|-----------------------------------------------------------------------------------------------------------------------------------|-------------------------|
| [`AIGateway.run`](../30-api/index/classes/AIGateway.md#run), [`IGatewayRunInput`](../30-api/index/interfaces/IGatewayRunInput.md) | the run, `outputSchema` |

### 6.3 Show the card and answer it

Examples: [8.3](#83-the-screen-renders-the-question-card-and-resumes-with-the-answers), [8.4](#84-resume-until-the-report-is-filed).

| Symbol                                                                                                                                                                                                     | What you use it for |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------|
| [`IUserQuestionEnvelope`](../30-api/index/interfaces/IUserQuestionEnvelope.md)                                                                                                                             | the card            |
| [`IUserQuestions`](../30-api/index/interfaces/IUserQuestions.md), [`IUserQuestion`](../30-api/index/interfaces/IUserQuestion.md), [`EUserQuestionMode`](../30-api/index/enumerations/EUserQuestionMode.md) | the questions       |
| [`AIGateway.resume`](../30-api/index/classes/AIGateway.md#resume), [`IResumeDecision`](../30-api/index/interfaces/IResumeDecision.md), [`IUserAnswer`](../30-api/index/interfaces/IUserAnswer.md)          | the answers         |
| [`EResumeAction`](../30-api/index/enumerations/EResumeAction.md)                                                                                                                                           | `ANSWER`            |

### 6.4 Read the result

Examples: [8.4](#84-resume-until-the-report-is-filed), [8.5](#85-the-form-as-the-structured-answer-of-one-message-without-a-tool).

| Symbol                                                             | What you use it for         |
|--------------------------------------------------------------------|-----------------------------|
| [`IAnswerResponse`](../30-api/index/interfaces/IAnswerResponse.md) | `structured`, `endedByTool` |

## 7. Advanced API

Grouped by the part of the gateway you replace.

### 7.1 The questions and the resume

| Symbol                                                   | Replace it when                                                |
|----------------------------------------------------------|----------------------------------------------------------------|
| [`IHumanGate`](../30-api/index/interfaces/IHumanGate.md) | pause, resume and expiry follow rules of your own              |
| [`IRunStore`](../30-api/index/interfaces/IRunStore.md)   | runs are stored your way; a repository is enough in most cases |

### 7.2 The tools

| Symbol                                                     | Replace it when                                               |
|------------------------------------------------------------|---------------------------------------------------------------|
| [`IToolPolicy`](../30-api/index/interfaces/IToolPolicy.md) | allow, deny, approval and `requires` follow rules of your own |

### 7.3 Plugging your class in

| Symbol                                                                     | What it is                                                                                             |
|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| [`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md) | the second argument of `AIGateway`; the keys of the parts above: `humanGate`, `runStore`, `toolPolicy` |

## 8. Examples

The examples run on the `gateway` of 8.0 and the `userContext` of [Example: ask](../10-getting-started/30-example-ask.md). Names such as `invoices` or `ledger` stand for your application's code.

### 8.0 The configuration

The tools are your `getOrder` lookup and the submit tool of 8.1. The keys this path uses come first, each with why; the others are required by `IAIGatewayConfig` and keep the values of [Installation](../10-getting-started/20-installation.md), with the features this path does not need switched off. `gpt5Mini` and `textEmbedding3Small` are the models of Installation.

> **The bigger picture:** Your server builds this gateway once at startup. The `claims` profile and its two tools are the whole form flow; the questions the model asks go through `humanGate.userQuestions`.

```ts
import {
  AIGateway,
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

const claimsProfile: IAIProfile = {
  id: "claims",
  tenantId: "acme",
  name: "Damage reports",
  modelId: "gpt-5-mini",
  promptAddendum: "You take damage reports of the Acme web shop.",
  allowedTools: ["get_order", "submit_damage_report"],
  approvals: [],
  limits: {maxStepsPerRun: 10, maxOutputTokens: 2_000},
};

const config: IAIGatewayConfig = {
  // What this path uses
  humanGate: {userQuestions: {enabled: true}}, // every run() on a model with caps.tools offers dyna_aigw_ask_user_question
  runStore: {repository: new InMemoryRunRepository()}, // the run waits here between the questions and the answers
  toolRegistry: {tools: [getOrder, submitDamageReport]}, // the lookup and the submit tool (8.1)
  toolPolicy: {requires: {submit_damage_report: ["get_order"]}}, // the model looks the order up before it may submit
  // allowedTools lists both tools; maxStepsPerRun covers every question round
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [claimsProfile]})},

  // Required by IAIGatewayConfig, nothing specific to this path: the in-memory stores of Installation,
  // and the features this path does not need switched off
  llmClient: {providers: {[EModelProvider.OPENAI]: {apiKey: process.env.OPENAI_API_KEY ?? ""}}},
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [gpt5Mini, textEmbedding3Small]})},
  promptTemplateStore: {repository: new InMemoryPromptTemplateRepository()},
  threadStore: {repository: new InMemoryThreadRepository()},
  fileStore: {adapter: new InMemoryBlobAdapter(), path: "ai-files"},
  workingMemory: {enabled: true},
  userMemoryStore: {repository: new InMemoryUserMemoryRepository(), enabled: false}, // user facts off
  embedder: {embeddingModelId: "text-embedding-3-small", dimensions: 1536},
  vectorStore: {adapter: new InMemoryVectorIndexAdapter({embeddingModelId: "text-embedding-3-small", dimensions: 1536})},
  queryRewriter: {enabled: false}, // no follow-up rewrite
  usageGuard: {adapter: new InMemoryUsageAdapter()},
  contextAssembler: {promptCaching: true, sharePromptCacheAcrossTenants: false},
  trace: {repository: new InMemoryTraceRepository()},
  defaultCheapModelId: "gpt-5-mini",
};

const gateway = new AIGateway(config);
```

### 8.1 The form as a zod schema, and a submit tool that ends the run

The zod schema is the form and the tool's `inputSchema`, so the model's input is parsed against it. `endsRun: true` ends the run after a successful call: the model gets one last step without tools for its closing sentence.

> **The bigger picture:** Written once at startup, next to your claims service: the same damage report a web form would post, now filled from a conversation.

```ts
import {z} from "zod";
import {defineTool} from "dyna-ai-gateway";

const damageReport = z.object({
  orderNo: z.string(),
  damage: z.enum(["broken", "missing_parts", "wrong_item"]),
  description: z.string(),
  wantsReplacement: z.boolean(),
});

const submitDamageReport = defineTool({
  name: "submit_damage_report",
  description: "Stores the completed damage report. Call it once every field is known. Returns {claimNo}.",
  inputSchema: damageReport, // the model's input is parsed against the form
  tags: ["claims"],
  endsRun: true,             // after it, the model writes one closing sentence and the run ends
  execute: async ({input, userContext}) => claims.create(userContext.tenantId, input),
});
```

The `claims` profile lists `submit_damage_report` in `allowedTools`.

### 8.2 The customer starts the conversation with one message

`run()` gets the customer's message as the `prompt` and the task in `instructions`. With too little to fill the form, the model asks: the response is `PAUSED` with a `USER_QUESTION` card.

> **The bigger picture:** The help widget of the web shop: the customer writes "my order arrived broken" and gets a few questions back instead of a long form.

```ts
const call = gateway.run({
  userContext,
  profileId: "claims",
  prompt: "My order arrived broken.",
  instructions: "Collect a damage report. Ask for every missing field in one question card. Then call submit_damage_report.",
  kbFilters: {libraryIds: [], bookIds: []},
});
const first = await call.response; // PAUSED with a USER_QUESTION card: the order number, the damage, replacement or refund
```

### 8.3 The screen renders the question card and resumes with the answers

Each question has a `mode`: `RADIO` and `CHECK` pick among `options`, `FREE_TEXT` takes typed text. The answers go back as one `EResumeAction.ANSWER` decision, with the `runId` and `pauseId` of the pause.

> **The bigger picture:** The chat draws the card as a small form; the customer picks "broken", types a description and presses send.

```ts
import {EGatewayResponseKind, EPauseKind, EResumeAction, EUserQuestionMode, IUserAnswer} from "dyna-ai-gateway";

if (first.kind === EGatewayResponseKind.PAUSED) {
  const [card] = first.envelopes;
  if (card.kind === EPauseKind.USER_QUESTION) {
    // card.userQuestions.questions: [{text, mode: RADIO | CHECK | FREE_TEXT, options?, freeOption?}, …]
    const answers = card.userQuestions.questions.map((question): IUserAnswer =>
      question.mode === EUserQuestionMode.FREE_TEXT
        ? {question: question.text, selected: [], freeText: formValues[question.text] ?? ""}
        : {question: question.text, selected: [formValues[question.text] ?? ""]}); // one of question.options

    const next = await gateway.resume({
      userContext,
      runId: card.runId,
      pauseId: first.pauseId,
      decisions: [{action: EResumeAction.ANSWER, answers}],
    }).response;
  }
}
```

### 8.4 Resume until the report is filed

A loop drives the conversation to the end: it resumes while the response is `PAUSED` with a question card. `endedByTool` on the final `ANSWER` names `submit_damage_report`, so the screen knows the report was stored.

> **The bigger picture:** Your server code behind the widget: however many rounds the customer needs, the same loop runs them, and the widget shows the closing sentence with the claim number.

The model may ask again; each answer card is a new pause of the same run.

```ts
import {EGatewayResponseKind, EPauseKind, EResumeAction, TGatewayResponse} from "dyna-ai-gateway";

let response: TGatewayResponse = first;
while (response.kind === EGatewayResponseKind.PAUSED) {
  const [card] = response.envelopes;
  if (card.kind !== EPauseKind.USER_QUESTION) break; // another kind of card: Keep a human in control
  response = await gateway.resume({
    userContext,
    runId: card.runId,
    pauseId: response.pauseId,
    decisions: [{action: EResumeAction.ANSWER, answers: await renderCard(card.userQuestions)}], // your screen
  }).response;
}

if (response.kind === EGatewayResponseKind.ANSWER && response.endedByTool === "submit_damage_report") {
  showToUser(response.text); // "Your report is filed as claim 4411."
}
```

### 8.5 The form as the structured answer of one message, without a tool

With `outputSchema: damageReport`, the final answer is the form itself, parsed and checked, in `structured`; your code stores it instead of a tool.

> **The bigger picture:** An email or a first message that already names the order, the damage and the wish: the claims service gets the filled form from one call.

```ts
import {EGatewayResponseKind} from "dyna-ai-gateway";

const result = await gateway.run({
  userContext,
  profileId: "claims",
  prompt: "My order 88231 arrived with a cracked lid. I want a replacement.",
  outputSchema: damageReport, // the final answer is the form, validated
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.ANSWER && result.structured) {
  await claims.create(userContext.tenantId, result.structured);
}
```

## 9. Pitfalls

- [Human in the loop: Pitfalls](../20-learn-the-gateway/040-human-in-the-loop.md#4-pitfalls)
- An `ask()` cannot ask the user: it offers no tools ([Human in the loop: About](../20-learn-the-gateway/040-human-in-the-loop.md#1-about)).
- An answer that does not fit its card is a 400 and the run stays paused
  ([D117](../60-architecture/90-decisions.md#d117-an-answer-must-fit-its-card)).
- A follow-up message of the user while the run waits is not a resume
  ([Resume is only for a paused run](../60-architecture/90-decisions.md#resume-is-only-for-a-paused-run)).

## 10. Summary

- `humanGate.userQuestions.enabled` lets the model ask; a question is a `USER_QUESTION` pause.
- `resume()` with `ANSWER` hands the answers to the model, checked against the card.
- The completed form is `structured`, or a submit tool that `endsRun`.

## 11. FAQ

- [The run paused with several cards. How do I answer them?](../10-getting-started/90-faq.md#the-run-paused-with-several-cards-how-do-i-answer-them)
- [How does a run end, and can a tool end it?](../10-getting-started/90-faq.md#how-does-a-run-end-and-can-a-tool-end-it)
- [Human in the loop: FAQ](../20-learn-the-gateway/040-human-in-the-loop.md#6-faq)
