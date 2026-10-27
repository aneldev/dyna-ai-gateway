import {
  MarkedExtension,
  marked,
} from "marked";
import {markedTerminal} from "marked-terminal";

// @types/marked-terminal types the extension for an older marked; the object is a valid extension (see marked-terminal's README).
marked.use(markedTerminal() as MarkedExtension);

/** Markdown → ANSI-styled text for the terminal (headings, lists, tables, code blocks). */
export const renderMarkdown = (
  {markdown}: {markdown: string},
): string => String(marked.parse(markdown)).trimEnd();
