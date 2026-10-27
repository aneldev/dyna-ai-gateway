import {MockLanguageModelV4} from "ai/test";

import {EPartKind} from "../../../contracts";

import {EModelProvider} from "../../model-registry";

import {EMessageRole} from "../types";
import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClientSetup,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

/**
 * The trace keeps no copy of an uploaded file: the entry's request holds the file part with its name, type, id and size and
 * empty bytes, while the model got the bytes. `deleteFile` then removes the only copy.
 */
test("a trace entry keeps the file part of the request without its bytes; the model gets the bytes", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{
        type: "text",
        text: "An invoice.",
      }],
      finishReason: {
        unified: "stop",
        raw: undefined,
      },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 2,
          text: 2,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  });
  jest.mocked(createLanguageModel).mockReturnValue(model);
  const {
    client,
    trace,
  } = await makeLLMClientSetup([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});
  const bytes = new Uint8Array([137, 80, 78, 71]);

  await client.complete({
    request: makeRequest({
      messages: [{
        role: EMessageRole.USER,
        parts: [{
          kind: EPartKind.INLINE_FILE,
          mime: "image/png",
          bytes,
          name: "invoice.png",
          fileId: "file-1",
          size: bytes.byteLength,
        }],
      }],
    }),
    meta,
  });

  const [entry] = await trace.query({
    tenantId: meta.tenantId,
    filters: {},
    skip: 0,
    limit: 10,
  });
  const userMessage = model.doGenerateCalls[0].prompt.find(message => message.role === "user");
  const sentFile = userMessage?.role === "user" ? userMessage.content.find(part => part.type === "file") : undefined;
  expect([entry.request?.messages[0].parts, sentFile?.type === "file" ? sentFile.data : undefined]).toEqual([
    [{
      kind: EPartKind.INLINE_FILE,
      mime: "image/png",
      bytes: new Uint8Array(0),
      name: "invoice.png",
      fileId: "file-1",
      size: 4,
    }],
    {
      type: "data",
      data: bytes,
    },
  ]);
});
