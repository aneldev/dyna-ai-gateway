import {randomUUID} from "node:crypto";

import {
  IFileRef,
  ITurn,
  TTurnPart,
  EPartKind,
  ETurnRole,
} from "../../contracts";

import {
  IMessage,
  IModelResult,
  TMessagePart,
  EMessageRole,
} from "../llm-client";

import {ITurnBuilder} from "./types";

const MESSAGE_ROLES: Record<ETurnRole, EMessageRole> = {
  [ETurnRole.USER]: EMessageRole.USER,
  [ETurnRole.ASSISTANT]: EMessageRole.ASSISTANT,
  [ETurnRole.TOOL]: EMessageRole.TOOL,
};

const TURN_ROLES: Record<EMessageRole, ETurnRole> = {
  [EMessageRole.USER]: ETurnRole.USER,
  [EMessageRole.ASSISTANT]: ETurnRole.ASSISTANT,
  [EMessageRole.TOOL]: ETurnRole.TOOL,
};

/** Converts between ITurn (storage) and IMessage (LLMClient request). Stateless. */
export class TurnBuilder implements ITurnBuilder {
  /** Wraps the user's prompt and uploaded file pointers into a user turn. An empty prompt gives no text part. */
  public buildUserTurn(
    {
      prompt,
      files,
    }: {
      prompt: string;
      files: IFileRef[];
    },
  ): ITurn {
    return {
      id: randomUUID(),
      role: ETurnRole.USER,
      parts: [
        ...prompt
          ? [{
            kind: EPartKind.TEXT as const,
            text: prompt,
          }]
          : [],
        ...files.map((file): TTurnPart => ({
          kind: EPartKind.FILE,
          file,
        })),
      ],
      createdAt: new Date(),
    };
  }

  /**
   * Splits a LLMClient result into assistant (and tool) turns, with usage and modelId.
   * Without runMessages (complete): one assistant turn with the text and the unexecuted tool calls.
   * With runMessages (run): one turn per message the run produced, in order — the parts come from the messages, and
   * `result` gives the modelId of every assistant turn and the usage of the last one.
   */
  public buildAssistantTurns(
    {
      result,
      runMessages,
    }: {
      result: IModelResult;
      /** Messages produced during a run (tool calls and results); omit for complete(). */
      runMessages?: IMessage[];
    },
  ): ITurn[] {
    if (!runMessages) {
      return [
        {
          id: randomUUID(),
          role: ETurnRole.ASSISTANT,
          parts: [
            ...result.text
              ? [{
                kind: EPartKind.TEXT as const,
                text: result.text,
              }]
              : [],
            ...result.toolCalls,
          ],
          usage: result.usage,
          modelId: result.modelId,
          createdAt: new Date(),
        },
      ];
    }

    const turns = runMessages
      .map((message): ITurn => ({
        id: randomUUID(),
        role: TURN_ROLES[message.role],
        // Inline files are bytes for the model, not storage: a turn keeps IFilePart pointers only
        parts: message.parts.filter((part): part is TMessagePart & TTurnPart => part.kind !== EPartKind.INLINE_FILE),
        ...message.role === EMessageRole.ASSISTANT ? {modelId: result.modelId} : {},
        createdAt: new Date(),
      }))
      .filter(turn => turn.parts.length > 0);

    const lastAssistantTurn = [...turns].reverse().find(turn => turn.role === ETurnRole.ASSISTANT);
    if (lastAssistantTurn) lastAssistantTurn.usage = result.usage;
    return turns;
  }

  /**
   * Converts stored turns into LLMClient messages. IFilePart is always dropped here (pointers, no bytes); the gateway
   * inlines the current turn's files via IContextInput.inlineFiles. A turn left without parts is dropped too.
   */
  public toMessages(
    {turns}: {turns: ITurn[]},
  ): IMessage[] {
    return turns
      .map((turn): IMessage => ({
        role: MESSAGE_ROLES[turn.role],
        parts: turn.parts.filter((part): part is TMessagePart & TTurnPart => part.kind !== EPartKind.FILE),
      }))
      .filter(message => message.parts.length > 0);
  }
}
