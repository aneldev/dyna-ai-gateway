/** `/Type /Page` objects, not `/Pages` (the page tree nodes); whitespace between the two names varies by producer. */
const PAGE_OBJECT = /\/Type\s*\/Page(?![s\w])/g;

/**
 * countPdfPages -- the number of pages of a PDF, from its page objects
 *
 * # About
 *
 * > Count the `/Type /Page` objects; no PDF library, no parsing of the content.
 *
 * The bytes are read as Latin-1 (PDF syntax is ASCII, the content streams in between do not matter) and the page objects
 * are counted, not the `/Pages` tree nodes. 0 when none is found: an encrypted PDF, or one whose objects sit in object
 * streams, hides them.
 *
 * # Who needs it
 *
 * `countFileTokens`, for a PDF of the user's turn.
 */
export const countPdfPages = (bytes: Uint8Array): number => {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.match(PAGE_OBJECT)?.length ?? 0;
};
