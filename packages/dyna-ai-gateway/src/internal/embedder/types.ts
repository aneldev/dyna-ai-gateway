import {
  ILLMClient,
  ILLMClientCallMeta,
} from "../llm-client";

/** Configuration of the Embedder. Lands in IAIGatewayConfig.embedder. */
export interface IEmbedderConfig {
  /** The one embedding model; must have caps.embeddings = true. */
  embeddingModelId: string;
  /** Vector length of that model, e.g. 1536. VectorStore needs it to create the index. */
  dimensions: number;
  /** Texts per LLMClient call. Default 64. */
  batchSize?: number;
}

/** Shared instances Embedder needs; created once by AIGateway and passed as the second constructor argument. */
export interface IEmbedderDeps {
  llmClient: ILLMClient;
}

/**
 * Text → vector, one fixed model.
 *
 * Implemented by `Embedder`; the type of `IAIGatewayDeps.embedder`, so a host may pass its own in `overrides`.
 */
export interface IEmbedder {
  /**
   * Embeds many texts, batched (config.batchSize per LLMClient call, one call after the other). Order preserved.
   * Throws when the model returns another number of vectors than texts, or a vector of another length than config.dimensions:
   * such vectors cannot be compared with the ones in the index.
   */
  embed(
    {
      texts,
      meta,
    }: {
      texts: string[];
      /** For the usage adapter and the trace; kind = EMBED. */
      meta: ILLMClientCallMeta;
    },
  ): Promise<number[][]>;

  /** Embeds one text (query side). */
  embedOne(
    {
      text,
      meta,
    }: {
      text: string;
      meta: ILLMClientCallMeta;
    },
  ): Promise<number[]>;

  /** Vector length; VectorStore uses it to create the index. */
  readonly dimensions: number;

  /** The model in use; VectorStore stores it with the index to detect mismatches. */
  readonly embeddingModelId: string;
}
