import {
  MarkedExtension,
  marked,
} from "marked";
import {markedTerminal} from "marked-terminal";

// @types/marked-terminal types the extension for an older marked; the object is a valid extension (see marked-terminal's README).
marked.use(markedTerminal() as MarkedExtension);

/**
 * renderMarkdown -- Markdown as ANSI-styled terminal text
 *
 * # About
 *
 * > `marked` with `marked-terminal`: headings, lists, tables and code blocks styled; the trailing newline cut.
 *
 * # Who needs it
 *
 * `formatResponse`, for the text of an answer in MARKDOWN format.
 */
export const renderMarkdown = (
  {markdown}: {markdown: string},
): string => String(marked.parse(markdown)).trimEnd();
