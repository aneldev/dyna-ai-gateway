import {
  IFileRef,
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {
  IMessage,
  IModelResult,
  EFinishReason,
  EMessageRole,
} from "../../llm-client";

import {TurnBuilder} from "../TurnBuilder";

const file: IFileRef = {
  id: "file-1",
  tenantId: "tenant-a",
  userId: "user-a",
  mime: "image/png",
  size: 3,
  name: "photo.png",
};

const makeResult = (overrides: Partial<IModelResult> = {}): IModelResult => ({
  modelId: "model-a",
  text: "answer",
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 10,
    outputTokens: 2,
  },
  latencyMs: 5,
  traceId: "trace-1",
  ...overrides,
});

const toolCall = {
  kind: EPartKind.TOOL_CALL as const,
  callId: "call-1",
  toolName: "getInvoice",
  input: {id: "4521"},
};

const toolResult = {
  kind: EPartKind.TOOL_RESULT as const,
  callId: "call-1",
  toolName: "getInvoice",
  output: {total: 30},
};

const makeTurn = (role: ETurnRole, parts: ITurn["parts"]): ITurn => ({
  id: `turn-${role}`,
  role,
  parts,
  createdAt: new Date(1_000),
});

describe("TurnBuilder", () => {
  const builder = new TurnBuilder();

  describe("M1", () => {
    test("buildUserTurn gives a USER turn with the text part first and one file part per file", () => {
      const turn = builder.buildUserTurn({
        prompt: "hello",
        files: [file],
      });
      expect([turn.role, turn.parts]).toEqual([
        ETurnRole.USER,
        [
          {
            kind: EPartKind.TEXT,
            text: "hello",
          },
          {
            kind: EPartKind.FILE,
            file,
          },
        ],
      ]);
    });

    test("buildUserTurn gives no text part for an empty prompt", () => {
      const turn = builder.buildUserTurn({
        prompt: "",
        files: [file],
      });
      expect(turn.parts.map(part => part.kind)).toEqual([EPartKind.FILE]);
    });

    test("buildUserTurn gives every turn its own id", () => {
      const build = (): ITurn => builder.buildUserTurn({
        prompt: "hello",
        files: [],
      });
      expect(build().id).not.toBe(build().id);
    });

    test("buildAssistantTurns gives one ASSISTANT turn with the text, the tool calls, usage and modelId", () => {
      const turns = builder.buildAssistantTurns({result: makeResult({toolCalls: [toolCall]})});
      expect(turns).toHaveLength(1);
      expect(turns[0]).toMatchObject({
        role: ETurnRole.ASSISTANT,
        parts: [
          {
            kind: EPartKind.TEXT,
            text: "answer",
          },
          toolCall,
        ],
        usage: {
          inputTokens: 10,
          outputTokens: 2,
        },
        modelId: "model-a",
      });
    });

    test("buildAssistantTurns gives no text part when the result has no text", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult({
          text: "",
          toolCalls: [toolCall],
        }),
      });
      expect(turns[0].parts).toEqual([toolCall]);
    });

    test("toMessages maps the turn roles to message roles", () => {
      const messages = builder.toMessages({
        turns: [
          makeTurn(ETurnRole.USER, [{
            kind: EPartKind.TEXT,
            text: "q",
          }]),
          makeTurn(ETurnRole.ASSISTANT, [toolCall]),
          makeTurn(ETurnRole.TOOL, [{
            kind: EPartKind.TOOL_RESULT,
            callId: "call-1",
            toolName: "getInvoice",
            output: {total: 1},
          }]),
        ],
      });
      expect(messages.map(message => message.role)).toEqual([EMessageRole.USER, EMessageRole.ASSISTANT, EMessageRole.TOOL]);
    });

    test("toMessages drops file parts and keeps the other parts", () => {
      const messages = builder.toMessages({
        turns: [
          makeTurn(ETurnRole.USER, [
            {
              kind: EPartKind.TEXT,
              text: "look",
            },
            {
              kind: EPartKind.FILE,
              file,
            },
          ]),
        ],
      });
      expect(messages[0].parts).toEqual([{
        kind: EPartKind.TEXT,
        text: "look",
      }]);
    });

    test("toMessages drops a turn that had only file parts", () => {
      const messages = builder.toMessages({
        turns: [
          makeTurn(ETurnRole.USER, [{
            kind: EPartKind.FILE,
            file,
          }]),
        ],
      });
      expect(messages).toEqual([]);
    });
  });

  describe("M2 — buildAssistantTurns with runMessages", () => {
    const runMessages: IMessage[] = [
      {
        role: EMessageRole.ASSISTANT,
        parts: [toolCall],
      },
      {
        role: EMessageRole.TOOL,
        parts: [toolResult],
      },
      {
        role: EMessageRole.ASSISTANT,
        parts: [{
          kind: EPartKind.TEXT,
          text: "The invoice total is 30.",
        }],
      },
    ];

    test("gives one turn per run message, in order, with the roles mapped", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages,
      });
      expect(turns.map(turn => turn.role)).toEqual([ETurnRole.ASSISTANT, ETurnRole.TOOL, ETurnRole.ASSISTANT]);
    });

    test("keeps the parts of each message: tool call, tool result, text", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages,
      });
      expect(turns.map(turn => turn.parts)).toEqual(runMessages.map(message => message.parts));
    });

    test("takes the parts from the messages, not from result.text", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult({text: "ignored when runMessages are given"}),
        runMessages,
      });
      expect(JSON.stringify(turns)).not.toContain("ignored when runMessages are given");
    });

    test("puts the usage on the last assistant turn only", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages,
      });
      expect(turns.map(turn => turn.usage)).toEqual([
        undefined,
        undefined,
        {
          inputTokens: 10,
          outputTokens: 2,
        },
      ]);
    });

    test("puts the modelId on every assistant turn and on no tool turn", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages,
      });
      expect(turns.map(turn => turn.modelId)).toEqual(["model-a", undefined, "model-a"]);
    });

    test("keeps a rejected tool result as rejected", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages: [{
          role: EMessageRole.TOOL,
          parts: [{
            ...toolResult,
            output: "too expensive",
            rejected: true,
          }],
        }],
      });
      expect(turns[0].parts[0]).toMatchObject({
        rejected: true,
        output: "too expensive",
      });
    });

    test("turns a user message of the run into a USER turn", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages: [{
          role: EMessageRole.USER,
          parts: [{
            kind: EPartKind.TEXT,
            text: "invoice 4521",
          }],
        }],
      });
      expect(turns.map(turn => turn.role)).toEqual([ETurnRole.USER]);
    });

    test("drops inline file parts, and a message that had nothing else", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages: [{
          role: EMessageRole.USER,
          parts: [{
            kind: EPartKind.INLINE_FILE,
            mime: "image/png",
            bytes: new Uint8Array([1]),
            name: "photo.png",
            fileId: "file-photo",
            size: 1,
          }],
        }],
      });
      expect(turns).toEqual([]);
    });

    test("gives no turns for a run that produced no messages", () => {
      expect(builder.buildAssistantTurns({
        result: makeResult(),
        runMessages: [],
      })).toEqual([]);
    });

    test("gives every turn its own id", () => {
      const turns = builder.buildAssistantTurns({
        result: makeResult(),
        runMessages,
      });
      expect(new Set(turns.map(turn => turn.id)).size).toBe(3);
    });
  });
});
