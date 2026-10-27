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

const DEFAULT_CACHE_TTL_MS = 60_000;
const MAX_PAGE_LIMIT = 200;

interface IActiveCache {
  /** The active template of every key. */
  templates: IPromptTemplate[];
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
   * Returns the active template of a key. Cached.
   * Falls back to the seed (version 0) when the repository has no active version: the host's `seedTemplates` entry
   * for the key, else the shipped one; throws when there is neither.
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

  /** Fills the slots of the active template; throws on a missing slot. */
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
   * The versions of a key for the admin UI, highest version first; the cursors are version numbers.
   * Throws a 400 for a limit outside 1–200 or both cursors at once, a 404 for an unknown cursor.
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

  /** Admin: saves a new version (inactive), numbered after the newest existing one. */
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

  /** Admin: activates one version, deactivates the others of that key. Throws when the version does not exist. */
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

  /** Drops the cache and reloads the active templates. */
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
