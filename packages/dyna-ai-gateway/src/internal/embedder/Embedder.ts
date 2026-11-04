import {dynaError} from "dyna-error";

import {ILLMClientCallMeta} from "../llm-client";

import {
  IEmbedder,
  IEmbedderConfig,
  IEmbedderDeps,
} from "./types";

const DEFAULT_BATCH_SIZE = 64;

/**
 * Embedder -- text to vector, with the one embedding model of the platform
 *
 * # About
 *
 * > The same ruler for write and read: what is stored and what is searched are measured alike.
 *
 * Implements `IEmbedder`: a thin class over `LLMClient.embed` that batches the texts (`batchSize` per call), keeps the
 * order and checks that the model returned one vector per text, each of `dimensions` numbers; a vector of another length
 * cannot be compared with the ones in the index. Exposes `embeddingModelId` and `dimensions`, so the `VectorStore` and the
 * `KbIngestor` can check the index against them.
 *
 * The embedding model is a platform setting, not a tenant choice: vectors of different models are not comparable, and
 * changing it means re-ingesting every knowledge base.
 *
 * # Who needs it
 *
 * `KbIngestor.ingestDocument` (`embed`, write side) and `KbRetriever.retrieve` (`embedOne`, read side);
 * `KbIngestor.checkIndex` reads `embeddingModelId` and `dimensions`. A host replaces it with its own `IEmbedder` in
 * `overrides.embedder`.
 *
 * # What needs
 *
 * `llmClient` for the provider call.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.embedder`.
 *
 * ## When shouldn't use it
 *
 * A host with its own embedding service implements `IEmbedder` and passes it in `overrides`; it must report the same
 * `dimensions` as its index.
 *
 * # Pitfalls
 *
 * `embeddingModelId` must be a model with `caps.embeddings` in the `ModelRegistry`, else every call is a 400 from the
 * `LLMClient`. `dimensions` is not verified against the model at construction: a wrong value is found on the first call
 * (error 5372630367840).
 */
export class Embedder implements IEmbedder {
  constructor(
    private readonly config: IEmbedderConfig,
    private readonly deps: IEmbedderDeps,
  ) {}

  /**
   * embed -- the vectors of many texts
   *
   * # About
   *
   * > One vector per text, in the same order, all of the same length.
   *
   * Sends the texts in batches of `batchSize` to `LLMClient.embed`, one call after the other, and returns the vectors in
   * the order of the texts. Throws when a batch comes back with another number of vectors than texts (error
   * 5372630367606, a 502) or with a vector of another length than `dimensions` (error 5372630367840, a 500).
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, for the chunks of one document (heading path and text together); `embedOne`.
   *
   * # Pitfalls
   *
   * A failing batch stops the call; the vectors of the earlier batches are lost, nothing is written. Every batch is one
   * usage-guard check and one trace of kind EMBED.
   */
  public async embed(
    {
      texts,
      meta,
    }: {
      texts: string[];
      /** For the usage adapter and the trace; kind = EMBED. */
      meta: ILLMClientCallMeta;
    },
  ): Promise<number[][]> {
    const batchSize = this.config.batchSize ?? DEFAULT_BATCH_SIZE;
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const embedded = await this.deps.llmClient.embed({
        modelId: this.config.embeddingModelId,
        texts: batch,
        meta,
      });
      if (embedded.length !== batch.length) {
        throw dynaError({
          code: 5372630367606,
          status: 502,
          message: `Embedder: model [${this.config.embeddingModelId}] returned ${embedded.length} vectors for ${batch.length} texts`,
          data: {embeddingModelId: this.config.embeddingModelId},
        });
      }
      const wrong = embedded.find(vector => vector.length !== this.config.dimensions);
      if (wrong) {
        throw dynaError({
          code: 5372630367840,
          status: 500,
          message: `Embedder: model [${this.config.embeddingModelId}] returned a vector of ${wrong.length} dimensions, the config says ${this.config.dimensions}`,
          data: {
            embeddingModelId: this.config.embeddingModelId,
            expected: this.config.dimensions,
            received: wrong.length,
          },
        });
      }
      vectors.push(...embedded);
    }
    return vectors;
  }

  /**
   * embedOne -- the vector of one text
   *
   * # About
   *
   * > The query side of `embed`.
   *
   * `embed` with one text; returns its vector.
   *
   * # Who needs it
   *
   * `KbRetriever.retrieve`, for the rewritten query of every call with a knowledge base.
   */
  public async embedOne(
    {
      text,
      meta,
    }: {
      text: string;
      meta: ILLMClientCallMeta;
    },
  ): Promise<number[]> {
    const [vector] = await this.embed({
      texts: [text],
      meta,
    });
    return vector;
  }

  /**
   * dimensions -- the length of every vector this embedder produces
   *
   * # About
   *
   * > The ruler's length.
   *
   * The configured `dimensions`, as the index must have been created with.
   *
   * # Who needs it
   *
   * `KbIngestor.checkIndex`, compared with `VectorStore.describeIndex` before every ingest.
   */
  public get dimensions(): number {
    return this.config.dimensions;
  }

  /**
   * embeddingModelId -- the model every vector comes from
   *
   * # About
   *
   * > Written with every record, so the index can refuse a vector of another model.
   *
   * The configured `embeddingModelId`.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, on every `IChunkRecord` it writes; `KbIngestor.checkIndex`, compared with the index.
   */
  public get embeddingModelId(): string {
    return this.config.embeddingModelId;
  }
}
