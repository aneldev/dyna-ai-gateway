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
  /** The heading path of the chunk, outermost first. */
  headings: string[];
  /** The sections merged into it, in reading order. */
  parts: IMdSection[];
}

/**
 * MdChunker -- splits a Markdown document into the chunks the knowledge base stores
 *
 * # About
 *
 * > One idea per chunk, under its headings, sized for retrieval.
 *
 * Implements `IMdChunker`: a pure transform, Markdown in, `IChunk[]` out, no tenant, no model call, no state. The
 * gateway's own splitter (D23), no library:
 *
 * - One chunk per heading section (`parseSections`); a section under `minTokens` merges with its neighbour.
 * - A section over `maxTokens` is cut at paragraph, line, then sentence borders (`toUnits`), the pieces overlapping by
 *   up to `overlapTokens`; a fenced code block is never cut.
 * - Every chunk carries its heading path ("Title > Heading > Subheading"), the document's ids, tags and language, and
 *   a token estimate (characters / 4, `countTokens`).
 * - Chunk ids are `docId#order`, so re-ingesting a document replaces its chunks cleanly.
 *
 * It is the first step of the ingest path: `KbIngestor` chunks, the `Embedder` embeds, the `VectorStore` stores.
 *
 * # Who needs it
 *
 * `KbIngestor.ingestDocument` (`chunk`, and `countTokens` for the report). A host replaces it with its own `IMdChunker`
 * in `overrides.mdChunker`.
 *
 * # What needs
 *
 * Nothing shared: only its config.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.mdChunker` (optional, all defaults).
 *
 * ## When shouldn't use it
 *
 * Documents that are not Markdown (HTML, PDF text) go through a host chunker that implements `IMdChunker`, or are
 * converted to Markdown first.
 *
 * # Pitfalls
 *
 * The settings are global: every book is chunked alike. A config with `minTokens` or `overlapTokens` at or above
 * `maxTokens`, or a non-positive `maxTokens`, is a 400 at construction (error 5372621037192). The token estimate is a
 * ruler for sizing, not the provider's count.
 */
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
   * chunk -- the chunks of one document
   *
   * # About
   *
   * > Headings first, size second, code blocks never cut.
   *
   * One chunk per heading section; a section under `minTokens` merges with its neighbour (the earlier one when the two
   * fit, else it is carried into the next); a section over `maxTokens` is cut at paragraph, line, then sentence
   * borders, the pieces overlapping by up to `overlapTokens`. A fenced code block is never cut, so a chunk that holds
   * one can be larger than `maxTokens`. Chunk ids are `docId#order`, deterministic, so the same document gives the same
   * ids again.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, once per saved document, before the texts are embedded.
   *
   * # Pitfalls
   *
   * A document with no heading is one section; a heading with no text of its own gives no chunk but stays in the path of
   * the headings below it. A whole document under `minTokens` stays one small chunk.
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

  /**
   * countTokens -- the chunker's own token estimate of a text
   *
   * # About
   *
   * > The same ruler the sizes were cut with.
   *
   * Characters / 4, rounded up: the estimate `maxTokens`, `minTokens` and `overlapTokens` are measured in, and the
   * `tokens` of every chunk.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, for the `tokens` of the ingest report; `chunk` itself.
   *
   * # Pitfalls
   *
   * An estimate, not the provider's count: a tokenizer counts code and non-latin text differently.
   */
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

  /** The text of a draft: the body; when sections were merged, each body under its heading line. */
  private getText({parts}: IDraft): string {
    if (parts.length === 1) return parts[0].body;
    return parts
      .map(part => [part.headingLine, part.body].filter(Boolean).join("\n"))
      .join("\n\n");
  }

  /** The token estimate of a draft's text. */
  private countDraft(draft: IDraft): number {
    return this.countTokens({text: this.getText(draft)});
  }

  /**
   * A text that fits maxTokens stays whole.
   * A longer one is packed from its units (toUnits) into pieces of up to maxTokens.
   * Each piece opens with the overlap of the one before, dropped when the next unit would not fit behind it.
   */
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

  /** The last units of a piece, up to overlapTokens, that open the next one; never all of them. */
  private getOverlap(units: IMdUnit[]): IMdUnit[] {
    const overlap: IMdUnit[] = [];
    for (const unit of [...units].reverse().slice(0, units.length - 1)) {
      if (this.countUnits([unit, ...overlap]) > this.overlapTokens) break;
      overlap.unshift(unit);
    }
    return overlap;
  }

  /** The units as one text, each followed by its separator except the last. */
  private joinUnits(units: IMdUnit[]): string {
    return units
      .map((unit, index) => index === units.length - 1 ? unit.text : unit.text + unit.separator)
      .join("");
  }

  /** The token estimate of the units joined. */
  private countUnits(units: IMdUnit[]): number {
    return this.countTokens({text: this.joinUnits(units)});
  }

  /** "Title > Heading > Subheading"; the title is not repeated when it is the first heading. */
  private getHeadingPath(title: string, headings: string[]): string {
    return (headings[0] === title ? headings : [title, ...headings]).join(HEADING_PATH_SEPARATOR);
  }
}
