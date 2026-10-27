/** `/Type /Page` objects, not `/Pages` (the page tree nodes); whitespace between the two names varies by producer. */
const PAGE_OBJECT = /\/Type\s*\/Page(?![s\w])/g;

/**
 * Number of pages of a PDF, counted from its page objects; 0 when none is found (an encrypted or object-stream PDF hides them).
 * The bytes are read as Latin-1: PDF syntax is ASCII, the content streams in between do not matter.
 */
export const countPdfPages = (bytes: Uint8Array): number => {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.match(PAGE_OBJECT)?.length ?? 0;
};
