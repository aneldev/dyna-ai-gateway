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

/** The message role of each turn role: the two enums name the same three roles. */
const MESSAGE_ROLES: Record<ETurnRole, EMessageRole> = {
  [ETurnRole.USER]: EMessageRole.USER,
  [ETurnRole.ASSISTANT]: EMessageRole.ASSISTANT,
  [ETurnRole.TOOL]: EMessageRole.TOOL,
};

/** The turn role of each message role: the reverse of `MESSAGE_ROLES`. */
const TURN_ROLES: Record<EMessageRole, ETurnRole> = {
  [EMessageRole.USER]: ETurnRole.USER,
  [EMessageRole.ASSISTANT]: ETurnRole.ASSISTANT,
  [EMessageRole.TOOL]: ETurnRole.TOOL,
};

/**
 * TurnBuilder -- the converter between what is stored and what the model reads
 *
 * # About
 *
 * > One class knows both shapes: `ITurn` for the ThreadStore, `IMessage` for the LLMClient.
 *
 * A model result becomes typed turns (text, tool calls, tool results, with usage and model id); stored turns become the
 * messages of a request. No other class depends on both formats.
 *
 * - Pure transform: no I/O, no tenant, no state.
 * - File pointers stay in the turns and never reach a message: the bytes are inlined per call by the ContextAssembler
 *   (`IContextInput.inlineFiles`); the inline bytes of a message never reach a turn.
 *
 * Created by `createGatewayDeps` with no deps; sits between the ThreadStore and the LLMClient on every call.
 *
 * # Who needs it
 *
 * `prepareCall` (the user turn), `AIGateway.executeAsk`, `settleRun`, `settleReview`, `settleReviewPause` (the assistant
 * turns), `WorkingMemory` (the window as messages, D122).
 *
 * # Usage
 *
 * ## When to use it
 *
 * Every conversion between a turn and a message.
 *
 * ## When shouldn't use it
 *
 * A conversation as plain text for a helper call (the memory, the facts): `toTranscript`.
 */
export class TurnBuilder implements ITurnBuilder {
  /**
   * buildUserTurn -- the user's question as a turn
   *
   * # About
   *
   * > One text part for the prompt, one file part per uploaded pointer.
   *
   * An empty prompt gives no text part: a question can be files alone. The turn gets a new id and `createdAt` now.
   *
   * # Who needs it
   *
   * `prepareCall`, step 3, with the prompt as the input check returned it.
   */
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
   * buildAssistantTurns -- what the model produced, as the turns to store
   *
   * # About
   *
   * > One turn per message of the answer, with the model id on the assistant turns and the usage on the last one.
   *
   * Without `runMessages` (an `ask`): one assistant turn with the text and the unexecuted tool calls. With `runMessages`
   * (a run): one turn per message the run produced, in order; the parts come from the messages, inline file bytes dropped
   * (a turn keeps pointers only), a message left without parts dropped too. `result` gives the model id of every assistant
   * turn and the usage of the last one.
   *
   * # Who needs it
   *
   * `AIGateway.executeAsk`, `settleRun`, `settleReview` (the reviewed answer), `settleReviewPause` (the tool turns only).
   *
   * # Pitfalls
   *
   * The callers decide what to store: a blocked answer passes the messages without the final text (`withoutFinalAnswer`).
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
   * toMessages -- stored turns as the messages of a request
   *
   * # About
   *
   * > The reverse of `buildAssistantTurns`, minus the files.
   *
   * File parts are always dropped (pointers, no bytes): the ContextAssembler inlines the current turn's files through
   * `IContextInput.inlineFiles`. A turn left without parts is dropped too.
   *
   * # Who needs it
   *
   * `WorkingMemory`, for the window of a call under both strategies (D122).
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
