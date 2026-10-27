# `support-shop.real.config.ts` — the support assistant of Northwind Shop

The config `gatewayConfigSupportShop`: a support assistant of a small online shop. The customer is logged in and has three orders;
the assistant can read them, refund them, and hand the customer over to a human agent, which ends the run. Small refunds just happen. A refund above 10 EUR needs the customer verified first:
the assistant asks the postcode of the delivery address and checks it. A refund above 50 EUR stops and waits for a human, who can
approve, change the amount or decline. An ambiguous request makes the assistant ask the customer instead of guessing. And a card
number pasted into the chat never reaches the model.

One config, every gate of the gateway in one story: no gate, customer verification, human approval, the model's question, and a
guardrail in front of all of them. Made for the presentation; replayable in the sandbox; pinned by the `support-shop--*` tests.

## What the config offers

### The data

The customer's orders, an in-memory array (`ordersDb`). A refund changes the order's status; a restart resets it. Every order was
delivered to the postcode `CUSTOMER_POSTCODE` (1010), the one thing the customer is asked to prove it is them; `list_orders` never
returns it.

| Order | Item | Total | Status | Postcode |
| --- | --- | --- | --- | --- |
| 1001 | Wireless headphones | 89 EUR | delivered | 1010 |
| 1002 | Phone case | 19 EUR | delivered | 1010 |
| 1003 | 27-inch monitor | 349 EUR | shipped | 1010 |

### The tools

| Tool | Kind | Gate |
| --- | --- | --- |
| `list_orders` | read-only, no input | none: runs as soon as the model calls it |
| `verify_customer` | read-only: `orderId`, `postcode` | none; compares the postcode with the order's delivery address and marks the thread verified on a match |
| `refund_order` | side effect: `orderId`, `amount`, `reason` | above `CUSTOMER_VERIFICATION_THRESHOLD` (10 EUR) it refuses a thread `verify_customer` has not verified (a 403 the model reads as a tool error); `policy` predicate: above `REFUND_APPROVAL_THRESHOLD` (50 EUR) the run pauses for a human; 10 or less runs with no gate at all |
| `handover_to_agent` | side effect: `reason` | none to run; `endsRun: true`: the run ends after its step, the model gets one last step without tools to say a colleague takes over, the answer carries `endedByTool` |
| `ask_user_question` | built-in of the gateway (`humanGate.userQuestions.enabled`) | the model asks the customer; the run pauses until the answer arrives |

`refund_order`'s policy gives a `rejectionText` with the pause: what the model is told when a human declines the call ("nothing was refunded, tell the
customer, pass on the reason, offer to escalate, do not retry"). Without it the model only knows the call "was declined".

The customer verification is a chain of three things the config already has: the model asks the postcode through
`ask_user_question` (the question gate), checks it with the read-only `verify_customer`, then calls `refund_order`. The prompt tells
the model to do so; the refund tool enforces it, so a model that skips the step gets a failed tool result that tells it to verify
first. One verification per thread: a second refund in the same conversation asks nothing.

### The guardrail

| Rule | Kind | What it does |
| --- | --- | --- |
| `no_payment_data` | input rule, deterministic (no model call) | refuses a prompt that carries a card number (13 to 19 digits that pass the Luhn check) or an IBAN, before any model call; the prompt is not stored |

A support chat must never hold card data: refunds go to the payment method of the order, so there is nothing a card number could be
for. The rule is code, not a judge, so it costs nothing, answers instantly and is fully deterministic in a test. The response is
`FAILED` with the issue `payment_data_in_chat` and a message the UI shows the customer. Order ids, amounts and phone numbers pass:
they are too short or fail Luhn.

The same rule screens the **free text of an answer to a user question**: the typed answer is the next text that reaches the model,
so the gateway runs the input rules on it like on a prompt. A refused answer leaves the run paused, so the customer can answer again.
A picked option is one of the model's own words and is not screened.

Prompts that hit it (any Luhn-valid card number or IBAN does; these are the public test numbers):

