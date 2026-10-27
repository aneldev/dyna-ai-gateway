import {
  IFileRef,
  ITurn,
} from "../../contracts";

import {
  IMessage,
  IModelResult,
} from "../llm-client";

/**
 * Converts between ITurn (storage) and IMessage (LLMClient request). Stateless.
 *
 * Implemented by `TurnBuilder`; the type of `IAIGatewayDeps.turnBuilder`, so a host may pass its own in `overrides`.
 */
export interface ITurnBuilder {
  /** Wraps the user's prompt and uploaded file pointers into a user turn. An empty prompt gives no text part. */
  buildUserTurn(args: {
    prompt: string;
    files: IFileRef[];
  }): ITurn;

  /**
   * Splits a LLMClient result into assistant (and tool) turns, with usage and modelId.
   * Without runMessages (complete): one assistant turn with the text and the unexecuted tool calls.
   * With runMessages (run): one turn per message the run produced, in order — the parts come from the messages, and
   * `result` gives the modelId of every assistant turn and the usage of the last one.
   */
  buildAssistantTurns(args: {
    result: IModelResult;
    /** Messages produced during a run (tool calls and results); omit for complete(). */
    runMessages?: IMessage[];
  }): ITurn[];

  /**
   * Converts stored turns into LLMClient messages. IFilePart is always dropped here (pointers, no bytes); the gateway
   * inlines the current turn's files via IContextInput.inlineFiles. A turn left without parts is dropped too.
   */
  toMessages(args: {turns: ITurn[]}): IMessage[];
}
