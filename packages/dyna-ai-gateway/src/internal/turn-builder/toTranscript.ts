import {
  ITurn,
  TTurnPart,
  EPartKind,
} from "../../contracts";

const DEFAULT_MAX_TOOL_CHARS = 500;

/**
 * Turns as plain text, one line per part, for the helper calls that read a conversation instead of continuing it
 * (memory, user facts): "user: …", "assistant: …", "assistant calls <tool>: <input>", "tool <tool>: <output>".
 * Tool inputs and outputs are JSON, cut to maxToolChars.
 */
export const toTranscript = (
  {
    turns,
    maxToolChars = DEFAULT_MAX_TOOL_CHARS,
  }: {
    turns: ITurn[];
    /** Longest tool input / output kept, in characters. Default 500. */
    maxToolChars?: number;
  },
): string =>
  turns
    .flatMap(turn => turn.parts.map(part => toLine(turn, part, maxToolChars)))
    .join("\n");

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

const cut = (value: unknown, maxChars: number): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
};
