import {EPartKind} from "../../../contracts";

import {IMessage} from "../types";

/**
 * withoutInlineBytes -- the messages with every inlined file emptied of its bytes
 *
 * # About
 *
 * > A file's bytes live in the FileStore only.
 *
 * A copy of the messages whose `INLINE_FILE` parts keep `mime`, `name`, `fileId` and `size` and carry empty `bytes`. What is
 * stored keeps no second copy of an uploaded file: `deleteFile` and `removeFilesByUser` really remove it, and a stored record
 * stays small.
 *
 * # Who needs it
 *
 * `LLMClient`, for the request of a trace entry; `settleRun` and `settleReviewPause`, for the messages of a paused run (a resume
 * loads the bytes again by `fileId`).
 */
export const withoutInlineBytes = (messages: IMessage[]): IMessage[] =>
  messages.map(message => message.parts.some(part => part.kind === EPartKind.INLINE_FILE)
    ? {
      ...message,
      parts: message.parts.map(part => part.kind === EPartKind.INLINE_FILE
        ? {
          ...part,
          bytes: new Uint8Array(0),
        }
        : part),
    }
    : message);
