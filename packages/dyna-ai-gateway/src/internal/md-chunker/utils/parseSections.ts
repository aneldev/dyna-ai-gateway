/** One heading of a markdown document with the text under it, up to the next heading. */
export interface IMdSection {
  /** The headings above the text, outermost first; empty for text before the first heading. */
  headings: string[];
  /** The heading line as written ("## Time limits"); empty for text before the first heading. */
  headingLine: string;
  /** The text under the heading, trimmed; never empty. */
  body: string;
}

// The level and the rest of the line; the closing #s are stripped by code: one regex for both backtracks cubically on spaces (ReDoS)
const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Splits markdown at its ATX headings (# … ######). A "#" line inside a fenced code block is code, not a heading.
 * A heading with no text of its own gives no section, but stays in the path of the headings below it.
 */
export const parseSections = (
  {markdown}: {markdown: string},
): IMdSection[] => {
  const sections: IMdSection[] = [];
  const stack: Array<{level: number; text: string}> = [];
  let headingLine = "";
  let headings: string[] = [];
  let lines: string[] = [];
  let openFence = "";

  const flush = (): void => {
    const body = lines.join("\n").trim();
    if (body) {
      sections.push({
        headings,
        headingLine,
        body,
      });
    }
    lines = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const fence = FENCE.exec(line)?.[1];
    if (fence && (!openFence || fence === openFence)) openFence = openFence ? "" : fence;
    const heading = openFence || fence ? null : HEADING.exec(line);
    const text = heading ? getHeadingText(heading[2]) : "";
    if (!heading || !text) {
      lines.push(line);
      continue;
    }

    flush();
    const level = heading[1].length;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({
      level,
      text,
    });
    headingLine = line.trim();
    headings = stack.map(entry => entry.text);
  }
  flush();
  return sections;
};

/** The text of a heading without its closing sequence ("Time limits ##" → "Time limits"); a "#" that ends a word stays ("C#"). */
const getHeadingText = (rest: string): string => {
  const trimmed = rest.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end--;
  if (end === trimmed.length) return trimmed;
  if (end === 0) return "";
  const before = trimmed[end - 1];
  return before === " " || before === "\t" ? trimmed.slice(0, end).trimEnd() : trimmed;
};
