---
sidebar_label: Ask instead of guess
description: "Make an AI agent ask clarifying questions instead of guessing: a built-in question tool pauses the run with a form (single choice, multiple choice, free text), the user answers, and the run continues with the answers. TypeScript examples."
keywords: [clarifying questions, AI agent, human in the loop, LLM ask user, conversational form, agentic AI, TypeScript]
---

# Make Your AI Agent Ask Instead of Guess: Clarifying Questions as a Paused Run

A request with a missing detail ("refund my last order" from a customer with three orders) gets a guess from an agent that has no way to ask,
and the guess becomes an action. The practice is to give the model a way to ask: a question tool that pauses the run with
a form, and a resume that hands the answers back, so the model continues with facts instead of assumptions.

## The problem

- A model that must produce an answer fills a gap with the most likely value.
- A question written into the answer text ends the run. The next message is a new turn, and your code has to piece the
  request together again.
- A reply as a new message is free text: the model has to read the missing value out of it, and may misread it.

## The practice

1. **Offer the question tool.** With `humanGate.userQuestions.enabled`, every `run()` on a model with tools offers the built-in tool
   `dyna_aigw_ask_user_question`. Its call never executes: the run pauses with a `USER_QUESTION` card. A call whose input
   the tool's schema rejects pauses as a `TOOL_APPROVAL` card instead, so a person sees what the model asked for (a known gap: the model should read the 400 and ask again).
2. **Say when to ask.** The profile's `promptAddendum` names the details that must never be guessed, such as an order
   number, an amount or a date.
3. **One form, several questions.** The model puts every open question into one call: each question is a single choice
   (`RADIO`), a multiple choice (`CHECK`) or free text (`FREE_TEXT`).
4. **The answers return as the tool's result.** `resume()` with an `ANSWER` decision continues the same run. The model
   reads the answers as the result of its question and goes on.
5. **Answers are checked.** A picked option must be one the question offers, and free text typed in an answer runs
   through the input rules, like a prompt.
6. **One decision per card.** A step can ask a question and request an approval at once, so a pause can hold several
   cards. `resume()` takes one decision per card, named by its `callId`.
7. **Loop until it settles.** A resumed run may ask again. Handle its response like the response of `run()`.

## In code

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
  IResumeDecision,
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
  modelId: "gpt-6.1-terra",
  promptAddendum: [
    "You handle refunds of the web shop.",
    "Never guess an order number or an amount: when the request leaves one open, ask the user.",
  ].join(" "),
  allowedTools: ["list_orders", "refund_order"],
  approvals: ["refund_order"], // the refund still waits for a person
  limits: {maxStepsPerRun: 6, maxOutputTokens: 1_000},
};

await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: support});
```

The run pauses with the form, and the screen sends the answers back, one decision per card:

```ts
declare function askOnScreen(form: IUserQuestions): Promise<IUserAnswer[]>; // your form: one answer per question, in order
declare function sendForApproval(runId: string, callId: string): Promise<void>; // your approval queue

const first = await gateway.run({
  userContext,
  profileId: "support",
  prompt: "Refund my last order, it was broken.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (first.kind === EGatewayResponseKind.PAUSED) {
  const questions = first.envelopes.filter(card => card.kind === EPauseKind.USER_QUESTION);
  if (questions.length === first.envelopes.length) {
    // card.userQuestions: {title: "Which order?", questions: [{text: "Pick the order", mode: RADIO, options: ["88231", "88190"]}]}
    const decisions: IResumeDecision[] = [];
    for (const card of questions) {
      decisions.push({callId: card.callId, action: EResumeAction.ANSWER, answers: await askOnScreen(card.userQuestions)});
    }
    const resumed = await gateway.resume({
      userContext, // the asker answers their own question
      runId: first.envelopes[0].runId,
      pauseId: first.pauseId,
      decisions,
    }).response; // handle `resumed` like `first`: it can pause again, on a question or an approval
  } else {
    // an approval card: the approver resumes the pause, with a decision for every card, questions included
    for (const card of first.envelopes) {
      if (card.kind === EPauseKind.TOOL_APPROVAL) await sendForApproval(card.runId, card.callId); // decided elsewhere
    }
  }
}
```

An answer fits its question: `selected` holds only the question's options (one for `RADIO`; more is a 400, as is an option the question does not offer), and `freeText` only where
the question takes typed text (`FREE_TEXT`, or a choice with `freeOption`):

```ts
const answerFor = (question: IUserQuestions["questions"][number], picked: string[], typed?: string): IUserAnswer => {
  const takesText = question.mode === EUserQuestionMode.FREE_TEXT || question.freeOption === true;
  return {
    question: question.text,
    selected: question.mode === EUserQuestionMode.FREE_TEXT ? [] : picked,
    ...(typed && takesText ? {freeText: typed} : {}),
  };
};
```

## Pitfalls

- **Expecting a question in `ask()`.** An `ask()` offers no tools, so the model cannot pause there. Use `run()`.
- **No rule for when to ask.** Without one, the model decides alone. Name the details that must not be guessed.
- **An answer that does not fit the card.** One answer per question, in order, with options from the question. A misfit
  is a 400 and the run stays paused.
- **A pause nobody answers.** A paused run blocks its thread. Schedule `expirePausedRuns`, and offer a dismiss button that
  calls `cancelRun`.
- **A follow-up message sent with `resume()`.** `resume()` answers a pause only. A new message is a new call on the thread.

## Checklist

- [ ] `humanGate.userQuestions.enabled` is on for the agents that can act.
- [ ] The profile names the details the model must ask for.
- [ ] The screen renders `RADIO`, `CHECK` and `FREE_TEXT` questions.
- [ ] The code resumes until the response is no longer `PAUSED`, with one decision per card.

## Go further

- [Human in the loop: The model asks the user](../20-learn-the-gateway/040-human-in-the-loop.md#22-the-model-asks-the-user)
- [Human-in-the-loop approvals](060-human-in-the-loop-approvals.md): the pause before a tool call.
- [Structured output with zod](030-structured-output-with-zod.md): the form's result as typed data.
