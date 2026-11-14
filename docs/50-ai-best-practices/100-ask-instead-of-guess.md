---
sidebar_label: Ask instead of guess
description: "Make an AI agent ask clarifying questions instead of guessing: a built-in question tool pauses the run with a form (single choice, multiple choice, free text), the user answers, and the run continues with the answers. TypeScript examples."
keywords: [clarifying questions, AI agent, human in the loop, LLM ask user, conversational form, agentic AI, TypeScript]
---

# Make Your AI Agent Ask Instead of Guess: Clarifying Questions as a Paused Run

A request with a missing detail ("refund my last order" from a customer with three orders) gets a guess from most agents,
and the guess becomes an action. The practice is to give the model a way to ask: a question tool that pauses the run with
a form, and a resume that hands the answers back, so the model continues with facts instead of assumptions.

## 1. The problem

- A model that must produce an answer fills a gap with the most likely value.
- A question written into the answer text ends the run. The next message is a new turn, and your code has to piece the
  request together again.
- Free text the user types in reply is a new prompt that no check has seen.

## 2. The practice

1. **Offer the question tool.** With `humanGate.userQuestions.enabled`, every `run()` offers the built-in tool
   `dyna_aigw_ask_user_question`. Its call never executes: the run pauses with a `USER_QUESTION` card.
2. **Say when to ask.** The profile's `promptAddendum` names the details that must never be guessed, such as an order
   number, an amount or a date.
3. **One form, several questions.** The model puts every open question into one call: each question is a single choice
   (`RADIO`), a multiple choice (`CHECK`) or free text (`FREE_TEXT`).
4. **The answers return as the tool's result.** `resume()` with an `ANSWER` decision continues the same run. The model
   reads the answers as the result of its question and goes on.
5. **Typed answers are checked.** Free text typed in an answer runs through the input rules, like a prompt.
6. **Loop until it settles.** A resumed run may ask again. Handle its response like the response of `run()`.

## 3. In code

The samples run on your configuration and the caller's `userContext`. The setup they need is in the learning path
[Fill a form by conversation](../24-learning-paths/120-fill-a-form-by-conversation.md).

The switch and the rule that says when to ask:

```ts
import {
  AIGateway,
  EGatewayResponseKind,
  EPauseKind,
  EResumeAction,
  EUserQuestionMode,
  IAIGatewayConfig,
  IAIProfile,
  IUserAnswer,
  IUserContext,
  IUserQuestions,
} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;  // your configuration, with the tools list_orders and refund_order registered
declare const userContext: IUserContext; // who asks

const gateway = new AIGateway({...config, humanGate: {...config.humanGate, userQuestions: {enabled: true}}});

const support: IAIProfile = {
  id: "support",
  tenantId: "acme",
  name: "Customer support",
  modelId: "gpt-5-mini",
  promptAddendum: [
    "You handle refunds of the web shop.",
    "Never guess an order number or an amount: when the request leaves one open, ask the user.",
  ].join(" "),
  allowedTools: ["list_orders", "refund_order"],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 1_000},
};

await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: support});
```

The run pauses with the form, and the screen sends the answers back:

```ts
declare function askOnScreen(form: IUserQuestions): Promise<IUserAnswer[]>; // your form: one answer per question, in order

const first = await gateway.run({
  userContext,
  profileId: "support",
  prompt: "Refund my last order, it was broken.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (first.kind === EGatewayResponseKind.PAUSED) {
  const [card] = first.envelopes;
  if (card.kind === EPauseKind.USER_QUESTION) {
    // card.userQuestions: {title: "Which order?", questions: [{text: "Pick the order", mode: RADIO, options: ["88231", "88190"]}]}
    const answers = await askOnScreen(card.userQuestions);
    const resumed = await gateway.resume({
      userContext, // the asker answers their own question
      runId: card.runId,
      pauseId: card.pauseId,
      decisions: [{action: EResumeAction.ANSWER, answers}],
    }).response;
  }
}
```

An answer fits its question: `selected` holds only the question's options, and `freeText` only where the question takes
typed text:

```ts
const answerFor = (question: IUserQuestions["questions"][number], picked: string): IUserAnswer =>
  question.mode === EUserQuestionMode.FREE_TEXT
    ? {question: question.text, selected: [], freeText: picked}
    : {question: question.text, selected: [picked]};
```

## 4. Pitfalls

- **Expecting a question in `ask()`.** An `ask()` offers no tools, so the model cannot pause there. Use `run()`.
- **No rule for when to ask.** Without one, the model decides alone. Name the details that must not be guessed.
- **An answer that does not fit the card.** One answer per question, in order, with options from the question. A misfit
  is a 400 and the run stays paused.
- **A pause nobody answers.** A paused run blocks its thread. Schedule `expirePausedRuns`, and offer a dismiss button that
  calls `cancelRun`.
- **A follow-up message sent with `resume()`.** `resume()` answers a pause only. A new message is a new call on the thread.

## 5. Checklist

- [ ] `humanGate.userQuestions.enabled` is on for the agents that can act.
- [ ] The profile names the details the model must ask for.
- [ ] The screen renders `RADIO`, `CHECK` and `FREE_TEXT` questions.
- [ ] The code resumes until the response is no longer `PAUSED`.

## 6. Go further

- [Human in the loop: The model asks the user](../20-learn-the-gateway/040-human-in-the-loop.md#22-the-model-asks-the-user)
- [Human-in-the-loop approvals](060-human-in-the-loop-approvals.md): the pause before a tool call.
- [Structured output with zod](030-structured-output-with-zod.md): the form's result as typed data.
