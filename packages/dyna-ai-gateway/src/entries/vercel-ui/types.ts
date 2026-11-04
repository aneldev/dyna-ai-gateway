import type {
  FileUIPart,
  UIMessage,
  UIMessageChunk,
} from "ai";
import {ZodType} from "zod";

import {
  AIGateway,
  EPauseKind,
  IFileRef,
  IGatewayRunInput,
  IIssue,
  ILLMClientEvent,
  IResumeDecision,
  IUsage,
  IUserContext,
  TGatewayResponse,
  TPauseEnvelopes,
} from "../..";

/**
 * What the module adds to a UI message: the thread, the dates and model of the turns, and on a streamed answer the results
 * of the call (citations, issues, the structured value); `pause` on a thread that waits for a human.
 *
 * The `METADATA` of every `TGatewayUiMessage` and `TGatewayUiChunk`; the client merges every `message-metadata` chunk into it.
 */
export interface IUiMessageMetadata {
  /** The thread of the message; on a streamed answer set once it is known (the `finish` chunk at the latest). */
  threadId?: string;
  /** ISO date of the (first) turn of the message. */
  createdAt?: string;
  /** Assistant messages: the model of the answer. */
  modelId?: string;
  /** Assistant messages: the tokens of the answer. */
  usage?: IUsage;
  /** The chunk ids the answer was grounded on, as `IAnswerResponse.citations`. Streamed answers only. */
  citations?: string[];
  /** The warnings of the checks, as `IAnswerResponse.issues`; after `withdrawn`, the issues that withdrew it. Streamed answers only. */
  issues?: IIssue[];
  /** The parsed answer of a use case with an `outputSchema`. Streamed answers only. */
  structured?: unknown;
  /** The tool that ended the run (D86). */
  endedByTool?: string;
  /** The streamed text is not kept (D74): the renderer drops or greys it. */
  withdrawn?: boolean;
  /** The pause the thread waits on: what the SDK's approval card cannot show, and what `AIGatewayVercelUi.resume` takes. */
  pause?: IUiPause;
}

/**
 * The pause of a thread as the client sees it: the ids `resume` takes and the cards, as `IPausedResponse` carries them
 * (a RESULT_REVIEW without its draft, D111).
 *
 * Set as `IUiMessageMetadata.pause` by `history` and by the stream of a call that paused.
 */
export interface IUiPause {
  /** The paused run; `resume` takes it. */
  runId: string;
  /** The pause the decisions are for (D110); the SDK's approval card carries it as `approval.id`. */
  pauseId: string;
  /** TOOL_APPROVAL, USER_QUESTION or RESULT_REVIEW: what the client renders for the pause. */
  kind: EPauseKind;
  /** ISO date. */
  expiresAt: string;
  /** The cards of the pause, one decision each (D102), exactly as `IPausedResponse.envelopes`. */
  envelopes: TPauseEnvelopes;
}

/** A UI message as the module builds it. */
export type TGatewayUiMessage = UIMessage<IUiMessageMetadata>;

/** A stream chunk as the module builds it. */
export type TGatewayUiChunk = UIMessageChunk<IUiMessageMetadata>;

/**
 * The body `useChat`'s default transport posts, plus what this module reads from the request's `body`.
 *
 * Parsed by `AIGatewayVercelUi.chat`; handed to `IAIGatewayVercelUiConfig.prepareCall`.
 */
export interface IUiChatRequestBody {
  /** The client's own chat id; not the thread id. */
  id: string;
  /** The client's messages; the module reads the last one only. */
  messages: TGatewayUiMessage[];
  /** The SDK's trigger; a regenerate is refused with a 400, so a parsed body always says `"submit-message"`. */
  trigger: "submit-message" | "regenerate-message";
  /** The message a regenerate would target; carried as the SDK sends it, not read. */
  messageId?: string;
  /** The thread of the chat; absent on its first message (the stream's metadata then names the created thread). */
  threadId?: string;
}

/**
 * What one use case fixes for every call: the input of `ask` / `run` minus what each request brings (the user, the thread,
 * the prompt, the files, the signal) and what the config holds apart (`outputSchema`).
 *
 * `IAIGatewayVercelUiConfig.call`; `prepareCall` overrides parts of it per request.
 */
export type TUiCallConfig = Omit<IGatewayRunInput, "userContext" | "threadId" | "prompt" | "files" | "abortSignal" | "outputSchema" | "debug">;

/**
 * Configuration of one `AIGatewayVercelUi` instance: one chat use case of the application. A second use case is a second
 * instance with another config.
 *
 * Taken by the `AIGatewayVercelUi` constructor.
 */
