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
  /**
   * Texts per `LLMClient.embed` call; the batches go one after the other.
   *
   * @default 64
   */
  batchSize?: number;
}

/** Shared instances Embedder needs; created once by AIGateway and passed as the second constructor argument. */
export interface IEmbedderDeps {
  /** The provider call (`embed`), with the usage guard and the trace. */
  llmClient: ILLMClient;
}

/**
 * Text → vector, one fixed model.
 *
 * Implemented by `Embedder`; the type of `IAIGatewayDeps.embedder`, so a host may pass its own in `overrides`.
 */
export interface IEmbedder {
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
  embedOne(
    {
      text,
      meta,
    }: {
      text: string;
      meta: ILLMClientCallMeta;
    },
  ): Promise<number[]>;

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
  readonly dimensions: number;

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
  readonly embeddingModelId: string;
}
