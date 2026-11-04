import {
  ITurn,
  TTurnPart,
  EPartKind,
} from "../../contracts";

/** The longest tool input or output a transcript keeps when the caller names no `maxToolChars`. */
const DEFAULT_MAX_TOOL_CHARS = 500;

/**
 * toTranscript -- turns as plain text, for the helper calls that read a conversation instead of continuing it
 *
 * # About
 *
 * > One line per part: "user: …", "assistant: …", "assistant calls <tool>: <input>", "tool <tool>: <output>".
 *
 * The memory update and the fact extraction send the conversation to a cheap model as data, not as messages to continue;
 * this is that text. A file part becomes "[file <name>, <mime>]"; tool inputs and outputs are JSON, cut to `maxToolChars`
 * with an ellipsis; a rejected tool result says so.
 *
 * # Who needs it
 *
 * `WorkingMemory` (the summary update) and `UserMemoryStore.extract`.
 */
export const toTranscript = (
  {
    turns,
    maxToolChars = DEFAULT_MAX_TOOL_CHARS,
  }: {
    turns: ITurn[];
    /**
     * Longest tool input or output kept, in characters.
     *
     * @default 500
     */
    maxToolChars?: number;
  },
): string =>
  turns
    .flatMap(turn => turn.parts.map(part => toLine(turn, part, maxToolChars)))
    .join("\n");

/** One part as one line: the role in lowercase, then the text, the file, the call or the result. */
const toLine = (turn: ITurn, part: TTurnPart, maxToolChars: number): string => {
  // Prose for the model: the role as a lowercase word, not the enum value
  const role = turn.role.toLowerCase();
  switch (part.kind) {
    case EPartKind.TEXT:
      return `${role}: ${part.text}`;
    case EPartKind.FILE:
      return `${role}: [file ${part.file.name}, ${part.file.mime}]`;
    case EPartKind.TOOL_CALL:
      return `${role} calls ${part.toolName}: ${cut(part.input, maxToolChars)}`;
    case EPartKind.TOOL_RESULT:
      return `tool ${part.toolName}${part.rejected ? " (rejected by the user)" : ""}: ${cut(part.output, maxToolChars)}`;
  }
};

/** A value as text (JSON unless it is a string), cut to `maxChars` with an ellipsis. */
const cut = (value: unknown, maxChars: number): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
};
