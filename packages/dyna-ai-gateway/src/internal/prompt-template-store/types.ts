import {
  IPage,
  IPageArgs,
} from "../../contracts";

/** Configuration of the PromptTemplateStore. Lands in IAIGatewayConfig.promptTemplateStore. */
export interface IPromptTemplateStoreConfig {
  /** Persistence of the templates: the host's adapter (in memory for the tests and the first run, a database in production). */
  repository: IPromptTemplateRepository;
  /**
   * How long the active templates stay cached in memory, in milliseconds.
   *
   * > Every call renders CHAT_MAIN; the repository is read once per TTL, not once per call.
   *
   * `activate` on this instance drops the cache at once; another instance renders the new version after its TTL.
   *
   * @example 5_000 - an admin screen whose activations must show fast on every instance
   *
   * @default 60_000
   */
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
   * - `CHAT_MAIN`: `{format}`, `{addendum}`, `{skills}`, `{cacheBreakpoint}`, `{today}`, `{locale}`, `{timezone}`, `{instructions}`, `{context}`, `{memory}`, `{kb}`
   *   `{cacheBreakpoint}` ends the part that is the same on every call of a profile; the provider may cache everything before it.
   *   Only `{format}`, `{addendum}` and `{skills}` may come before it; a template without it is sent as one block, not cached.
   *   A body without `{skills}` drops the skills of a call that has some, with the WARNING issue `skills_slot_missing`.
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
   * get -- the active template of a key
   *
   * # About
   *
   * > The wording in force for a job, with its version.
   *
   * Reads the cached active templates. Falls back to the seed (version 0) when the repository has no active version for the
   * key: the host's `seedTemplates` entry, else the shipped one; a key with neither is a 404.
   *
   * # Who needs it
   *
   * `ContextAssembler`, which needs the body of CHAT_MAIN before it renders (the cache breakpoint, the `{skills}` slot); the
   * other callers go through `render`.
   */
  get(args: {key: EPromptTemplateKey}): Promise<IPromptTemplate>;

  /**
   * render -- the active template of a key with its slots filled
   *
   * # About
   *
   * > The text that goes to the model, and the version that produced it.
   *
   * Replaces every `{slot}` of the active body (`get`) with the value of that name and returns the text with `key` and
   * `version`, so the trace can record which wording produced which answer. A slot without a value is a 400: a silent empty
   * slot is the classic prompt bug. A value given for a slot the body does not use is ignored.
   *
   * # Who needs it
   *
   * `ContextAssembler` (CHAT_MAIN), `WorkingMemory` (MEMORY_WORKING), `UserMemoryStore` (MEMORY_USER), `QueryRewriter`
   * (KB_QUERY_REWRITE): each renders its own key before its model call.
   *
   * # Pitfalls
   *
   * Pass every slot the active version uses, with an empty string when there is nothing to say. A stored version may use
   * fewer slots than the seed, never more than its key's list (`IPromptTemplateStoreConfig.seedTemplates`).
   */
  render(args: {
    key: EPromptTemplateKey;
    /** Slot values; keys match {slot} names. */
    slots: Record<string, string>;
  }): Promise<IRenderedPrompt>;

  /**
   * listVersions -- the history of a key, paged, for the administration screen
   *
   * # About
   *
   * > Every version of a key, highest first; the cursors are version numbers.
   *
   * Validates the page (a `limit` outside 1–200 or both cursors at once is a 400) and reads the repository: the history is
   * never cached. An unknown cursor is the repository's 404.
   *
   * # Who needs it
   *
   * The host's administration screen, before `activate` (pick a version) and after `addVersion` (see it listed).
   */
  listVersions(args: {
    key: EPromptTemplateKey;
    page: IPageArgs<number>;
  }): Promise<IPage<IPromptTemplate>>;

  /**
   * addVersion -- saves a new wording of a key, inactive
   *
   * # About
   *
   * > A new version is a draft until `activate`: nothing changes for the calls.
   *
   * Numbers the version after the newest one of the key (the seed is 0, the first stored version 1) and saves it with
   * `isActive: false`. Returns the stored template.
   *
   * # Who needs it
   *
   * The host's administration screen.
   */
  addVersion(args: {
    key: EPromptTemplateKey;
    body: string;
  }): Promise<IPromptTemplate>;