export interface IAIGatewayVercelUiConfig {
  /**
   * `ask` (one grounded answer, no tools) or `run` (an agent run with the profile's tools, pauses included).
   *
   * @example "run" - a support chat whose model may look up orders and ask for approval before a refund
   */
  mode: "ask" | "run";
  /**
   * The trust boundary of the endpoint: the application's authentication turns the request into the calling user.
   *
   * > The gateway trusts its caller (D118); nothing of the request body names the tenant or the user.
   *
   * Throws a dynaError with `status: 401` for a request it cannot authenticate: `chat` and `resume` answer with that status.
   */
  userContext: (args: {request: Request}) => Promise<IUserContext>;
  /** The gateway input every call of this use case shares: `profileId`, `kbFilters`, the tools, `instructions`, `context`, limits. */
  call: TUiCallConfig;
  /**
   * The schema of a structured use case: the answer's parsed value lands in the metadata as `structured`. Handed to the
   * gateway's `resume` again (D36).
   */
  outputSchema?: ZodType;
  /**
   * Per-request overrides of `call`.
   *
   * > The `context` of what the client is looking at, carried in the request's body, or a profile picked per request.
   */
  prepareCall?: (args: {request: Request; userContext: IUserContext; body: IUiChatRequestBody}) => Promise<Partial<TUiCallConfig>>;
  /**
   * File parts: how a part the client sends names a stored file, and how a stored file is loaded by the client.
   *
   * > The upload itself is the application's route (`AIGateway.uploadFile`); the client only names what it uploaded.
   *
   * Without it a file part in a chat request is a 400, and the file parts of a stored thread are left out of `history`.
   */
  files?: {
    /** The `IFileRef` of a file part the client sent (the upload route gave the client the id, e.g. in `url`). A file of another user is the gateway's 400. */
    fromUi: (args: {userContext: IUserContext; part: FileUIPart}) => Promise<IFileRef>;
    /** The url the client loads a stored file from: a signed url, the application's download route. */
    toUrl: (args: {userContext: IUserContext; file: IFileRef}) => Promise<string>;
  };
}

/**
 * The gateway the module composes; the application builds it and passes it in.
 *
 * The second constructor argument of `AIGatewayVercelUi`.
 */
export interface IAIGatewayVercelUiDeps {
  /** The application's gateway: every read and write of the module goes through it. */
  gateway: AIGateway;
}

/**
 * The chunks of one streamed answer, in the order the client expects: the chunk protocol has an order the gateway's events
 * do not have (`text-start` before the first delta, `text-end` before a tool or the end).
 *
 * Created by `UiMapper.createChunkWriter`, one per call; driven by `AIGatewayVercelUi` or by an application on its own transport.
 */
export interface IUiChunkWriter {
  /**
   * start -- the chunks that open the stream
   *
   * # About
   *
   * > One `start` chunk: the message id, the date, the thread when it exists.
   *
   * Called once, before the first event. A new thread's id is not known yet: it reaches the client with the response's
   * metadata.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, first thing; an application streaming on its own transport.
   */
  start(): TGatewayUiChunk[];
  /**
   * onEvent -- the chunks of one event of the running call
   *
   * # About
   *
   * > Zero or more chunks, in the order the client's reducer expects.
   *
   * A text delta opens its step and its text when they are not open; a tool request closes the text first; a step end
   * closes both. `RUN_ENDED_BY_TOOL` and `ANSWER_WITHDRAWN` land as `message-metadata`; the other events add nothing,
   * the response carries the result.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, once per event of `IGatewayCall.events` (D38).
   *
   * # Pitfalls
   *
   * Events in order, one writer per call: the writer keeps the open text and the open step between the calls.
   */
  onEvent(args: {event: ILLMClientEvent}): TGatewayUiChunk[];
  /**
   * onResponse -- the chunks that close the stream with the call's response
   *
   * # About
   *
   * > ANSWER, PAUSED or FAILED: the results as metadata, then `finish`.
   *
   * ANSWER: `message-metadata` with the thread, usage, citations, issues, `structured` and `endedByTool`, then `finish`.
   * PAUSED: a `tool-approval-request` per TOOL_APPROVAL envelope, the pause as metadata, `finish`. FAILED: an `error`
   * chunk with the reason and a `finish` whose metadata carries the thread and the issues. The open text and step are
   * closed first.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, after the last event, with the awaited `IGatewayCall.response`.
   */
  onResponse(args: {response: TGatewayResponse}): TGatewayUiChunk[];
  /**
   * onError -- the chunks that close the stream after a thrown error
   *
   * # About
   *
   * > `error` with the public reason, then `finish`; the open text and step closed first.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, when the events or the response throw once the stream runs
   * (`toPublicError` gives the reason: a 5xx never carries its message).
   */
  onError(args: {reason: string}): TGatewayUiChunk[];
}

/** The SDK's own Approve / Reject as the client sent it back (D35): the pause it answers and one decision per card. */
export interface IUiApprovalResponses {
  /** The pause every card of the message answers: the cards' `approval.id` (D110). */
  pauseId: string;
  /** One APPROVE or REJECT per responded card, named by its `callId`. */
  decisions: IResumeDecision[];
}
