# AIGateway sandbox

A developer's workbench for one `IAIGatewayConfig`: the one `sandbox.config.ts` exports. Two entries run it — a terminal chat that
shows everything the gateway produces, and a debugger session that keeps the gateway alive for calls from the dev-tools console.
One thread per session, in-memory adapters, nothing persisted.

The sandbox has no configs of its own. **Every scenario is a test** (`src/tests/<feature>/<test>.config.ts` exporting
`gatewayConfig<Scenario>`, see `src/tests/README.md`); the sandbox replays one of them.

Self-contained: everything is in this folder, nothing in the package's `package.json`.

## Setup

1. Copy the repo-root `.env.sample` to `.env` (one file for the tests and the sandbox) and fill the keys of the providers your config uses:
   ```
   AIGATEWAY_TEST_OPENAI_API_KEY=sk-...
   AIGATEWAY_TEST_ANTHROPIC_API_KEY=sk-ant-...
   ```
2. Point `sandbox.config.ts` at the config you want to play with:
   ```ts
   import {gatewayConfigKb} from "../tests/knowledge-base/kb.real.config";

   export const config: IAIGatewayConfig = gatewayConfigKb;
   // or spread one and override: {...gatewayConfigKb, queryRewriter: {enabled: false}}
   ```
   The sandbox swaps in its own trace (prints every model call) and vector adapter (lists the chunks); a config that registers
   its embedding model gets the sample documents (`src/tests/internal/samples/kbDocuments.ts`) ingested at start, and every call
   then searches every library.
3. Run an entry (both compile with `ts-node`, work from any current directory; from the repo root also `pnpm sandbox-cli <ask|run>` / `pnpm sandbox-debug`):
   ```
   ./sandbox.cli.sh <ask|run>     the chat
   ./sandbox.debug.sh             the debugger session
   ```
   - `ask` — `AIGateway.ask()`: one grounded answer, no tools
   - `run` — `AIGateway.run()`: agent run with tools, may pause for approval

   A missing or unknown argument prints what is wrong and the valid values.

Fixed for every config: the user is `sampleUser` (`src/tests/internal/samples/profiles.ts`); answers are Markdown.

## In the chat

