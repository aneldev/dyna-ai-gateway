import {EPartKind} from "../../../contracts";
import {IInlineFilePart} from "../../../internal/llm-client/types";
import {EModelProvider} from "../../../internal/model-registry/types";

import {
  countFileTokens,
  countTokens,
} from "../countTokens";

/** A PNG header: signature, IHDR length and type, then width and height as big-endian 32-bit integers. */
const makePng = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

const makeFile = (mime: string, bytes: Uint8Array): IInlineFilePart => ({
  kind: EPartKind.INLINE_FILE,
  mime,
  bytes,
  name: "file",
  fileId: "file-1",
  size: bytes.length,
});

describe("countTokens", () => {
  test("counts OpenAI text exactly with o200k_base", () => {
    expect(countTokens({
      text: "Hello world",
      provider: EModelProvider.OPENAI,
    })).toBe(2);
  });

  test("code is counted as o200k does: 19 tokens for this line, not its 60 characters / 4", () => {
    const code = "export const add = (a: number, b: number): number => a + b;\n".repeat(20);
    expect(countTokens({
      text: code,
      provider: EModelProvider.OPENAI,
    })).toBe(20 * 19);
  });

  test("Greek text counts far more than one token per four characters", () => {
    const greek = "Καλημέρα κόσμε, τι κάνεις σήμερα;";
    const count = countTokens({
      text: greek,
      provider: EModelProvider.OPENAI,
    });
    expect(count).toBeGreaterThan(greek.length / 4);
  });

  test("the other providers get the o200k count × 1.2, rounded up; no provider counts the same", () => {
    const text = "one two three four five six seven eight nine ten";
    expect([
      countTokens({
        text,
        provider: EModelProvider.ANTHROPIC,
      }),
      countTokens({text}),
    ]).toEqual([12, 12]);
  });

  test("an empty text is 0 tokens", () => {
    expect(countTokens({
      text: "",
      provider: EModelProvider.OPENAI,
    })).toBe(0);
  });
});

describe("countFileTokens", () => {
  test("a 1024×1024 PNG for OpenAI: 85 + 4 tiles × 170", () => {
    expect(countFileTokens({
      file: makeFile("image/png", makePng(1024, 1024)),
      provider: EModelProvider.OPENAI,
    })).toBe(85 + 4 * 170);
  });

  test("a 1024×1024 PNG for Anthropic: width × height / 750", () => {
    expect(countFileTokens({
      file: makeFile("image/png", makePng(1024, 1024)),
      provider: EModelProvider.ANTHROPIC,
    })).toBe(Math.ceil(1024 * 1024 / 750));
  });

  test("a huge image is capped at about 1.15 megapixels for the non-OpenAI providers", () => {
    expect(countFileTokens({
      file: makeFile("image/png", makePng(4000, 4000)),
      provider: EModelProvider.GOOGLE,
    })).toBe(Math.ceil(1_150_000 / 750));
  });

  test("a 3-page PDF costs 3 × 2 000", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Kids [] >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type/Page >> endobj\n4 0 obj <</Type /Page>> endobj\n");
    expect(countFileTokens({
      file: makeFile("application/pdf", pdf),
      provider: EModelProvider.OPENAI,
    })).toBe(6_000);
  });

  test("a file whose header cannot be read costs the flat 1 600", () => {
    expect(countFileTokens({
      file: makeFile("image/png", new Uint8Array([1, 2, 3])),
      provider: EModelProvider.OPENAI,
    })).toBe(1_600);
  });
});
