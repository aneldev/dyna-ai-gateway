import {styleText} from "node:util";

/** JSON tokens: a string that is followed by a colon is a key; the rest are values. */
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * colorizeJson -- `JSON.stringify` with ANSI colours
 *
 * # About
 *
 * > Keys cyan, strings green, numbers yellow, booleans magenta, null grey.
 *
 * `styleText` drops the colours when stdout is not a TTY or `NO_COLOR` is set, so the same call prints plain text in a
 * pipe and in the debugger session.
 *
 * # Who needs it
 *
 * The chat (`runChatSession`, `formatResponse`) and the CLI mode of the printing trace and error reports.
 */
export const colorizeJson = (
  {
    value,
    indent = 2,
  }: {
    value: unknown;
    /** 0 = one line. */
    indent?: number;
  },
): string =>
  JSON.stringify(value, null, indent).replace(TOKEN, (token, quoted?: string, colon?: string): string => {
    if (quoted !== undefined) return colon ? styleText("cyan", quoted) + colon : styleText("green", quoted);
    if (token === "null") return styleText("gray", token);
    if (token === "true" || token === "false") return styleText("magenta", token);
    return styleText("yellow", token);
  });
