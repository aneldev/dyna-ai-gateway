import {dynaError} from "dyna-error";

import {ILLMClientCallMeta} from "../llm-client";

import {
  IEmbedder,
  IEmbedderConfig,
  IEmbedderDeps,
} from "./types";

const DEFAULT_BATCH_SIZE = 64;

/** Text → vector, one fixed model. */
export class Embedder implements IEmbedder {
  constructor(
    private readonly config: IEmbedderConfig,
    private readonly deps: IEmbedderDeps,
  ) {}

  /**
   * Embeds many texts, batched (config.batchSize per LLMClient call, one call after the other). Order preserved.
   * Throws when the model returns another number of vectors than texts, or a vector of another length than config.dimensions:
   * such vectors cannot be compared with the ones in the index.
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

  /** Embeds one text (query side). */
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

  /** Vector length; VectorStore uses it to create the index. */
  public get dimensions(): number {
    return this.config.dimensions;
  }

  /** The model in use; VectorStore stores it with the index to detect mismatches. */
  public get embeddingModelId(): string {
    return this.config.embeddingModelId;
  }
}
