import {dynaError} from "dyna-error";

import {
  IPage,
  IPageArgs,
} from "../../contracts";

import {
  IPromptTemplate,
  IPromptTemplateStore,
  IPromptTemplateStoreConfig,
  IRenderedPrompt,
  EPromptTemplateKey,
} from "./types";
import {
  SEED_TEMPLATES,
  SEED_VERSION,
} from "./utils/seedTemplates";

/** The cache TTL of the active templates when the config names none. */
const DEFAULT_CACHE_TTL_MS = 60_000;
/** The largest page `listVersions` serves. */
const MAX_PAGE_LIMIT = 200;

/**
 * The in-memory copy of the active templates, with the time they were read.
 *
 * `PromptTemplateStore` only; dropped by `activate` and `refresh`. The history of a key is never cached.
 */
interface IActiveCache {
  /** The active template of every key. */
  templates: IPromptTemplate[];
  /** When the repository was read (`Date.now()`); the cache is stale after `cacheTtlMs`. */
  loadedAt: number;
}

/**
 * PromptTemplateStore -- the prompts as data: every prompt text the gateway writes, keyed by job and versioned
 *
 * # About
 *
 * > A new wording is a new version, activated without a deploy, and every answer can be traced back to the version that produced it.
 *
 * Holds the text of each prompt (`EPromptTemplateKey`: the main chat system prompt, the memory extractors, the query rewriter, the title) and fills its `{slots}` for a call.
 *
 * - One active version per key, served from a cache and refreshed after `cacheTtlMs`.
 * - The history of a key stays in the repository for the admin UI and for rollback; it is read only on request, paged.
 * - The seed (version 0) answers when the repository has no active version, so a fresh database works at once;
 *   the host overrides it per key with `seedTemplates`.
 *
 * Global: one copy for all tenants; tenant flavour comes only through the profile's addendum slot.
 * See docs/architecture "Decisions.md" § PromptTemplateStore.
 *
 * # Who needs it
 *
 * `ContextAssembler` renders `CHAT_MAIN`; `WorkingMemory`, `UserMemoryStore` and `QueryRewriter` render their own key.
 * The admin methods (`listVersions`, `addVersion`, `activate`) are for the host's administration screen.
 *
 * # What needs
 *
 * `IPromptTemplateStoreConfig`: the `IPromptTemplateRepository`, the optional `cacheTtlMs` and the optional `seedTemplates`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Every text that goes to a model as a system prompt; a class asks for its key and never composes prompt text in code.
 *
 * ## When shouldn't use it
 *
 * Per-call or per-tenant text: that is a slot value (`instructions`, `context`, the profile addendum), not a template.
 *
 * # Pitfalls
 *
 * A missing slot throws; render with every slot the active version uses, also with an empty string.
 * `addVersion` saves an inactive version; nothing changes for callers until `activate`.
 * `activate` takes effect for other instances only after their cache expires.
 */
export class PromptTemplateStore implements IPromptTemplateStore {
  private cache: IActiveCache | null = null;

  constructor(private readonly config: IPromptTemplateStoreConfig) {}

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
  public async get(
    {key}: {key: EPromptTemplateKey},
  ): Promise<IPromptTemplate> {
    const active = (await this.getActive()).find(template => template.key === key);
    if (active) return structuredClone(active);

    const seedBody = this.config.seedTemplates?.[key] ?? SEED_TEMPLATES[key];
    if (seedBody === undefined) {
      throw dynaError({
        code: 5372567786094,
        status: 404,
        message: `PromptTemplateStore: no active template and no seed for key [${key}]`,
        data: {key},
      });
    }
    return {
      key,
      version: SEED_VERSION,
      body: seedBody,
      isActive: true,
      updatedAt: new Date(0),
    };
  }

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
  public async render(
    {
      key,
      slots,
    }: {
      key: EPromptTemplateKey;
      /** Slot values; keys match {slot} names. */
      slots: Record<string, string>;
    },
  ): Promise<IRenderedPrompt> {
    const template = await this.get({key});
    const text = template.body.replace(/\{(\w+)\}/g, (_placeholder, slot: string) => {
      const value = slots[slot];
      if (value === undefined) {
        throw dynaError({
          code: 5372567786106,
          status: 400,
          message: `PromptTemplateStore: slot [${slot}] is missing for template [${key}] version ${template.version}`,
          data: {
            key,
            version: template.version,
            slot,
          },
        });
      }
      return value;
    });
    return {
      key,
      version: template.version,
      text,
    };
  }

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
  public async listVersions(
    {
      key,
      page,
    }: {
      key: EPromptTemplateKey;
      page: IPageArgs<number>;
    },
  ): Promise<IPage<IPromptTemplate>> {
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_LIMIT) {
      throw dynaError({
        code: 5386034892541,
        status: 400,
        message: `PromptTemplateStore: limit must be an integer from 1 to ${MAX_PAGE_LIMIT}, got [${page.limit}]`,
        data: {
          key,
          limit: page.limit,
        },
      });
    }
    if (page.startingAfter !== null && page.endingBefore !== null) {
      throw dynaError({
        code: 5386034892552,
        status: 400,
        message: "PromptTemplateStore: startingAfter and endingBefore cannot be used together",
        data: {
          key,
          startingAfter: page.startingAfter,
          endingBefore: page.endingBefore,
        },
      });
    }
    return this.config.repository.listVersions({
      key,
      page,
    });
  }

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
  public async addVersion(
    {
      key,
      body,
    }: {
      key: EPromptTemplateKey;
      body: string;
    },
  ): Promise<IPromptTemplate> {
    const {items: [newest]} = await this.config.repository.listVersions({
      key,
      page: {
        limit: 1,
        startingAfter: null,
        endingBefore: null,
      },
    });
    const template: IPromptTemplate = {
      key,
      version: Math.max(SEED_VERSION, newest?.version ?? SEED_VERSION) + 1,
      body,
      isActive: false,
      updatedAt: new Date(),
    };
    await this.config.repository.save({template});
    return structuredClone(template);
  }

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
  public async activate(
    {
      key,
      version,
    }: {
      key: EPromptTemplateKey;
      version: number;
    },
  ): Promise<void> {
    const existing = await this.config.repository.get({
      key,
      version,
    });
    if (!existing) {
      throw dynaError({
        code: 5372567786115,
        status: 404,
        message: `PromptTemplateStore: version ${version} of template [${key}] does not exist`,
        data: {
          key,
          version,
        },
      });
    }
    await this.config.repository.setActive({
      key,
      version,
    });
    this.cache = null;
  }

  /**
   * refresh -- drops the cache and reloads the active templates from the repository
   *
   * # About
   *
   * > For a host that changed the repository behind the store's back.
   *
   * The next renders use the reloaded versions; nothing else changes.
   */
  public async refresh(): Promise<void> {
    this.cache = null;
    await this.getActive();
  }

  /** The active template of every key, reloaded from the repository after cacheTtlMs. */
  private async getActive(): Promise<IPromptTemplate[]> {
    const ttlMs = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (this.cache && Date.now() - this.cache.loadedAt < ttlMs) return this.cache.templates;

    this.cache = {
      templates: await this.config.repository.loadActive(),
      loadedAt: Date.now(),
    };
    return this.cache.templates;
  }
}
