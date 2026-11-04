import {dynaError} from "dyna-error";

import {
  IPage,
  IPageArgs,
} from "../../contracts";
import {
  IPromptTemplate,
  IPromptTemplateRepository,
  EPromptTemplateKey,
} from "../../internal/prompt-template-store";

/**
 * InMemoryPromptTemplateRepository -- the prompt-template repository in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out, one entry per key + version.
 *
 * Implements `IPromptTemplateRepository` so the `PromptTemplateStore` runs with no infrastructure.
 *
 * - Keeps every saved version; `loadActive` filters, `listVersions` pages by version number.
 * - `setActive` flips the flags of one key in one call, as a real adapter does in one transaction.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`) and the dev sandbox; a host app uses its own adapter.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Any test or local run that needs templates without a database.
 *
 * ## When shouldn't use it
 *
 * Production: nothing survives the process.
 */
export class InMemoryPromptTemplateRepository implements IPromptTemplateRepository {
  private readonly templates = new Map<string, IPromptTemplate>();

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
  public async loadActive(): Promise<IPromptTemplate[]> {
    return structuredClone([...this.templates.values()].filter(template => template.isActive));
  }

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
  public async get(
    {
      key,
      version,
    }: {
      key: EPromptTemplateKey;
      version: number;
    },
  ): Promise<IPromptTemplate | null> {
    const template = this.templates.get(makeId(key, version));
    return template ? structuredClone(template) : null;
  }

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
  public async listVersions(
    {
      key,
      page: {
        limit,
        startingAfter,
        endingBefore,
      },
    }: {
      key: EPromptTemplateKey;
      page: IPageArgs<number>;
    },
  ): Promise<IPage<IPromptTemplate>> {
    const cursor = startingAfter ?? endingBefore;
    if (cursor !== null && !this.templates.has(makeId(key, cursor))) {
      throw dynaError({
        code: 5386034892563,
        status: 404,
        message: `InMemoryPromptTemplateRepository: cursor version ${cursor} of template [${key}] does not exist`,
        data: {
          key,
          version: cursor,
        },
      });
    }
    const newestFirst = [...this.templates.values()]
      .filter(template => template.key === key)
      .filter(template => startingAfter === null || template.version > startingAfter)
      .filter(template => endingBefore === null || template.version < endingBefore)
      .sort((a, b) => b.version - a.version);
    // Reading newer than a cursor walks up from it: the page is the `limit` items next to the cursor, not the newest ones.
    const items = startingAfter === null
      ? newestFirst.slice(0, limit)
      : newestFirst.slice(-limit);
    return {
      items: structuredClone(items),
      hasMore: newestFirst.length > limit,
    };
  }

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
  public async save(
    {template}: {template: IPromptTemplate},
  ): Promise<void> {
    this.templates.set(makeId(template.key, template.version), structuredClone(template));
  }

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
  public async setActive(
    {
      key,
      version,
    }: {
      key: EPromptTemplateKey;
      version: number;
    },
  ): Promise<void> {
    if (!this.templates.has(makeId(key, version))) {
      throw dynaError({
        code: 5386034892574,
        status: 404,
        message: `InMemoryPromptTemplateRepository: version ${version} of template [${key}] does not exist`,
        data: {
          key,
          version,
        },
      });
    }
    const updatedAt = new Date();
    for (const template of this.templates.values()) {
      if (template.key !== key) continue;
      const isActive = template.version === version;
      if (template.isActive === isActive) continue;
      template.isActive = isActive;
      template.updatedAt = updatedAt;
    }
  }
}

/** The Map key of one version: `key#version`. */
const makeId = (key: EPromptTemplateKey, version: number): string => `${key}#${version}`;