- `Refund order 1002 to my card 4111 1111 1111 1111 please.`
- `My card is 5555 5555 5555 4444, refund the monitor.`
- `Send the refund to AT61 1904 3002 3457 3201.`
- after `I want a refund.`, the answer `The phone case, card 4111 1111 1111 1111`

Prompts that pass it: `Refund order 1003.`, `Call me back on 0043 664 1234567.` (an order id is too short, a phone number fails Luhn).

### The profile

The prompt addendum leaves the model one path for each situation, so the behaviour is predictable on a real model:

- list the orders before answering about them or refunding;
- every refund goes through `refund_order`, never a confirmation in text ("the system handles approvals");
- an order named by its id or by its item is identified; when the request fits more than one order or none, ask through
  `ask_user_question` with the orders as options, never guess and never ask in plain text; ask only which order, refund the full total;
- before a refund above 10 EUR, verify the customer once per conversation: ask the postcode of the delivery address through
  `ask_user_question` (one free-text question), call `verify_customer`, refund only on `verified: true`, never reveal the postcode;
- the result of `refund_order` is final: report what it returned, never refund the difference or ask about it;
- when the customer asks for a human, call `handover_to_agent` with the reason, then only say that a colleague takes over.

### Two models, two profiles

The config registers two models and two profiles with the same addendum, tools and limits; only the model differs. A call picks a
profile with `profileId`; nothing is stored on the thread, so the next call on the same thread may pick the other one (D46), and a
paused run may `resume` on the other profile, which swaps the model mid-run (D65).

| Profile id | Model | Provider | Key in `.env` |
| --- | --- | --- | --- |
| `default` (the one the tests and the sandbox name on every call) | `gpt-5-mini` | OpenAI | `AIGATEWAY_TEST_OPENAI_API_KEY` |
| `anthropic` | `claude-haiku-4-5` | Anthropic | `AIGATEWAY_TEST_ANTHROPIC_API_KEY` |

The tests run on the profile `default`. In the sandbox, `useProfile("anthropic")` makes every following helper call pass that id;
`useProfile("default")` names the default one, which is what a `resume` needs to swap the model (a resume without a `profileId`
keeps the profile the run started on); `useProfile()` sends no id any more. The judge of a guardrail and the memory helpers run on the profile's cheap model, which both
profiles leave at the base config's default (OpenAI).

## The four gates

1. **No gate.** A read-only tool runs as soon as the model calls it. The customer never waits. A refund of 10 EUR or less runs the
   same way.
2. **Customer verification, above 10 EUR.** Extra verification from the customer, not from a human agent: the model asks the
   postcode of the delivery address (through the question gate), `verify_customer` checks it, and only a verified thread may refund.
   The customer proves it is them once per conversation.
