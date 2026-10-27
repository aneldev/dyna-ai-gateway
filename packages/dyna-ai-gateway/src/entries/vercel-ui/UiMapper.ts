import type {FileUIPart} from "ai";
import {dynaError} from "dyna-error";

import {
  EPartKind,
  EPauseKind,
  EResumeAction,
  ETurnRole,
  IFileRef,
  IResumeDecision,
  IToolCallPart,
  IToolResultPart,
  ITurn,
  TPauseEnvelope,
  TTurnPart,
} from "../..";

import {
  IUiApprovalResponses,
  IUiChunkWriter,
  IUiPause,
  TGatewayUiMessage,
} from "./types";
import {UiChunkWriter} from "./utils/UiChunkWriter";

type TUiPart = TGatewayUiMessage["parts"][number];

/**
 * UiMapper -- the gateway's shapes as the Vercel chat client's shapes, and back
 *
 * # About
 *
 * > Turns become messages, events become chunks, the client's approvals become decisions.
 *
 * The pure translation between what the gateway stores and streams (turns, events, pause envelopes) and what `useChat`
 * draws and consumes (`UIMessage`, `UIMessageChunk`). No gateway, no config, no I/O: every method takes data and returns
 * data.
 *
 * - One answer is one assistant message (D34): the assistant and tool turns up to the next user turn fold into it, a
 *   `step-start` part before each model step.
 * - Tools are `dynamic-tool` parts: the gateway's tools are registered at runtime, the client renders them by `toolName`.
 * - The SDK's approval card speaks for a TOOL_APPROVAL pause (D35); the approval id is the `pauseId` (D110).
 *
 * `AIGatewayVercelUi` drives it for the HTTP case; an application on another transport (a WebSocket, a resumable stream)
 * composes it with the gateway's `events` itself.
 *
 * # Who needs it
 *
 * `AIGatewayVercelUi.chat`, `history` and `resume`; an application that streams on its own transport.
 *
 * # Pitfalls
 *
 * The id of a streamed answer (`createChunkWriter`) and the id of the same answer in the history (its first turn's id)
 * differ: the client replaces its messages with `history` when it reopens the thread, it never merges the two.
 */
