import {
  IPage,
  IPageArgs,
} from "../../contracts";

/** Configuration of the PromptTemplateStore. Lands in IAIGatewayConfig.promptTemplateStore. */
export interface IPromptTemplateStoreConfig {
  /** Persistence; Mongo in v1. */
  repository: IPromptTemplateRepository;
  /** Default 60_000. */
  cacheTtlMs?: number;
  /**
   * Seed body of a template key, used as version 0 while the repository has no active version for that key.
   *
   * > Lets the host ship its own default wording without a repository write.
   *
   * Every key is optional; a key not given here keeps the shipped seed of the library.
   * An active version in the repository always wins over any seed.
   * A body may use any subset of the placeholders of its key; a placeholder outside the list throws at render.
   *
   * Placeholders per key:
   * - `CHAT_MAIN`: `{format}`, `{addendum}`, `{today}`, `{locale}`, `{timezone}`, `{instructions}`, `{context}`, `{memory}`, `{kb}`
   * - `MEMORY_WORKING`: `{maxSummaryChars}`, `{maxFacts}`, `{summary}`, `{facts}`
   * - `MEMORY_USER`: `{maxFacts}`, `{facts}`
   * - `KB_QUERY_REWRITE`: `{summary}`, `{facts}`
   * - `THREAD_TITLE`: no shipped seed; a body here is its only version 0
   *
   * The shipped bodies are the reference for the wording and the layout of every placeholder:
   * `src/internal/prompt-template-store/utils/seedTemplates.ts`.
   *
   * @default the shipped seed templates of the library
   */
  seedTemplates?: Partial<Record<EPromptTemplateKey, string>>;
}

/**
 * The prompts as data: every prompt text the gateway writes, keyed by job and versioned.
 *
 * Implemented by `PromptTemplateStore`; the type of `IAIGatewayDeps.promptTemplateStore`, so a host may pass its own in `overrides`.
 */
export interface IPromptTemplateStore {
  /**
   * Returns the active template of a key. Cached.
   * Falls back to the seed (version 0) when the repository has no active version: the host's `seedTemplates` entry
   * for the key, else the shipped one; throws when there is neither.
   */
  get(args: {key: EPromptTemplateKey}): Promise<IPromptTemplate>;

  /** Fills the slots of the active template; throws on a missing slot. */
  render(args: {
    key: EPromptTemplateKey;
    /** Slot values; keys match {slot} names. */
    slots: Record<string, string>;
  }): Promise<IRenderedPrompt>;

  /**
   * The versions of a key for the admin UI, highest version first; the cursors are version numbers.
   * Throws a 400 for a limit outside 1–200 or both cursors at once, a 404 for an unknown cursor.
   */
  listVersions(args: {
    key: EPromptTemplateKey;
    page: IPageArgs<number>;
  }): Promise<IPage<IPromptTemplate>>;

  /** Admin: saves a new version (inactive), numbered after the newest existing one. */
  addVersion(args: {
    key: EPromptTemplateKey;
    body: string;
  }): Promise<IPromptTemplate>;

  /** Admin: activates one version, deactivates the others of that key. Throws when the version does not exist. */
  activate(args: {
    key: EPromptTemplateKey;
    version: number;
  }): Promise<void>;

  /** Drops the cache and reloads the active templates. */
  refresh(): Promise<void>;
}

/**
 * Persistence seam of the prompt templates: the active rows whole, the history of a key paged.
 *
 * Implemented by the host's adapter (Mongo in v1, `InMemoryPromptTemplateRepository` in tests); only the `PromptTemplateStore` calls it.
 * A template is identified by `key` + `version`.
 */
export interface IPromptTemplateRepository {
  /** The active template of every key; at most one per key. */
  loadActive(): Promise<IPromptTemplate[]>;
  /** One version, or null when it does not exist. */
  get(args: {
    key: EPromptTemplateKey;
    version: number;
  }): Promise<IPromptTemplate | null>;
  /**
   * The versions of a key, highest version first.
   * The cursors are version numbers; an unknown cursor throws a 404.
   */
  listVersions(args: {
    key: EPromptTemplateKey;
    page: IPageArgs<number>;
  }): Promise<IPage<IPromptTemplate>>;
  /** Upsert by `key` + `version`. */
  save(args: {template: IPromptTemplate}): Promise<void>;
  /**
   * Activates one version and deactivates the others of its key, as one operation.
   * The version must exist; throws a 404 otherwise.
   */
  setActive(args: {
    key: EPromptTemplateKey;
    version: number;
  }): Promise<void>;
}

/** One versioned prompt text. */
export interface IPromptTemplate {
  key: EPromptTemplateKey;
  version: number;
  /** Text with {slot} placeholders. */
  body: string;
  /** Exactly one active version per key. */
  isActive: boolean;
  updatedAt: Date;
}

/** Jobs that need a prompt. One key per LLM call type. */
export enum EPromptTemplateKey {
  /** System prompt of the main chat/agent call. */
  CHAT_MAIN = "CHAT_MAIN",
  /** Update thread summary + facts. */
  MEMORY_WORKING = "MEMORY_WORKING",
  /** Extract durable user facts. */
  MEMORY_USER = "MEMORY_USER",
  /** Rewrite the user prompt into a search query. */
  KB_QUERY_REWRITE = "KB_QUERY_REWRITE",
  /** Generate a thread title. */
  THREAD_TITLE = "THREAD_TITLE",
}

/** A rendered prompt with provenance for Trace. */
export interface IRenderedPrompt {
  key: EPromptTemplateKey;
  version: number;
  text: string;
}