- Type a prompt and Enter. `/exit` (or Ctrl+D) leaves; the chat waits for the background memory work first.
- A paused run (`run` mode, a tool that needs approval or a user question) asks `decision (approve | edit | reject) >` once per card (the action in any case)
  (a parallel step can hold several tool calls back at once; the run resumes with all the decisions):
  `approve`, `edit <json>` (the whole new tool input, e.g. `edit {"amount": 200}` — it replaces the LLM's input, the LLM is not told),
  `reject <reason>`, or `answer <text> | <text>` for a user question (one text per question, `|` separated; an option's text picks it).
- Input can be piped for scripted sessions: `printf 'What time is it?\n/exit\n' | ./sandbox.cli.sh run`.
- Output mode per script (`utils/devOutputMode.ts`, env `AIGATEWAY_DEV_OUTPUT_MODE`): `sandbox.cli.sh` sets `CLI` — a terminal,
  colours always (`FORCE_COLOR`), objects as colourised JSON text; `sandbox.debug.sh` sets `DEBUG` — the dev-tools console, no
  colours (`NO_COLOR`), objects printed as objects. Not set (the entry run directly) = `CLI`.

What is printed per prompt, in order:

1. `event {…}` — one JSON line per `ILLMClientEvent` of the call's `events` (`TEXT_DELTA`, `TOOL_REQUEST`, `TOOL_RESULT`,
   `RUN_PAUSED`, `STEP_END`, `DONE`, `ANSWER_WITHDRAWN` after `DONE` when the output checks blocked the answer), printed while they
   arrive. This is what a web client receives.
2. `TRACE llm call <kind> · <modelId> · <tokens> · <cost>` followed by the `IModelRequest` the LLMClient sent, pretty JSON:
   the system prompt the ContextAssembler built, the messages, `maxOutputTokens`, `temperature`. One `console.log` per model call,
   printed when the call is traced (after its stream): the `CHAT` / `RUN_STEP` call, and the helper calls when they run
   (`MEMORY_WORKING`, `MEMORY_USER`, `QUERY_REWRITE`, `EMBED`). Inline file bytes show as `<n bytes>`, a zod schema as `<zod schema>`
   (in `DEBUG` mode the request is the object itself, expandable in the dev-tools console).
   A failed tool call (the tool threw, timed out, got an input its schema rejected, was refused) is printed between the model
   calls as `TRACE tool error <tool> · code <code> · status <status> · step <n> · call <id> · <ms>` with the `IToolErrorReport`
   the gateway hands to `toolRegistry.onToolError` (the sandbox's handler prints, then calls the config's own): the error as
   thrown and `modelText`, the line the model read instead of the error's message.
   A failed guardrail rule (it threw, its judge answered out of shape, it timed out) is printed the same way as
   `TRACE rule error <rule> · <INPUT|OUTPUT> · <THREW|TIMED_OUT> · <ms>` with the `IRuleErrorReport` the gateway hands to
   `guardrails.onRuleError` (the sandbox's handler prints, then calls the config's own): the error as thrown, which the caller
   only sees as the issue `rule_error`, and the trace ids of the rule's judge calls.
3. `TGatewayResponse (<kind>)` — the call's `response`, pretty JSON (`ANSWER` | `PAUSED` | `FAILED`).
4. `as the user sees it` — the text, sources, issues and token usage, rendered from Markdown for the terminal
   (`marked` + `marked-terminal`); or the pause card; or the failure.

A thrown `dynaError` (unknown model, provider failure, …) is printed as `thrown {…}` and the session continues.

The chat switches the `RUN_CHAT_SESSION` and `TRACE` channels of `utils/devConsole.ts` on at start; `KB_RETRIEVER`,
`USER_MEMORY_STORE` and `INGEST_SAMPLE_KB` stay off. The debugger session switches nothing on (see Debugging, `dynaEnv.devConsole`).

## Debugging

`./sandbox.debug.sh` is a debugger session, not a chat: it builds the gateway of `sandbox.config.ts` (`sandbox.debug.ts`) under the
Node inspector (`node --inspect=9229`, ts-node with source maps) and keeps it alive until you press Enter. You call the gateway
from the debugger console, with breakpoints set in `src/`:

- **Chrome**: open `chrome://inspect`, click *inspect* on the target, open the Console.
- **WebStorm**: Run → Edit Configurations → add *Attach to Node.js/Chrome*, host `localhost`, port `9229`; start it, open its Console.

The global of the console is `dynaEnv` (`IDynaEnv` in `sandbox.debug.ts`); its lists are live getters:

| `dynaEnv.…`      | What it is                                                                                              |
|------------------|---------------------------------------------------------------------------------------------------------|
| `config`         | The `IAIGatewayConfig` of the session (yours, with the sandbox's trace and vector adapter); edit it, then `newAIGateway()` |
| `aiGateway`      | The `AIGateway` of the config                                                                           |
| `newAIGateway()` | Replaces `aiGateway` with a new `AIGateway` built from the current `config`, returns it                 |
| `userContext`    | `sampleUser` with `now` = the time of the read                                                          |
| `profileId`      | The profile of every call (`sandbox.config.ts`'s `profileId`; a call always names its profile, D103); change it in the console |
| `kbFilters`      | The scope of every call: every library when the config ingested the sample documents, otherwise none    |
| `kbChunks`       | Every chunk in the vector index (`utils/DebugVectorIndexAdapter.ts`)                                    |
| `traces`         | Every traced model call so far, `ITraceEntry[]` (`utils/ConsoleTraceRepository.ts`)                     |
| `devConsole`     | The sandbox's console switches (`utils/devConsole.ts`): `devConsole.setActive(dynaEnv.EDevConsole.TRACE, true)` |
| `EDevConsole`    | The keys of `devConsole`: `TRACE`, `RUN_CHAT_SESSION`, `INGEST_SAMPLE_KB`, `KB_RETRIEVER`, `USER_MEMORY_STORE` |

For example:

```js
const {aiGateway, userContext, profileId, kbFilters} = dynaEnv;
const {events, response} = aiGateway.ask({userContext, profileId, prompt: "What time is it?", kbFilters});
for await (const event of events) console.log(event);
await response;
dynaEnv.traces.at(-1).request;
await aiGateway.modelRegistry.listModels();
```

### Talking to the LLM from the console

Typing a full `run()` / `resume()` call for every turn is tedious. `dev-tools-helper-methods.js` defines globals that do it for you,
on `dynaEnv`, with `debug: true`, and remember the last response so the next call continues the same thread or run. Paste the
whole file into the dev-tools console once per session (it is plain JavaScript, not loaded by `sandbox.debug.ts`):

| Global | What it does |
|---|---|
| `start(prompt)` | `aiGateway.run()` on a new thread |
| `reply(prompt)` | `run()` on the thread of the last response |
| `resumeWithAction(action, extra?)` | `resume()` the last tool-approval pause with `"APPROVE"`, `"EDIT"` (`{editedInput}`) or `"REJECT"` (`{text}`) |
| `resumeWithAnswers(...texts)` | `resume()` the last user-question pause with one string per question: an option name is picked, any other text is typed |
| `useProfile(profileId?)` | every following call passes this `profileId`; on a `resume` it swaps the model of the paused run (D65). Without an argument a new call runs on the config's profile (`dynaEnv.profileId`, from `sandbox.config.ts` — a call always names its profile, D103) and a resume keeps the run's profile |
| `lastResponse` | the last `TGatewayResponse` |

Every helper returns the `TGatewayResponse`; a pause is in `response.envelopes` (one card per `kind`, `toolCall` or `userQuestions`, `allowed`).
A helper that needs a pause throws when the last response is not one; the resume helpers answer the first card.

```js
await start("Refund 101");                             // → paused, envelopes[0].toolCall.toolName === "refund"
await resumeWithAction("APPROVE");                     // → answer
await resumeWithAction("REJECT", {text: "Not eligible"});
await reply("And 50 more");                            // → runs directly, the predicate says no
await start("Send the overdue invoice");               // → paused, envelopes[0].kind === "USER_QUESTION"
await resumeWithAnswers("4522");
useProfile("anthropic");                               // a config with a second profile: the next calls run on it
await reply("And the headphones?");                    // the same thread, another model
```

The chat (`sandbox.cli.sh`) has no inspector: it is the chat, this is the workbench.

## Files

```
dev-sandbox/
├─ sandbox.config.ts               THE file you edit: exports the IAIGatewayConfig both entries run (a test's gatewayConfig<Scenario>)
├─ sandbox.cli.sh                  the script: cd here, ts-node sandbox.cli.ts <ask|run>
├─ sandbox.debug.sh                the script: cd here, node --inspect + ts-node sandbox.debug.ts
├─ sandbox.cli.ts                  entry of the chat: <ask|run> → gateway → session
├─ sandbox.debug.ts                entry of the debugger session: gateway and the session's data as the global dynaEnv, waits for Enter
├─ dev-tools-helper-methods.js     paste into the dev-tools console: start / reply / resumeWith… globals over dynaEnv (see Debugging)
└─ utils/
   ├─ parseArgs.ts                 <ask|run> of the chat
   ├─ createSandboxAIGateway.ts    AIGateway(config + the sandbox's trace and vector adapter) + the sample KB, shared by both entries
   ├─ ingestSampleKb.ts            ingests the sample documents when the embedding model is registered; the call's kbFilters
   ├─ devOutputMode.ts             EDevOutputMode CLI | DEBUG, from AIGATEWAY_DEV_OUTPUT_MODE (set by the scripts)
   ├─ devConsole.ts                the sandbox's console switches (ConsoleController)
   ├─ ConsoleTraceRepository.ts    in-memory Trace that prints every model call's IModelRequest (one console.log, per output mode); keeps the entries
   ├─ DebugVectorIndexAdapter.ts   in-memory vector index that also lists its chunks (dynaEnv.kbChunks)
   ├─ runChatSession.ts            the prompt loop for any gateway; ask/run, pauses → resume
   ├─ askPauseDecision.ts          approve / reject / answer for a paused run
   ├─ createLineReader.ts          stdin lines, TTY or pipe
   ├─ formatResponse.ts            TGatewayResponse → what a user would see
   ├─ renderMarkdown.ts            Markdown → terminal text (marked + marked-terminal)
   └─ colorizeJson.ts              JSON.stringify with ANSI colours (node:util styleText)
```

The folder is a developer tool inside the gateway: it imports `node:*` modules, `dotenv`, `marked` and `marked-terminal` (dev
dependencies) and the tests' configs and samples (`src/tests/`). It is not exported by the gateway's barrel and not part of the
build (`dist`).