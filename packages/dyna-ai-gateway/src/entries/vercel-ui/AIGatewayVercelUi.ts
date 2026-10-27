import {randomUUID} from "crypto";
import {dynaError} from "dyna-error";

import {
  IFileRef,
  IGatewayAskInput,
  IGatewayCall,
  IGatewayRunInput,
  ILLMClientEvent,
  IPausedRunSummary,
  IResumeDecision,
  IUserContext,
  TGatewayResponse,
} from "../..";

import {
  IAIGatewayVercelUiConfig,
  IAIGatewayVercelUiDeps,
  IUiChatRequestBody,
  IUiChunkWriter,
  TGatewayUiChunk,
  TGatewayUiMessage,
} from "./types";
import {UiMapper} from "./UiMapper";
import {parseChatRequest} from "./utils/parseChatRequest";
import {
  toErrorResponse,
  toPublicError,
} from "./utils/publicError";
import {toSseResponse} from "./utils/toSseResponse";
import {toUiPause} from "./utils/toUiPause";

/**
 * AIGatewayVercelUi -- the gateway for one chat use case of a Vercel chat client
 *
 * # About
 *
 * > An endpoint is one call: the request in, the SSE response out.
 *
 * Composes an `AIGateway` for the browser's `useChat`: parses the client's messages, calls `ask` / `run` / `resume`, reads
 * the call's events (D38) and streams them as the SDK's UI message chunks; reads a thread and its pause as the messages to
 * draw. The gateway itself knows nothing of it (D40).
 *
 * - One instance per use case: the profile, the KB scope, the tools and the instructions are configuration, a second
 *   endpoint is a second instance.
 * - The request body never names the tenant or the user: the config's `userContext` hook is the trust boundary (D118).
 * - The client's copy of the history is never the truth: only the last message of a request is read.
 *
 * Sits between the application's route handlers and the gateway; the mapping itself is the `UiMapper`.
 *
 * # Who needs it
 *
 * The application's chat endpoints: `POST /api/chat` → `chat`, `GET /api/chat/:threadId` → `history`, the form of a user
 * question or an edit → `resume`.
 *
 * # What needs
 *
 * The `AIGateway` instance of the application (`deps.gateway`) and one `IAIGatewayVercelUiConfig`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * A chat screen on `useChat` (or any client of the SDK's UI message stream protocol) talking to this gateway over HTTP.
 *
 * ## When shouldn't use it
 *
 * Another transport (a WebSocket, a resumable stream after a reload): compose `UiMapper` with the gateway's `events`
 * yourself. A backend service that needs no streaming: call the gateway directly.
 *
 * # Pitfalls
 *
 * The thread list of the sidebar, uploads, renaming and deleting are the gateway's own methods, not this module's: a chat
 * screen calls both. The reviewer's screen of a RESULT_REVIEW (D99) is `AIGateway.getPausedRun`, an admin surface, never
 * served through `history`.
 */
export class AIGatewayVercelUi {
  private readonly mapper = new UiMapper();

  constructor(
    private readonly config: IAIGatewayVercelUiConfig,
    private readonly deps: IAIGatewayVercelUiDeps,
  ) {
  }

  /**
   * chat -- the `useChat` endpoint
   *
   * # About
   *
   * > The last user message in, the streamed answer out; the SDK's Approve / Reject in, the streamed continuation out.
   *
   * A request whose last message is the user's starts `ask` or `run` (`config.mode`) on `body.threadId`, or on a new
   * thread. A request whose last message is the assistant's with approval responses (D35) resumes the pause those name
   * (`approval.id` = `pauseId`, D110), found among the user's own paused runs.
   *
   * # Pitfalls
   *
   * An error before the first chunk (a 400 of the input, a 404 of a foreign thread, a 409 of a paused thread, the 401 of
   * `userContext`) is a JSON response with that status; an error once the stream runs is an `error` chunk, the status
   * stays 200. A 5xx never carries its message to the client.
   */
  public async chat({request}: {request: Request}): Promise<Response> {
    try {
      const userContext = await this.config.userContext({request});
      const body = await parseChatRequest({request});
      const approval = this.mapper.toApprovalResponses({messages: body.messages});
      if (approval) {
        const pause = await this.findPause({
          userContext,
          pauseId: approval.pauseId,
        });
        const call = this.startResume({
          userContext,
          request,
          pause,
          decisions: approval.decisions,
        });
        return await this.toResponse({
          call,
          threadId: pause.threadId,
        });
      }
      const call = await this.startCall({
        userContext,
        request,
        body,
      });
      return await this.toResponse({
        call,
        threadId: body.threadId,
      });
    }
    catch (error) {
      return toErrorResponse({error});
    }
  }

