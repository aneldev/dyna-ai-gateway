/** A piece of text that is never cut, with what joins it to the next piece. */
export interface IMdUnit {
  text: string;
  separator: string;
}

const FENCE = /^\s*(```|~~~)/;
const PARAGRAPH_SEPARATOR = "\n\n";
const LINE_SEPARATOR = "\n";
const SENTENCE_SEPARATOR = " ";

/**
 * Cuts a text into the pieces a chunk is packed from: paragraphs; a paragraph over maxTokens becomes its lines, a line over
 * maxTokens its sentences, a sentence over maxTokens groups of words. A fenced code block is one piece, however long it is.
 */
export const toUnits = (
  {
    text,
    maxTokens,
    countTokens,
  }: {
    text: string;
    maxTokens: number;
    countTokens: (text: string) => number;
  },
): IMdUnit[] =>
  toBlocks(text).flatMap((block): IMdUnit[] => {
    if (FENCE.test(block) || block.includes("\n```") || block.includes("\n~~~") || countTokens(block) <= maxTokens) {
      return [
        {
          text: block,
          separator: PARAGRAPH_SEPARATOR,
        },
      ];
    }
    // Lines first (a list keeps its items), then the sentences of a line that is too long, then groups of words
    const units = block.split("\n").flatMap((line): IMdUnit[] => {
      const pieces = countTokens(line) <= maxTokens
        ? [line]
        : line
          .split(/(?<=[.!?…])\s+/)
          .flatMap(sentence => countTokens(sentence) <= maxTokens ? [sentence] : groupWords(sentence, maxTokens, countTokens));
      return pieces.map((piece, index): IMdUnit => ({
        text: piece,
        separator: index === pieces.length - 1 ? LINE_SEPARATOR : SENTENCE_SEPARATOR,
      }));
    });
    units[units.length - 1].separator = PARAGRAPH_SEPARATOR;
    return units;
  });

/** Paragraphs: text between blank lines. Blank lines inside a fenced code block do not end it. */
const toBlocks = (text: string): string[] => {
  const blocks: string[] = [];
  let lines: string[] = [];
  let openFence = "";

  const flush = (): void => {
    const block = lines.join("\n").trim();
    if (block) blocks.push(block);
    lines = [];
  };

  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line)?.[1];
    if (fence && (!openFence || fence === openFence)) openFence = openFence ? "" : fence;
    if (!line.trim() && !openFence) flush();
    else lines.push(line);
  }
  flush();
  return blocks;
};

const groupWords = (sentence: string, maxTokens: number, countTokens: (text: string) => number): string[] => {
  const groups: string[] = [];
  let group = "";
  for (const word of sentence.split(/\s+/)) {
    const candidate = group ? `${group} ${word}` : word;
    if (group && countTokens(candidate) > maxTokens) {
      groups.push(group);
      group = word;
    }
    else {
      group = candidate;
    }
  }
  if (group) groups.push(group);
  return groups;
};
