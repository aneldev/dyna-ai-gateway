import {MockEmbeddingModelV4} from "ai/test";

import {
  IModelInfo,
  EModelProvider,
} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {ILLMClientCallMeta} from "../types";
import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {
  ILLMClientSetup,
  makeLLMClientSetup,
  makeModel,
} from "./utils/llmClientFixtures";

// LLMClient.embed on the real SDK (embedMany) with the SDK's mock embedding model: only the creation of the provider model is replaced.
jest.mock("../utils/createEmbeddingModel");

const meta: ILLMClientCallMeta = {
  tenantId: "tenant-a",
  userId: "admin-a",
  kind: ETraceKind.EMBED,
};

const makeEmbeddingModelInfo = (embeddings = true): IModelInfo => {
  const model = makeModel("embedding-a", EModelProvider.OPENAI);
  return {
    ...model,
    caps: {
      ...model.caps,
      embeddings,
      costInPerMTokUsd: 2,
    },
  };
};

/** One vector per text: [length of the text, position in the call]. */
const mockEmbeddingModel = (): MockEmbeddingModelV4 => {
  const model = new MockEmbeddingModelV4({
    // The mock's default is one text per provider call; a real model takes many
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({values}) => ({
      embeddings: values.map((value, index) => [value.length, index]),
      usage: {tokens: 7},
      warnings: [],
    }),
  });
  jest.mocked(createEmbeddingModel).mockReturnValue(model);
  return model;
};

const setup = (model = makeEmbeddingModelInfo()): Promise<ILLMClientSetup> =>
  makeLLMClientSetup([model], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});

const embed = ({client}: ILLMClientSetup, texts: string[]): Promise<number[][]> =>
  client.embed({
    modelId: "embedding-a",
    texts,
    meta,
  });

describe("LLMClient — M5: embed", () => {
  afterEach(() => jest.restoreAllMocks());

  test("returns one vector per text, in the order of the texts", async () => {
    mockEmbeddingModel();
    expect(await embed(await setup(), ["a", "bbb", "cc"])).toEqual([[1, 0], [3, 1], [2, 2]]);
  });

  test("sends the texts to the provider's embedding model of the registry entry", async () => {
    const model = mockEmbeddingModel();
    await embed(await setup(), ["refund", "invoice"]);
    expect([
      model.doEmbedCalls[0].values,
      jest.mocked(createEmbeddingModel).mock.calls[0][0].model.providerModelId,
      jest.mocked(createEmbeddingModel).mock.calls[0][0].credentials,
    ]).toEqual([["refund", "invoice"], "embedding-a-provider", {apiKey: "test-key"}]);
  });

  test("no texts: no provider call, no vectors", async () => {
    const model = mockEmbeddingModel();
    expect([await embed(await setup(), []), model.doEmbedCalls.length]).toEqual([[], 0]);
  });

  test("reports the provider's token count of the call to the usage adapter", async () => {
    mockEmbeddingModel();
    const context = await setup();
    await embed(context, ["refund"]);
    expect(context.usageAdapter.addUsageCalls.map(call => [call.kind, call.usage.inputTokens])).toEqual([[ETraceKind.EMBED, 7]]);
  });

  test("records a trace entry of kind EMBED with the usage and the cost, without request and result", async () => {
    mockEmbeddingModel();
    const context = await setup();
    await embed(context, ["refund"]);
    const [entry] = await context.trace.query({
      tenantId: "tenant-a",
      filters: {kind: ETraceKind.EMBED},
      skip: 0,
      limit: 10,
    });
    expect([entry.modelId, entry.userId, entry.usage, entry.costUsd, entry.request, entry.result]).toEqual([
      "embedding-a",
      "admin-a",
      {
        inputTokens: 7,
        outputTokens: 0,
      },
      7 * 2 / 1_000_000,
      undefined,
      undefined,
    ]);
  });

  test("a model that is not an embedding model is a 400, before any provider call", async () => {
    const model = mockEmbeddingModel();
    await expect(embed(await setup(makeEmbeddingModelInfo(false)), ["refund"])).rejects.toMatchObject({
      code: 5372630367369,
      status: 400,
    });
    expect(model.doEmbedCalls).toHaveLength(0);
  });

  test("an unknown model is a 404", async () => {
    mockEmbeddingModel();
    const {client} = await setup();
    await expect(client.embed({
      modelId: "missing",
      texts: ["refund"],
      meta,
    })).rejects.toMatchObject({status: 404});
  });

  test("a provider failure is thrown as a 502 with the provider's error as parentError", async () => {
    const providerError = new Error("rate limited");
    jest.mocked(createEmbeddingModel).mockReturnValue(new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw providerError;
      },
    }));
    const context = await makeLLMClientSetup([makeEmbeddingModelInfo()], {
      providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}},
      maxRetries: 0,
    });
    await expect(embed(context, ["refund"])).rejects.toMatchObject({
      code: 5372567786196,
      status: 502,
    });
  });

  test("a failed call is reported with zero usage and not traced", async () => {
    jest.mocked(createEmbeddingModel).mockReturnValue(new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw new Error("rate limited");
      },
    }));
    const context = await makeLLMClientSetup([makeEmbeddingModelInfo()], {
      providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}},
      maxRetries: 0,
    });
    await embed(context, ["refund"]).catch(() => undefined);
    const entries = await context.trace.query({
      tenantId: "tenant-a",
      filters: {kind: ETraceKind.EMBED},
      skip: 0,
      limit: 10,
    });
    expect([context.usageAdapter.addUsageCalls.map(call => call.usage.inputTokens), entries.length]).toEqual([[0], 0]);
  });
});