  /**
   * history -- the messages of a thread, for `useChat({messages})`
   *
   * # About
   *
   * > The whole thread, oldest first, with the pause it waits on.
   *
   * `AIGateway.getTurns` (D37) and the thread's paused run among the user's (`listPausedRuns`), mapped by
   * `UiMapper.toUiMessages`. Throws what the gateway throws: a thread of another user is a 404 (D32).
   */
  public async history(
    {
      request,
      threadId,
    }: {
      request: Request;
      threadId: string;
    },
  ): Promise<TGatewayUiMessage[]> {
    const userContext = await this.config.userContext({request});
    const [turns, pausedRuns] = await Promise.all([
      this.deps.gateway.getTurns({
        userContext,
        threadId,
      }),
      this.deps.gateway.listPausedRuns({userContext}),
    ]);
    const paused = pausedRuns.find(run => run.threadId === threadId);
    const {files} = this.config;
    return this.mapper.toUiMessages({
      turns,
      ...paused ? {pause: toUiPause(paused)} : {},
      ...files
        ? {
          resolveFileUrl: ({file}: {file: IFileRef}): Promise<string> => files.toUrl({
            userContext,
            file,
          }),
        }
        : {},
    });
  }

  /**
   * resume -- the continuation of a paused run, streamed
   *
   * # About
   *
   * > For the decisions the SDK's approval card cannot express.
   *
   * `ANSWER` with the answers of a user question (D62), `EDIT` of a tool input or of a reviewed answer, a `REJECT` with
   * the asker's own text: the application builds the decisions (one per envelope, D102) from `metadata.pause` and calls
   * this. The response streams like `chat`. The pause must be one of the user's own paused runs: a 404 otherwise.
   */
  public async resume(
    {
      request,
      runId,
      pauseId,
      decisions,
    }: {
      request: Request;
      runId: string;
      pauseId: string;
      decisions: IResumeDecision[];
    },
  ): Promise<Response> {
    try {
      const userContext = await this.config.userContext({request});
      const pause = await this.findPause({
        userContext,
        pauseId,
        runId,
      });
      const call = this.startResume({
        userContext,
        request,
        pause,
        decisions,
      });
      return await this.toResponse({
        call,
        threadId: pause.threadId,
      });
    }
    catch (error) {
      return toErrorResponse({error});
    }
  }

  private async startCall(
    {
      userContext,
      request,
      body,
    }: {
      userContext: IUserContext;
      request: Request;
      body: IUiChatRequestBody;
    },
  ): Promise<IGatewayCall> {
    const {
      text,
      files,
    } = this.mapper.toPrompt({messages: body.messages});
    const fileRefs = await this.resolveFiles({
      userContext,
      files,
    });
    const callConfig = {
      ...this.config.call,
      ...await this.config.prepareCall?.({
        request,
        userContext,
        body,
      }),
    };
    const perRequest = {
      userContext,
      prompt: text,
      abortSignal: request.signal,
      ...body.threadId ? {threadId: body.threadId} : {},
      ...fileRefs.length ? {files: fileRefs} : {},
      ...this.config.outputSchema ? {outputSchema: this.config.outputSchema} : {},
    };
    if (this.config.mode === "run") {
      const input: IGatewayRunInput = {
        ...callConfig,
        ...perRequest,
      };
      return this.deps.gateway.run(input);
    }
    const {
      activeTools: _activeTools,
      additionalTools: _additionalTools,
      ...askConfig
    } = callConfig;
    const input: IGatewayAskInput = {
      ...askConfig,
      ...perRequest,
    };
    return this.deps.gateway.ask(input);
  }

