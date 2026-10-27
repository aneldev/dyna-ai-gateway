import {
  ITurn,
  TTurnPart,
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {toTranscript} from "../toTranscript";

const makeTurn = (role: ETurnRole, parts: TTurnPart[]): ITurn => ({
  id: "turn-1",
  role,
  parts,
  createdAt: new Date(1_000),
});

const text = (value: string): TTurnPart => ({
  kind: EPartKind.TEXT,
  text: value,
});

const toolResult = (toolName: string, output: unknown, rejected?: boolean): ITurn =>
  makeTurn(ETurnRole.TOOL, [
    {
      kind: EPartKind.TOOL_RESULT,
      callId: "call-1",
      toolName,
      output,
      rejected,
    },
  ]);

describe("toTranscript", () => {
  test("writes one line per text part, with the role of the turn", () => {
    expect(toTranscript({turns: [makeTurn(ETurnRole.USER, [text("refund invoice 4521")]), makeTurn(ETurnRole.ASSISTANT, [text("Done."), text("Anything else?")])]})).toBe("user: refund invoice 4521\nassistant: Done.\nassistant: Anything else?");
  });

  test("writes a tool request with its input as JSON", () => {
    expect(toTranscript({
      turns: [
        makeTurn(ETurnRole.ASSISTANT, [
          {
            kind: EPartKind.TOOL_CALL,
            callId: "call-1",
            toolName: "get_invoice",
            input: {invoiceId: "4521"},
          },
        ]),
      ],
    })).toBe("assistant calls get_invoice: {\"invoiceId\":\"4521\"}");
  });

  test("writes a tool result with its output as JSON", () => {
    expect(toTranscript({turns: [toolResult("get_invoice", {total: 30})]})).toBe("tool get_invoice: {\"total\":30}");
  });

  test("marks a tool call the user rejected", () => {
    expect(toTranscript({turns: [toolResult("refund", "too expensive", true)]})).toBe("tool refund (rejected by the user): too expensive");
  });

  test("cuts a long tool output to maxToolChars", () => {
    expect(toTranscript({
      turns: [toolResult("search", "0123456789")],
      maxToolChars: 4,
    })).toBe("tool search: 0123…");
  });

  test("names a file instead of its content", () => {
    expect(toTranscript({
      turns: [
        makeTurn(ETurnRole.USER, [
          {
            kind: EPartKind.FILE,
            file: {
              id: "file-1",
              tenantId: "tenant-a",
              userId: "user-a",
              mime: "application/pdf",
              size: 10,
              name: "invoice.pdf",
            },
          },
        ]),
      ],
    })).toBe("user: [file invoice.pdf, application/pdf]");
  });

  test("no turns give an empty text", () => {
    expect(toTranscript({turns: []})).toBe("");
  });
});
