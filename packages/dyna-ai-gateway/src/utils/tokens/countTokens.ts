import {
  Tiktoken,
  getEncoding,
} from "js-tiktoken";

import {EModelProvider} from "../../internal/model-registry/types";
import {IInlineFilePart} from "../../internal/llm-client/types";

import {countPdfPages} from "./utils/countPdfPages";
import {readImageSize} from "./utils/readImageSize";

/** Providers whose tokenizer is not public count more tokens than o200k for the same text; this factor errs on the safe side. */
const NON_OPENAI_FACTOR = 1.2;
/** OpenAI vision: a flat charge per image plus one per 512-px tile of the image scaled to fit 2048 and then 768 on the short side. */
const OPENAI_IMAGE_BASE_TOKENS = 85;
const OPENAI_IMAGE_TILE_TOKENS = 170;
const OPENAI_IMAGE_MAX_SIDE = 2048;
const OPENAI_IMAGE_SHORT_SIDE = 768;
const OPENAI_IMAGE_TILE = 512;
/** Anthropic's published rule: width × height / 750, after the image is scaled down to about 1.15 megapixels. */
const PIXELS_PER_TOKEN = 750;
const MAX_IMAGE_PIXELS = 1_150_000;
/** The providers' rule of thumb for a PDF page: its text plus its rendering. */
const TOKENS_PER_PDF_PAGE = 2_000;
/** An image whose header cannot be read, or a file of another kind: the cost of a large image. */
const UNKNOWN_FILE_TOKENS = 1_600;

let encoder: Tiktoken | undefined;

/** The o200k encoder, built on first use; the merge tables are built once per process. */
const getEncoder = (): Tiktoken => {
  encoder ??= getEncoding("o200k_base");
  return encoder;
};

/**
 * countTokens -- the tokens of a text for a provider
 *
 * # About
 *
 * > Count with a real tokenizer, then err on the safe side for the providers that do not publish theirs.
 *
 * OpenAI models are counted exactly with the `o200k_base` encoding (`js-tiktoken`). Anthropic, Google, Mistral and Bedrock
 * keep their tokenizers private; their text is the o200k count × 1.2, a factor that over-counts rather than under-counts,
 * because the number is used to keep a request inside the model's window. No provider given: the safe factor applies.
 *
 * # Who needs it
 *
 * `estimateRequestTokens` (the ContextAssembler's trim and the UsageGuard's `neededTokens`), the `WorkingMemory`'s sliding window.
 *
 * # Pitfalls
 *
 * The first call builds the encoder (tens of milliseconds); encoding is linear in the text, so count a long text once and
 * keep the number rather than recounting it in a loop.
 */
export const countTokens = (
  {
    text,
    provider,
  }: {
    text: string;
    /** Omit when the model is not known; the safe factor is applied then. */
    provider?: EModelProvider;
  },
): number => {
  if (!text) return 0;
  const count = getEncoder().encode(text).length;
  return provider === EModelProvider.OPENAI ? count : Math.ceil(count * NON_OPENAI_FACTOR);
};

/**
 * countFileTokens -- the tokens an inline file costs a model
 *
 * # About
 *
 * > The providers' published formulas, from the file's header alone.
 *
 * An image's width and height are read from its PNG, JPEG, GIF or WebP header. OpenAI charges 85 tokens plus 170 per 512-px
 * tile of the image scaled to fit 2048 px and then 768 px on the short side; the other providers follow Anthropic's rule,
 * width × height / 750 after scaling to about 1.15 megapixels. A PDF costs 2 000 tokens per page, counted from its page
 * objects. A file whose header cannot be read costs a flat 1 600, the price of a large image.
 *
 * # Who needs it
 *
 * `estimateRequestTokens`, for the files of the user's turn.
 *
 * # Pitfalls
 *
 * Estimates, not the bill: the providers resize and tile with rules they change; the output reserve of the ContextAssembler
 * covers the gap. A PDF whose pages are hidden in object streams counts as 0 pages and is charged like an unreadable file.
 */
export const countFileTokens = (
  {
    file,
    provider,
  }: {
    file: IInlineFilePart;
    provider?: EModelProvider;
  },
): number => {
  if (file.mime === "application/pdf") {
    const pages = countPdfPages(file.bytes);
    return pages ? pages * TOKENS_PER_PDF_PAGE : UNKNOWN_FILE_TOKENS;
  }
  const size = readImageSize(file.bytes);
  if (!size || !size.width || !size.height) return UNKNOWN_FILE_TOKENS;
  if (provider === EModelProvider.OPENAI) return countOpenAiImageTokens(size.width, size.height);
  return Math.ceil(Math.min(size.width * size.height, MAX_IMAGE_PIXELS) / PIXELS_PER_TOKEN);
};

/** Scale to fit 2048 × 2048, then the short side to 768, then count 512-px tiles. */
const countOpenAiImageTokens = (width: number, height: number): number => {
  const fit = Math.min(1, OPENAI_IMAGE_MAX_SIDE / Math.max(width, height));
  let scaledWidth = width * fit;
  let scaledHeight = height * fit;
  const shortSide = Math.min(scaledWidth, scaledHeight);
  if (shortSide > OPENAI_IMAGE_SHORT_SIDE) {
    const shrink = OPENAI_IMAGE_SHORT_SIDE / shortSide;
    scaledWidth *= shrink;
    scaledHeight *= shrink;
  }
  const tiles = Math.ceil(scaledWidth / OPENAI_IMAGE_TILE) * Math.ceil(scaledHeight / OPENAI_IMAGE_TILE);
  return OPENAI_IMAGE_BASE_TOKENS + tiles * OPENAI_IMAGE_TILE_TOKENS;
};