  /**
   * activate -- makes one version the wording in force for its key
   *
   * # About
   *
   * > One active version per key: this one on, the others off, as one repository operation.
   *
   * The version must exist (404 otherwise). Drops this instance's cache, so its next render uses the version; other
   * instances follow after their TTL.
   *
   * # Who needs it
   *
   * The host's administration screen, for a new wording and for a rollback.
   *
   * # Pitfalls
   *
   * CHAT_MAIN is cached by the provider only when the version keeps `{cacheBreakpoint}` with no per-call slot before it; a
   * version without `{skills}` drops the skills of a call with the WARNING `skills_slot_missing`.
   */
  activate(args: {
    key: EPromptTemplateKey;
    version: number;
  }): Promise<void>;

  /**
   * refresh -- drops the cache and reloads the active templates from the repository
   *
   * # About
   *
   * > For a host that changed the repository behind the store's back.
   *
   * The next renders use the reloaded versions; nothing else changes.
   */
  refresh(): Promise<void>;
}

/**
 * Persistence seam of the prompt templates: the active rows whole, the history of a key paged.
 *
 * Implemented by the host's adapter (Mongo in v1, `InMemoryPromptTemplateRepository` in tests); only the `PromptTemplateStore` calls it.
 * A template is identified by `key` + `version`.
 */
export interface IPromptTemplateRepository {
  /**
   * loadActive -- the active template of every key
   *
   * # About
   *
   * > At most one per key.
   *
   * Returns the versions whose `isActive` is set, in any order.
   *
   * # Who needs it
   *
   * `PromptTemplateStore.getActive`, when the active set is not cached.
   */
  loadActive(): Promise<IPromptTemplate[]>;
  /**
   * get -- one version of a key
   *
   * # About
   *
   * > By `key` + `version`; null when it does not exist.
   *
   * The template as stored, whole.
   *
   * # Who needs it
   *
   * `PromptTemplateStore.activate`, to check the version before it flips.
   */
  get(args: {
    key: EPromptTemplateKey;
    version: number;
  }): Promise<IPromptTemplate | null>;
  /**
   * listVersions -- one page of a key's versions
   *
   * # About
   *
   * > Highest version first; the cursors are version numbers.
   *
   * `endingBefore` reads the `limit` versions below it, `startingAfter` the `limit` versions right above it (the page next to
   * the cursor, not the highest). A cursor that is not a version of the key is a 404. The store has validated `limit` and
   * that only one cursor is set.
   *
   * # Who needs it
   *
   * `PromptTemplateStore.listVersions`; `addVersion`, for the highest version so far.
   */
  listVersions(args: {
    key: EPromptTemplateKey;
    page: IPageArgs<number>;
  }): Promise<IPage<IPromptTemplate>>;
  /**
   * save -- inserts or replaces one version
   *
   * # About
   *
   * > Upsert by `key` + `version`.
   *
   * The template is stored whole; the same key and version is replaced.
   *
   * # Who needs it
   *
   * `PromptTemplateStore.addVersion`.
   */
  save(args: {template: IPromptTemplate}): Promise<void>;
  /**
   * setActive -- activates one version of a key
   *
   * # About
   *
   * > One operation: the version becomes active, the others of the key inactive.
   *
   * The version must exist; throws a 404 otherwise. A real adapter does the flip in one transaction, so no reader sees two
   * active versions or none.
   *
   * # Who needs it
   *
   * `PromptTemplateStore.activate`.
   */
  setActive(args: {
    key: EPromptTemplateKey;
    version: number;
  }): Promise<void>;
}

/** One versioned prompt text. */
export interface IPromptTemplate {
  /** The job the text is for. */
  key: EPromptTemplateKey;
  /** The version within the key: 0 is the seed, stored versions count from 1; `key` + `version` identify a template. */
  version: number;
  /** Text with {slot} placeholders. */
  body: string;
  /** Exactly one active version per key. */
  isActive: boolean;
  /** When the version was saved or activated; the epoch for a seed. */
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
  /** The job the text is for. */
  key: EPromptTemplateKey;
  /** The version that produced the text; recorded on the trace entry of the call. */
  version: number;
  /** The body with every slot filled: the system prompt as the model receives it. */
  text: string;
}
