import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {ILLMClientCallMeta} from "../../llm-client";
import {ETraceKind} from "../../trace";

import {Embedder} from "../Embedder";
import {IEmbedderConfig} from "../types";

const meta: ILLMClientCallMeta = {
  tenantId: "tenant-a",
  kind: ETraceKind.EMBED,
};

interface ISetup {
  embedder: Embedder;
  llmClient: FakeLLMClient;
}

const setup = (config: Partial<IEmbedderConfig> = {}): ISetup => {
  const llmClient = new FakeLLMClient();
  return {
    llmClient,
    embedder: new Embedder({
      embeddingModelId: "embedding-a",
      dimensions: 2,
      ...config,
    }, {llmClient}),
  };
};

describe("Embedder", () => {
  describe("M5 — embed", () => {
    test("returns the vectors of the model, in the order of the texts", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      llmClient.enqueueEmbed([[1, 0], [0, 1]]);
      expect(await embedder.embed({
        texts: ["a", "b"],
        meta,
      })).toEqual([[1, 0], [0, 1]]);
    });

    test("calls the one embedding model of the config, with the caller's meta", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      llmClient.enqueueEmbed([[1, 0]]);
      await embedder.embed({
        texts: ["a"],
        meta,
      });
      expect(llmClient.embedCalls).toEqual([
        {
          modelId: "embedding-a",
          texts: ["a"],
          meta,
        },
      ]);
    });

    test("splits the texts into batches of batchSize, one call each, and keeps the order", async () => {
      const {
        embedder,
        llmClient,
      } = setup({batchSize: 2});
      llmClient.enqueueEmbed([[1, 1], [2, 2]]);
      llmClient.enqueueEmbed([[3, 3], [4, 4]]);
      llmClient.enqueueEmbed([[5, 5]]);
      const vectors = await embedder.embed({
        texts: ["a", "b", "c", "d", "e"],
        meta,
      });
      expect([llmClient.embedCalls.map(call => call.texts), vectors.map(vector => vector[0])]).toEqual([[["a", "b"], ["c", "d"], ["e"]], [1, 2, 3, 4, 5]]);
    });

    test("the default batch is 64 texts", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      llmClient.enqueueEmbed(Array.from({length: 64}, () => [1, 0]));
      llmClient.enqueueEmbed([[1, 0]]);
      await embedder.embed({
        texts: Array.from({length: 65}, (_item, index) => `text ${index}`),
        meta,
      });
      expect(llmClient.embedCalls.map(call => call.texts.length)).toEqual([64, 1]);
    });

    test("no texts: no call", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      expect([await embedder.embed({
        texts: [],
        meta,
      }), llmClient.embedCalls.length]).toEqual([[], 0]);
    });

    test("a vector of another length than config.dimensions is refused", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      llmClient.enqueueEmbed([[1, 0, 0]]);
      await expect(embedder.embed({
        texts: ["a"],
        meta,
      })).rejects.toMatchObject({
        code: 5372630367840,
        data: {
          expected: 2,
          received: 3,
        },
      });
    });

    test("another number of vectors than texts is refused", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      llmClient.enqueueEmbed([[1, 0]]);
      await expect(embedder.embed({
        texts: ["a", "b"],
        meta,
      })).rejects.toMatchObject({code: 5372630367606});
    });
  });

  describe("M5 — embedOne", () => {
    test("returns the vector of the one text", async () => {
      const {
        embedder,
        llmClient,
      } = setup();
      llmClient.enqueueEmbed([[0.6, 0.8]]);
      expect(await embedder.embedOne({
        text: "refund time limit",
        meta,
      })).toEqual([0.6, 0.8]);
    });
  });

  describe("M5 — getters", () => {
    test("dimensions and embeddingModelId are the ones of the config", () => {
      const {embedder} = setup({
        embeddingModelId: "embedding-b",
        dimensions: 1536,
      });
      expect([embedder.dimensions, embedder.embeddingModelId]).toEqual([1536, "embedding-b"]);
    });
  });
});
