# Vercel chat client

A chat screen built on the Vercel AI SDK's `useChat` talks to the gateway through `dyna-ai-gateway/vercel-ui`: a server-only
module that takes your `AIGateway` instance and a configuration per chat use case, and speaks the SDK's UI message protocol.
Each endpoint of your application becomes one call. The gateway itself knows nothing of the chat client
([D40](../architecture/Decisions.md#d40-the-gateway-knows-no-ui)).

## 1. One instance per use case

```ts
import {AIGateway} from "dyna-ai-gateway";
import {AIGatewayVercelUi} from "dyna-ai-gateway/vercel-ui";

const gateway = new AIGateway(config);

const supportChat = new AIGatewayVercelUi({
  mode: "run",                                   // "ask": one grounded answer; "run": an agent run with the profile's tools
  userContext: async ({request}) => sessionOf(request),   // your authentication; throw a 401 dynaError for nobody
  call: {
    profileId: "support",
    kbFilters: {libraryIds: ["help-center"], bookIds: []},
    instructions: "Answer as the support desk of the shop.",
  },
}, {gateway});
```

`userContext` is the trust boundary of the endpoint: the request body never names the tenant or the user
([D118](../architecture/Decisions.md#d118-the-gateway-checks-what-a-user-could-forge-and-trusts-what-the-host-sets)).
`call` holds what every call of the use case shares (the same fields as `run()`, minus what each request brings); `prepareCall`
overrides it per request, for example the `context` of the record the user is looking at, carried in the request's `body`.
A second use case, an invoice assistant on another profile and another knowledge base, is a second instance.

## 2. The endpoints

```ts
// POST /api/chat — what useChat posts
export const POST = (request: Request): Promise<Response> => supportChat.chat({request});

// GET /api/chat/:threadId — the messages to draw when a thread is opened
export const GET = async (request: Request, {params}: {params: {threadId: string}}): Promise<Response> =>
  Response.json(await supportChat.history({request, threadId: params.threadId}));
```

`chat` reads the **last** message of the request only: its text parts are the prompt, its file parts the files. The gateway
holds the history; the client's copy is never the truth. It returns the SDK's SSE response, so `useChat` needs no transport
option. The thread: the first message of a chat carries no `threadId`, the gateway creates one, and the stream's metadata
names it (`message.metadata.threadId`); from then on the client sends it in the body:

```ts
const {messages, sendMessage} = useChat({
  messages: history,                              // from GET /api/chat/:threadId
  transport: new DefaultChatTransport({
    api: "/api/chat",
    body: {threadId},                             // the thread of this screen, once known
  }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});
```

An error before the first chunk (a 400 of the input, a 404 of another user's thread, a 409 of a thread that waits for a human,
the 401 of your hook) is a JSON response with that status; an error once the stream runs is an `error` chunk. A 5xx never carries
its message to the browser.

## 3. What the client receives

| In the stream | Meaning |
| --- | --- |
| `text-start` / `text-delta` / `text-end` | The answer's text, one text per model step |
| `tool-input-available`, `tool-output-available`, `tool-output-error` | A tool call of the run and its result; `dynamic: true`, render it by `toolName` |
| `tool-approval-request` | A tool call that waits for a human: the SDK's approval card, see § 4 |
| `message-metadata` | The gateway's results on the message: `threadId`, `usage`, `citations`, `issues`, `structured` (a use case with an `outputSchema`), `endedByTool`, `withdrawn`, `pause` |
| `error` | The call failed: the reason |

`metadata.withdrawn` says the text that streamed was not kept (an output rule failed; the issues are next to it): grey it or
drop it, the protocol cannot take text back. In `history`, one answer is one assistant message with a `step-start` part per
model step ([D34](../architecture/Decisions.md#d34-one-answer-is-one-message)); a call the human rejected is a `dynamic-tool`
part in state `output-denied` with the reason, a call that failed is `output-error`.

## 4. Approvals and the other decisions

A run that pauses for a tool streams a `tool-approval-request` and `metadata.pause`; the message's tool part is in state
`approval-requested`. The SDK's card does the rest: `addToolApprovalResponse({id, approved, reason})` and, with
`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`, `useChat` posts the messages to the same `chat`
endpoint, which resumes the run and streams the continuation
([D35](../architecture/Decisions.md#d35-the-approval-card-is-the-sdks-own)). Every card of the pause is answered in that one
request.

What the card cannot express goes through `resume`: the answers of a user question (the `ask_user_question` call is a
`dynamic-tool` part in state `input-available`, its `input` the form to render), an `EDIT` of the tool's input, a `REJECT` with
the user's own text. The application builds the decisions from `metadata.pause` (the `runId`, the `pauseId`, the envelopes with
their `allowed` actions) and calls:

```ts
// POST /api/chat/resume
export const POST = async (request: Request): Promise<Response> => {
  const {runId, pauseId, decisions} = await request.clone().json();
  return supportChat.resume({request, runId, pauseId, decisions});
};
```

The pause must be one of the calling user's own paused runs; anything else is a 404. A review of the answer before the user
sees it ([D99](../architecture/Decisions.md#d99-the-answer-waits-for-a-human)) streams no text and sets `metadata.pause`
with the kind `RESULT_REVIEW`; the reviewer's screen is `AIGateway.getPausedRun`, not this module.

## 5. Files

Uploads are your own route on `AIGateway.uploadFile`; the client then names the file in a file part of its message. The `files`
hooks of the config translate both ways: `fromUi` turns the part into the stored file's pointer, `toUrl` gives `history` the url
the client loads a stored file from (a signed url, your download route). Without the hooks, a file part in a request is a 400 and
the file parts of a stored thread are left out of `history`.

## 6. What stays the gateway's

The thread list of the sidebar, renaming and deleting (`listThreads`, `renameThread`, see
[the FAQ](FAQ.md#how-do-i-show-the-users-conversations-and-open-one)), the uploads and the reviewer's screen are the gateway's own
methods: a chat screen calls both. On another transport than HTTP (a WebSocket, a resumable stream after a reload), compose
`UiMapper`, the pure translation the module is built on, with the gateway's `events` yourself.