export class UiMapper {
  /**
   * toUiMessages -- the turns of a thread, and its pause, as the messages a chat UI draws
   *
   * # About
   *
   * > The whole thread, oldest first, one message per user turn and one per answer.
   *
   * A tool call of the pause is drawn as the SDK's approval request (TOOL_APPROVAL) or as a call without output
   * (USER_QUESTION: the application renders the form from the call's `input`). A RESULT_REVIEW pause lands as `pause` in
   * the metadata of the last assistant message, or of an empty one when the draft has no turns (the asker never sees the
   * draft, D111). Without `resolveFileUrl` the file parts are left out: a file part needs a url.
   */
  public async toUiMessages(
    {
      turns,
      pause,
      resolveFileUrl,
    }: {
      turns: ITurn[];
      pause?: IUiPause;
      resolveFileUrl?: (args: {file: IFileRef}) => Promise<string>;
    },
  ): Promise<TGatewayUiMessage[]> {
    const results = new Map<string, IToolResultPart>();
    turns.forEach(turn => turn.parts.forEach(part => {
      if (part.kind === EPartKind.TOOL_RESULT) results.set(part.callId, part);
    }));
    const pending = new Map<string, TPauseEnvelope>();
    pause?.envelopes.forEach(envelope => {
      if ("callId" in envelope) pending.set(envelope.callId, envelope);
    });

    const messages: TGatewayUiMessage[] = [];
    let answer: TGatewayUiMessage | undefined;
    for (const turn of turns) {
      const parts = await this.toUiParts({
        parts: turn.parts,
        results,
        pending,
        pause,
        resolveFileUrl,
      });
      if (turn.role === ETurnRole.USER) {
        answer = undefined;
        messages.push({
          id: turn.id,
          role: "user",
          metadata: {createdAt: turn.createdAt.toISOString()},
          parts,
        });
        continue;
      }
      if (!answer) {
        answer = {
          id: turn.id,
          role: "assistant",
          metadata: {createdAt: turn.createdAt.toISOString()},
          parts: [],
        };
        messages.push(answer);
      }
      if (turn.role === ETurnRole.ASSISTANT) {
        answer.parts.push({type: "step-start"});
        answer.metadata = {
          ...answer.metadata,
          ...turn.modelId ? {modelId: turn.modelId} : {},
          ...turn.usage ? {usage: turn.usage} : {},
        };
      }
      answer.parts.push(...parts);
    }

    if (pause) {
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant") {
        last.metadata = {
          ...last.metadata,
          pause,
        };
      }
      else {
        messages.push({
          id: `pause-${pause.runId}`,
          role: "assistant",
          metadata: {pause},
          parts: [],
        });
      }
    }
    return messages;
  }

  /**
   * toPrompt -- the last user message of a chat request as the gateway's prompt and files
   *
   * # About
   *
   * > Only the last message counts: the gateway holds the history, the client's copy is never the truth.
   *
   * The text parts joined, the file parts as sent (the config's `files.fromUi` resolves them). A last message that is
   * not the user's is a 400.
   */
  public toPrompt({messages}: {messages: TGatewayUiMessage[]}): {text: string; files: FileUIPart[]} {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      throw dynaError({
        code: 5377780695044,
        status: 400,
        message: "AIGatewayVercelUi: the last message of a chat request must be the user's",
      });
    }
    return {
      text: last.parts.flatMap(part => part.type === "text" ? [part.text] : []).join("\n\n"),
      files: last.parts.flatMap((part): FileUIPart[] => part.type === "file" ? [part] : []),
    };
  }

  /**
   * toApprovalResponses -- the SDK's Approve / Reject as the client sent it back (D35)
   *
   * # About
   *
   * > One decision per `approval-responded` tool part of the last assistant message.
   *
   * Undefined when the last message is not an assistant message with approval responses: the request is then a new
   * prompt. Approve is `APPROVE`; Reject is `REJECT` with the card's reason as the text the model reads. Every response
   * names the same pause (its `approval.id`); two pauses in one message is a 400.
   */
  public toApprovalResponses({messages}: {messages: TGatewayUiMessage[]}): IUiApprovalResponses | undefined {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return undefined;
    const responded =
      last.parts.flatMap(part =>
        part.type === "dynamic-tool" && part.state === "approval-responded"
          ? [{
            toolCallId: part.toolCallId,
            approval: part.approval,
          }]
          : []);
    if (!responded.length) return undefined;
    const pauseIds = new Set(responded.map(({approval}) => approval.id));
    const [pauseId] = pauseIds;
    if (pauseIds.size !== 1 || !pauseId) {
      throw dynaError({
        code: 5377780695055,
        status: 400,
        message: "AIGatewayVercelUi: the approval responses of one message must name one pause",
        data: {pauseIds: [...pauseIds]},
      });
    }
    return {
      pauseId,
      decisions: responded.map(({
        toolCallId,
        approval,
      }): IResumeDecision => ({
        action: approval.approved ? EResumeAction.APPROVE : EResumeAction.REJECT,
        callId: toolCallId,
        ...approval.reason ? {text: approval.reason} : {},
      })),
    };
  }

  /**
   * createChunkWriter -- a writer for the chunks of one streamed answer
   *
   * # About
   *
   * > One writer per call; feed it the call's events, then its response.
   *
   * `threadId` when the thread exists already; a new thread's id reaches the client with the response's metadata.
   */
  public createChunkWriter(
    {
      messageId,
      threadId,
    }: {
      messageId: string;
      threadId?: string;
    },
  ): IUiChunkWriter {
    return new UiChunkWriter({
      messageId,
      ...threadId ? {threadId} : {},
    });
  }

  private async toUiParts(
    {
      parts,
      results,
      pending,
      pause,
      resolveFileUrl,
    }: {
      parts: TTurnPart[];
      results: Map<string, IToolResultPart>;
      pending: Map<string, TPauseEnvelope>;
      pause?: IUiPause;
      resolveFileUrl?: (args: {file: IFileRef}) => Promise<string>;
    },
  ): Promise<TUiPart[]> {
    const uiParts: TUiPart[] = [];
    for (const part of parts) {
      switch (part.kind) {
        case EPartKind.TEXT:
          uiParts.push({
            type: "text",
            text: part.text,
            state: "done",
          });
          break;
        case EPartKind.FILE:
          if (!resolveFileUrl) break;
          uiParts.push({
            type: "file",
            mediaType: part.file.mime,
            filename: part.file.name,
            url: await resolveFileUrl({file: part.file}),
          });
          break;
        case EPartKind.TOOL_CALL:
          uiParts.push(toToolPart({
            call: part,
            result: results.get(part.callId),
            envelope: pending.get(part.callId),
            pause,
          }));
          break;
        default:
          // TOOL_RESULT parts are folded into their call's part; INLINE_FILE never reaches a stored turn
          break;
      }
    }
    return uiParts;
  }
}

/** The `dynamic-tool` part of a call: its state from the result it got, or from the pause it waits in. */
const toToolPart = (
  {
    call,
    result,
    envelope,
    pause,
  }: {
    call: IToolCallPart;
    result?: IToolResultPart;
    envelope?: TPauseEnvelope;
    pause?: IUiPause;
  },
): TUiPart => {
  const base = {
    type: "dynamic-tool" as const,
    toolName: call.toolName,
    toolCallId: call.callId,
    input: call.input,
  };
  if (envelope && pause && envelope.kind === EPauseKind.TOOL_APPROVAL) {
    return {
      ...base,
      state: "approval-requested",
      approval: {
        id: pause.pauseId,
        ...envelope.reasonCode ? {requestReason: envelope.reasonCode} : {},
      },
    };
  }
  if (!result) {
    return {
      ...base,
      state: "input-available",
    };
  }
  if (result.rejected) {
    return {
      ...base,
      state: "output-denied",
      approval: {
        id: call.callId,
        approved: false,
        reason: outputText(result.output),
      },
    };
  }
  if (result.failed || result.denied) {
    return {
      ...base,
      state: "output-error",
      errorText: outputText(result.failed ? (result.output as {error?: unknown}).error : result.output),
    };
  }
  return {
    ...base,
    state: "output-available",
    output: result.output,
  };
};

const outputText = (output: unknown): string => typeof output === "string" ? output : JSON.stringify(output);