  private startResume(
    {
      userContext,
      request,
      pause,
      decisions,
    }: {
      userContext: IUserContext;
      request: Request;
      pause: IPausedRunSummary;
      decisions: IResumeDecision[];
    },
  ): IGatewayCall {
    const {
      additionalTools,
      timeoutMs,
    } = this.config.call;
    // The run keeps the profile it started on: a resume on another profile is the application's own call
    return this.deps.gateway.resume({
      userContext,
      runId: pause.runId,
      pauseId: pause.pauseId,
      decisions,
      abortSignal: request.signal,
      ...additionalTools ? {additionalTools} : {},
      ...timeoutMs === undefined ? {} : {timeoutMs},
      ...this.config.outputSchema ? {outputSchema: this.config.outputSchema} : {},
    });
  }

  /** The user's own paused run of the pause; a pause of nobody's or of another user is a 404, before the gateway is called. */
  private async findPause(
    {
      userContext,
      pauseId,
      runId,
    }: {
      userContext: IUserContext;
      pauseId: string;
      runId?: string;
    },
  ): Promise<IPausedRunSummary> {
    const pausedRuns = await this.deps.gateway.listPausedRuns({userContext});
    const pause = pausedRuns.find(run => run.pauseId === pauseId && (runId === undefined || run.runId === runId));
    if (!pause) {
      throw dynaError({
        code: 5377780695066,
        status: 404,
        message: `AIGatewayVercelUi: no paused run of the user waits on pause [${pauseId}]`,
        data: {
          pauseId,
          ...runId ? {runId} : {},
        },
      });
    }
    return pause;
  }

  private async resolveFiles(
    {
      userContext,
      files,
    }: {
      userContext: IUserContext;
      files: Parameters<NonNullable<IAIGatewayVercelUiConfig["files"]>["fromUi"]>[0]["part"][];
    },
  ): Promise<IFileRef[]> {
    if (!files.length) return [];
    const {files: hooks} = this.config;
    if (!hooks) {
      throw dynaError({
        code: 5377780695077,
        status: 400,
        message: "AIGatewayVercelUi: the message carries a file, and this use case has no `files` configuration",
      });
    }
    return Promise.all(files.map(part => hooks.fromUi({
      userContext,
      part,
    })));
  }

  /**
   * Waits for the call's first event (or its early failure: a thrown 4xx becomes the JSON error response of the caller),
   * then streams.
   */
  private async toResponse(
    {
      call,
      threadId,
    }: {
      call: IGatewayCall;
      threadId?: string;
    },
  ): Promise<Response> {
    const iterator = call.events[Symbol.asyncIterator]();
    const first = await iterator.next();
    const writer = this.mapper.createChunkWriter({
      messageId: randomUUID(),
      ...threadId ? {threadId} : {},
    });
    return toSseResponse({
      chunks: streamChunks({
        writer,
        first,
        iterator,
        response: call.response,
      }),
    });
  }
}

/** The chunks of one call: the writer's opening, one batch per event, the closing of the response or of the error. */
async function* streamChunks(
  {
    writer,
    first,
    iterator,
    response,
  }: {
    writer: IUiChunkWriter;
    first: IteratorResult<ILLMClientEvent>;
    iterator: AsyncIterator<ILLMClientEvent>;
    response: Promise<TGatewayResponse>;
  },
): AsyncGenerator<TGatewayUiChunk> {
  yield* writer.start();
  try {
    let next = first;
    while (!next.done) {
      yield* writer.onEvent({event: next.value});
      next = await iterator.next();
    }
    yield* writer.onResponse({response: await response});
  }
  catch (error) {
    yield* writer.onError({reason: toPublicError({error}).message});
  }
}
