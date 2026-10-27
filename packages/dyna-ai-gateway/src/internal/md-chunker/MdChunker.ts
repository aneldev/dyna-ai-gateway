import {dynaError} from "dyna-error";

import {IChunk} from "../../contracts";

import {
  IKbDocument,
  IMdChunker,
  IMdChunkerConfig,
} from "./types";
import {
  IMdSection,
  parseSections,
} from "./utils/parseSections";
import {
  IMdUnit,
  toUnits,
} from "./utils/toUnits";

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_MIN_TOKENS = 100;
const DEFAULT_OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 4;
const HEADING_PATH_SEPARATOR = " > ";

/** A chunk in the making: one section, or several small ones merged; the heading path is the one of the first that was big enough. */
interface IDraft {
  headings: string[];
  parts: IMdSection[];
}

/** Markdown → IChunk[] (see chapter 1). Stateless. */
export class MdChunker implements IMdChunker {
  private readonly maxTokens: number;
  private readonly minTokens: number;
  private readonly overlapTokens: number;

  constructor(config: IMdChunkerConfig) {
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.minTokens = config.minTokens ?? DEFAULT_MIN_TOKENS;
    this.overlapTokens = config.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
    if (this.maxTokens <= 0 || this.minTokens < 0 || this.overlapTokens < 0 || this.minTokens >= this.maxTokens || this.overlapTokens >= this.maxTokens) {
      throw dynaError({
        code: 5372621037192,
        status: 400,
        message: "MdChunker: maxTokens must be positive, and minTokens and overlapTokens must be from 0 to less than maxTokens",
        data: {
          maxTokens: this.maxTokens,
          minTokens: this.minTokens,
          overlapTokens: this.overlapTokens,
        },
      });
    }
  }

  /**
   * Splits a document; chunk ids are deterministic per docId + order (`docId#order`).
   * One chunk per heading section; a section under minTokens merges with its neighbour, a section over maxTokens is cut at
   * paragraph, then sentence borders, the pieces overlapping by up to overlapTokens. A fenced code block is never cut,
   * so a chunk that holds one can be larger than maxTokens.
   */
  public chunk(
    {doc}: {doc: IKbDocument},
  ): IChunk[] {
    const drafts = this.mergeSmall(parseSections({markdown: doc.markdown}).map((section): IDraft => ({
      headings: section.headings,
      parts: [section],
    })));
    return drafts
      .flatMap(draft => this.split(this.getText(draft)).map(text => ({
        headingPath: this.getHeadingPath(doc.title, draft.headings),
        text,
      })))
      .map(({
        headingPath,
        text,
      }, order): IChunk => ({
        id: `${doc.id}#${order}`,
        docId: doc.id,
        bookId: doc.bookId,
        libraryId: doc.libraryId,
        headingPath,
        text,
        order,
        tokens: this.countTokens({text}),
        tags: [...doc.tags],
        language: doc.language,
      }));
  }

  /** Token count of a text with the same estimator used for chunking: characters / 4, rounded up. */
  public countTokens(
    {text}: {text: string},
  ): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * A draft under minTokens joins the one before it when the two fit in maxTokens; otherwise it is carried into the next one.
   * Reading order is kept. A document that is small as a whole stays one small chunk.
   */
  private mergeSmall(drafts: IDraft[]): IDraft[] {
    const merged: IDraft[] = [];
    let carried: IDraft | null = null;

    const joinPrevious = (draft: IDraft): boolean => {
      const previous = merged[merged.length - 1];
      if (!previous) return false;
      const joined: IDraft = {
        headings: previous.headings,
        parts: [...previous.parts, ...draft.parts],
      };
      if (this.countDraft(joined) > this.maxTokens) return false;
      merged[merged.length - 1] = joined;
      return true;
    };

    for (const draft of drafts) {
      const current: IDraft = carried
        ? {
          headings: draft.headings,
          parts: [...carried.parts, ...draft.parts],
        }
        : draft;
      carried = null;
      if (this.countDraft(current) >= this.minTokens) merged.push(current);
      else if (!joinPrevious(current)) carried = current;
    }
    if (carried && !joinPrevious(carried)) merged.push(carried);
    return merged;
  }

  /** The text of a draft: its section's text; when sections were merged, each with its heading line. */
  private getText({parts}: IDraft): string {
    if (parts.length === 1) return parts[0].body;
    return parts
      .map(part => [part.headingLine, part.body].filter(Boolean).join("\n"))
      .join("\n\n");
  }

  private countDraft(draft: IDraft): number {
    return this.countTokens({text: this.getText(draft)});
  }

  /** A text that fits stays whole; a longer one is packed from its units into pieces of up to maxTokens that overlap. */
  private split(text: string): string[] {
    if (this.countTokens({text}) <= this.maxTokens) return [text];

    const pieces: string[] = [];
    let current: IMdUnit[] = [];
    const units = toUnits({
      text,
      maxTokens: this.maxTokens,
      countTokens: unitText => this.countTokens({text: unitText}),
    });
    for (const unit of units) {
      if (current.length && this.countUnits([...current, unit]) > this.maxTokens) {
        pieces.push(this.joinUnits(current));
        current = this.getOverlap(current);
        // The overlap is dropped when the next unit would not fit behind it
        if (this.countUnits([...current, unit]) > this.maxTokens) current = [];
      }
      current.push(unit);
    }
    pieces.push(this.joinUnits(current));
    return pieces;
  }

  /** The last units of a piece, up to overlapTokens, that the next piece starts with; never the whole piece. */
  private getOverlap(units: IMdUnit[]): IMdUnit[] {
    const overlap: IMdUnit[] = [];
    for (const unit of [...units].reverse().slice(0, units.length - 1)) {
      if (this.countUnits([unit, ...overlap]) > this.overlapTokens) break;
      overlap.unshift(unit);
    }
    return overlap;
  }

  private joinUnits(units: IMdUnit[]): string {
    return units
      .map((unit, index) => index === units.length - 1 ? unit.text : unit.text + unit.separator)
      .join("");
  }

  private countUnits(units: IMdUnit[]): number {
    return this.countTokens({text: this.joinUnits(units)});
  }

  /** "Title > Heading > Subheading"; the title is not repeated when the document's first heading is the title. */
  private getHeadingPath(title: string, headings: string[]): string {
    return (headings[0] === title ? headings : [title, ...headings]).join(HEADING_PATH_SEPARATOR);
  }
}
