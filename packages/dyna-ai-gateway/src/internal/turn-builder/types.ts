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
  buildUserTurn(args: {
    prompt: string;
    files: IFileRef[];
  }): ITurn;

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
  buildAssistantTurns(args: {
    result: IModelResult;
    /** Messages produced during a run (tool calls and results); omit for complete(). */
    runMessages?: IMessage[];
  }): ITurn[];

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
  toMessages(args: {turns: ITurn[]}): IMessage[];
}