3. **Approval gate, above 50 EUR, per call.** The predicate runs on the parsed input of each call: 19 EUR passes, 349 EUR stops.
   The run pauses with the tool call in the envelope (`TOOL_APPROVAL`); nothing has happened yet. The human can **approve** (the tool
   runs with the model's input), **edit** (the tool runs with the human's input; the model is not told, it reads the tool's result)
   or **reject** with a reason (the model reads the reason after the `rejectionText` the policy gave for the call).
4. **Question gate.** The model itself stops and asks the customer. The answer continues the same run. The verification of gate 2
   uses it for the postcode.

The monitor (349 EUR) meets all of them in one run: the postcode question, the verification, the approval pause.

### How the model asks the user

`ask_user_question` is not a tool of this config; it is a built-in of the gateway, offered to the model in every run of a config
with `humanGate: {userQuestions: {enabled: true}}`. No profile has to allow it and `activeTools` cannot hide it. To the model it
is an ordinary tool: it sees the name, a description that says when to use it ("when the task cannot proceed without the user:
a missing value, an ambiguous reference, a choice only they can make; put every open question into one call; prefer options over
free text; do not ask what the conversation already answers") and an input schema. The model decides on its own when to call it;
the profile addendum of this config only makes that decision predictable.

What the model fills in is the form the UI renders, unchanged:

```ts
{
  title: "Which order should be refunded?",          // short, in the user's language
  description: "Please pick the order to refund.",   // optional: why the answers are needed
  questions: [{
    text: "Which order?",
    mode: "RADIO",                                   // "RADIO" = one answer, "CHECK" = several
    options: ["1001 — Wireless headphones (89 EUR)", "1002 — Phone case (19 EUR)", "1003 — 27-inch monitor (349 EUR)"],
    freeOption: false,                               // true lets the user type an own answer next to the options
  }],
}
```

A question without `options` is a free-text question (the postcode). Several questions go into one call, so the user answers them
together.

The call never executes. The tool's `policy` is `NEEDS_APPROVAL`, so the run pauses like any approval, but the envelope is of kind
`USER_QUESTION` and carries the form (`envelope.userQuestions`) instead of a tool call to approve. The thread stays open for the
user's reply; a pause that expires is cancelled.

The answers come back through `resume` with the `ANSWER` action: one `IUserAnswer` per question, in the order of the questions,
each repeating the question's text, the picked `selected` options and the typed `freeText`. The gateway writes them to the model
as the result of its own tool call:

```ts
{answers: [{question: "Which order?", selected: ["1002 — Phone case (19 EUR)"]}]}
```

So the model reads question and answer together in the place where it expected a tool output, and continues the same run with
the same history. Typed free text is screened by the input rules like a prompt before it reaches the model; a rejected answer
leaves the run paused, so the user can answer again. The question and the answer are stored as turns of the thread, so a later
follow-up on the thread sees them. Approve, edit and reject do not apply to a user question; a resume with one of them is refused.

### When the model asks, and how to trigger it

The gateway never decides to ask; the model does, in the step where it would otherwise call a tool or answer. It asks when it
cannot fill a required input of a tool from what it has (the prompt, the history, the tool results so far, the system prompt),
or when the request fits more than one thing and the choice is the customer's. It does not ask what it can look up (that is what
`list_orders` is for) or what the conversation already said. The tool's description says so to every model; the profile addendum
of this config pins the two cases it must ask about (which order; the postcode before a refund above 10 EUR) and tells it not to
ask about anything else.

So the trigger is a request that **misses exactly the piece only the customer has**. Here there are two such pieces, the order and
the postcode:

| Prompt | Asks? | What | Why |
| --- | --- | --- | --- |
| `I want a refund.` | yes | which order, then the postcode | three orders, none named: a choice only the customer can make; then the verification |
| `My item arrived broken, refund it.` | yes | which order, then the postcode | "my item" fits two delivered orders |
| `Refund the monitor.` | yes | the postcode only | the order is resolved from `list_orders`; 349 EUR needs the customer verified |
| `Refund order 1002.` | yes | the postcode only | the order is named; 19 EUR needs the customer verified |
| `Refund 8 EUR on order 1002.` | no | | the order is named and 8 EUR needs no verification |
| `And refund the headphones too.` right after a verified refund, on the same thread | no | | the thread is verified; 89 EUR goes to the approval pause |
| `What did I order?` | no | | nothing is missing; a read-only lookup answers |

Two ways to see the model **not** ask through the gate: type one of the "no" prompts, or set `humanGate.userQuestions.enabled`
to `false` in the config and `dynaEnv.newAIGateway()`: the tool is gone, so nothing can pause for a question. The model is left with
the choices it has without the gate: ask in plain text (the run ends with an answer, the next prompt is a new turn) or guess an
order and refund it (which the refund tool refuses above 10 EUR, unverified). That is the case the question gate exists for.

## Use cases

What the config lets you show or test, the prompt that triggers each, and what happens:

| Use case | Prompt | What happens |
| --- | --- | --- |
| Read-only tool, no gate | `What did I order recently?` | `list_orders` runs directly, the answer lists the three orders |
| Refund with no gate | `Refund 8 EUR on order 1002, the phone case has a scratch.` | `refund_order` with 8 EUR runs directly |
| Customer verification | `The phone case arrived broken, please refund it.` | 19 EUR is above 10: pauses with a question for the postcode; `answer 1010` → `verify_customer` verified, `refund_order` runs directly |
| Wrong postcode | the same, then `answer 9999` | `verify_customer → verified: false`, no refund; the model says it did not match and asks again |
| Verified thread | `And refund the headphones too.` on the same thread | no postcode question; 89 EUR goes straight to the approval pause |
| Approval gate | `Also refund the monitor, it never arrived.` | after the verification, pauses with `refund_order {orderId: "1003", amount: 349}` |
| Human approves | `approve` on the pause | the tool runs with the model's input |
| Human edits the input | `edit {"orderId":"1003","amount":300,"reason":"…"}` | the tool runs with 300; the model is not told, it reports what the tool returned |
| Human rejects with a reason | `reject Outside the 30-day return window` | the model tells the customer it was not done and why, offers to escalate |
| Model asks the customer | `I want a refund.` | pauses with one question, the orders as options; `answer 1002`, then the postcode question, `answer 1010`, the 19 EUR refund runs |
| Verification cannot be skipped | a model that calls `refund_order` above 10 EUR on an unverified thread (the scripted test) | the tool refuses with a 403; the model reads a failed result telling it to verify first; the order is untouched |
| Nothing to gate | `What are your opening hours?` | no tool, no gate, a plain answer |
| Guardrail on the prompt | `Refund order 1002 to my card 4111 1111 1111 1111 please.` | `FAILED` with `payment_data_in_chat` before any model call, no thread created |
| Guardrail on a typed answer | `I want a refund.` then `answer The phone case, card 4111 1111 1111 1111` | the resume fails with the same issue, the run stays paused; a clean answer continues it |

## The tests on this config

One behaviour each; the JSDoc of the test says what it pins and why the path is stable. `.real` runs on OpenAI (skipped without the
key); the others script the model with `FakeLLMClient` and need no key.

| Test | Pins |
| --- | --- |
| `support-shop--refund-at-or-below-10-runs-without-any-gate.real.test.ts` | 8 EUR: no question, no verification, no pause; the run answers in one go |
| `support-shop--refund-above-10-asks-the-customer-for-the-postcode-and-verifies-first.real.test.ts` | 19 EUR: the postcode question pauses the run; answered, `verify_customer` passes, then `refund_order` runs, in that order |
| `support-shop--refund-above-10-without-verification-is-refused-by-the-tool.test.ts` | a model that skips the verification gets a failed tool result naming `verify_customer`; the order is untouched |
| `support-shop--refund-above-50-pauses-and-the-edited-input-is-what-runs.real.test.ts` | 349 EUR pauses for approval; resumed with an edited input of 300, the tool refunds 300 |
| `support-shop--refund-without-an-order-asks-the-customer-which-one.real.test.ts` | "I want a refund." pauses with the orders as options; answered, the postcode is asked, then the refund runs |
| `support-shop--prompt-with-a-card-number-is-refused-before-the-model-runs.test.ts` | the guardrail: FAILED with the issue, no thread, the model never called |
| `support-shop--question-answered-with-a-card-number-keeps-the-run-paused.test.ts` | the guardrail on a typed answer: the resume fails, the run stays paused, a clean answer continues it |

```
pnpm test-no-coverage src/tests/human-gate/support-shop--
```

## Replaying it in the sandbox

Point `src/dev-sandbox/sandbox.config.ts` at the config:

```ts
import {gatewayConfigSupportShop} from "../tests/human-gate/support-shop.real.config";

export const config: IAIGatewayConfig = gatewayConfigSupportShop;
```

- **Chat** (`pnpm sandbox-cli run`): type the prompts of the use-case table. A pause asks `decision (approve | edit | reject) >` or
  `decision (answer) >`; the answers are `approve`, `edit <json of the whole input>`, `reject <reason>`, `answer <option text or free text>`.
  After a failed resume (a refused answer) the chat returns to the prompt and does not offer the decision again; use the debugger
  session to answer a second time.
- **Debugger session** (`pnpm sandbox-debug`): open `chrome://inspect`, inspect the target, paste
  `src/dev-sandbox/dev-tools-helper-methods.js` into the console once, then `start(prompt)`, `reply(prompt)`,
  `resumeWithAction("APPROVE" | "EDIT" | "REJECT", extra)`, `resumeWithAnswers(text)`. Every call prints the model request
  (`TRACE`) and returns the `TGatewayResponse`; a pause is in `lastResponse.envelope`.

The tour, on the debugger console, one thread from step 1 to 6:

```js
// 1. read-only tool, no gate: list_orders runs directly, the answer lists the three orders
await start("What did I order recently?");

// 2. customer verification: 19 EUR is above 10, the model asks the postcode (a userQuestion pause)
await reply("The phone case arrived broken, please refund it.");
lastResponse.envelope.kind;                      // "USER_QUESTION"
lastResponse.envelope.userQuestions.questions;   // one free-text question
await resumeWithAnswers("1010");                 // verify_customer → verified: true, refund_order → refunded: 19, answer

// 3. approval gate: the thread is verified, 349 EUR pauses for a human; look at the tool call, nothing happened yet
await reply("Also refund the monitor, it never arrived.");
lastResponse.envelope.kind;                      // "TOOL_APPROVAL"
lastResponse.envelope.toolCall;                  // {toolName: "refund_order", input: {orderId: "1003", amount: 349, reason: "…"}}
lastResponse.envelope.allowed;                   // ["APPROVE", "EDIT", "REJECT"]

// 4. edit: the human lowers the amount; the tool runs with 300, the model is not told and reports what the tool returned
await resumeWithAction("EDIT", {editedInput: {orderId: "1003", amount: 300, reason: "Monitor never arrived; shipping cost kept"}});

// 5. reject: 89 EUR pauses; declined with a reason, the model tells the customer it was not done and why
await reply("And refund the headphones too.");
await resumeWithAction("REJECT", {text: "Outside the 30-day return window"});

// 6. guardrail: refused before any model call; no TRACE is printed, lastResponse.issues holds the rule's issue
await reply("Refund order 1002 to my card 4111 1111 1111 1111 please.");

// 7. question gate, on a fresh thread: no order named, the model asks which one, then the postcode
await start("I want a refund.");
await resumeWithAnswers("1002");                 // the exact text of an option is picked; any other text is typed, the model reads it
await resumeWithAnswers("1010");
```

Useful while paused:

```js
lastResponse.envelope.kind;            // "TOOL_APPROVAL" | "USER_QUESTION"
lastResponse.envelope.toolCall;        // what the model wants to run
lastResponse.envelope.allowed;         // the decisions this pause accepts
dynaEnv.traces.at(-1).request;         // the last model request, with the system prompt and the tools the model saw
```

Switching the model:

```js
useProfile("anthropic");                         // from now on every call passes profileId: "anthropic"
await start("What did I order recently?");       // the TRACE shows claude-haiku-4-5
await reply("Refund the monitor.");              // the same thread; the postcode question, from Claude
useProfile("default");                           // the profile "default", by its id: a resume with a profileId swaps the model
await resumeWithAnswers("1010");                 // the paused run continues on gpt-5-mini: verification and approval pause, by OpenAI
useProfile();                                    // back to the config's profile (dynaEnv.profileId) for a new call; a resume keeps the run's profile
dynaEnv.traces.map(t => t.modelId);              // the models of the calls so far
```

## Things to try

- Change `CUSTOMER_VERIFICATION_THRESHOLD` or `REFUND_APPROVAL_THRESHOLD` in the config file and restart the sandbox: the same
  prompt now asks the postcode, pauses, or runs directly.
- Remove the sentences about `verify_customer` from the addendum and `dynaEnv.newAIGateway()`: the model skips the step, the
  refund tool refuses, and the model recovers by asking the postcode: the enforcement is in the tool, not in the prompt.
- Resume the same pause twice: the second call is refused, the tool ran once.
- Remove `refund_order` from the profile's `allowedTools`: the model cannot refund at all, the tool is not even offered.
- Remove the `rejectionText` from the policy result of `refund_order`: the model gets the default text and explains the decline less specifically.
- Set `humanGate.userQuestions.enabled` to `false`: with no way to ask, the model must guess or answer in text.
- Set `guardrails` to `{inputRules: []}`: the card number reaches the model and is stored in the thread, which is what the rule prevents.
- Run the whole tour on `useProfile("anthropic")`: the same config, the same gates, another model; compare the questions it words and the `TRACE`s.
