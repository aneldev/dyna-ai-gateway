import {styleText} from "node:util";

/** JSON tokens: a string that is followed by a colon is a key; the rest are values. */
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * `JSON.stringify` with ANSI colours: keys cyan, strings green, numbers yellow, booleans magenta, null grey.
 * `styleText` drops the colours when stdout is not a TTY or NO_COLOR is set.
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
