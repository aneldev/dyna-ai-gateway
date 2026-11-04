import {dynaError} from "dyna-error";

import {
  IAIProfile,
  IAIProfileStore,
  IAIProfileStoreConfig,
  IAIProfileStoreDeps,
} from "./types";

/** A tenant's cache TTL when the config names none. */
const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * The in-memory copy of one tenant's profiles, with the time it was read.
 *
 * `AIProfileStore` only; one per tenant, dropped by every admin write on that tenant.
 */
interface ITenantCache {
  /** Every profile of the tenant, as the repository returned them. */
  profiles: IAIProfile[];
  /** When the repository was read (`Date.now()`); the cache is stale after `cacheTtlMs`. */
  loadedAt: number;
}

/**
 * AIProfileStore -- the tenant's choices of how to use AI, one profile per way
 *
 * # About
 *
 * > The one object a tenant touches: which model, which tools, which approvals, which words, which caps.
 *
 * A profile says which model a call uses and how: the allowed tools, the ones that pause for a human, the prompt addendum,
 * the skills, the loop and output caps, the memory strategy, whether a human reviews the answers. A tenant holds as many
 * profiles as it has ways of using AI ("cheap chat", "careful refunds"); every call names one (`profileId`, D103). The
 * profile is then passed as data to the ContextAssembler, the ToolPolicy and the LLMClient.
 *
 * - Tenant-scoped: every method takes `tenantId`, and a profile is never visible across tenants.
 * - Validated at the write: a stored profile names only models, tools and skills that exist.
 * - Cached per tenant with a TTL; an admin write drops the tenant's cache.
 *
 * Created by `createGatewayDeps` after the registries it validates against; read first by every call (`prepareCall`, step 1).
 *
 * # Who needs it
 *
 * `prepareCall` and `AIGateway.resume` read; the host's administration screen writes through `AIGateway.aiProfileStore`.
 *
 * # What needs
 *
 * `IAIProfileStoreConfig` (the repository, the optional TTL) and `IAIProfileStoreDeps`: the ModelRegistry, the ToolRegistry and
 * the SkillRegistry for the validation, the RunStore for `removeProfile`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Reading or editing what a tenant decided about a way of using AI.
 *
 * ## When shouldn't use it
 *
 * Facts about a model (`ModelRegistry`), the prompt texts (`PromptTemplateStore`), what a call may spend (the UsageGuard).
 *
 * # Pitfalls
 *
 * There is no default profile: a call without a `profileId` is refused before it reaches the store (D103). Other instances
 * see an admin write after their cache TTL.
 */
export class AIProfileStore implements IAIProfileStore {
  private readonly cache = new Map<string, ITenantCache>();

  constructor(
    private readonly config: IAIProfileStoreConfig,
    private readonly deps: IAIProfileStoreDeps,
  ) {
  }

  /**
   * getProfile -- one profile of a tenant
   *
   * # About
   *
   * > The first read of every call: which model, which tools, which caps.
   *
   * Reads the tenant's cached profiles and returns a copy. An unknown id, or an id of another tenant, is a 404
   * (`5372567786127`): a profile is never visible across tenants.
   *
   * # Who needs it
   *
   * `prepareCall` (step 1 of `ask` and `run`), `AIGateway.resume` (the profile a paused run continues on, D65).
   */
  public async getProfile(
    {
      tenantId,
      profileId,
    }: {
      tenantId: string;
      profileId: string;
    },
  ): Promise<IAIProfile> {
    const profile = (await this.getProfiles(tenantId)).find(candidate => candidate.id === profileId);
    if (!profile) {
      throw dynaError({
        code: 5372567786127,
        status: 404,
        message: `AIProfileStore: unknown profile [${profileId}] for tenant [${tenantId}]`,
        data: {
          tenantId,
          profileId,
        },
      });
    }
    return structuredClone(profile);
  }

  /**
   * listProfiles -- the profiles of a tenant, for its administration screen and its model menu
   *
   * # About
   *
   * > Every profile of the tenant, as stored; empty for a tenant without one.
   *
   * Read through the tenant's cache like `getProfile`; the order is the repository's.
   */
  public async listProfiles({tenantId}: {tenantId: string}): Promise<IAIProfile[]> {
    return (await this.getProfiles(tenantId)).map(profile => structuredClone(profile));
  }

  /**
   * upsertProfile -- creates or replaces a profile of a tenant, validated against the registries
   *
   * # About
   *
   * > A profile that is stored can be run: every name it holds was checked.
   *
   * Validates before the write: `modelId` and `cheapModelId` (when set) must exist and be enabled in the ModelRegistry (the
   * registry's own 404 or 400 surfaces); every name of `allowedTools` and `approvals` must be registered in the ToolRegistry
   * (400, `data.unknownTools`); the `skills` must have unique, non-empty names (the SkillRegistry's 400, D124). Then saves
   * the profile as given and drops the tenant's cache.
   *
   * # Who needs it
   *
   * The host's administration screen; the tests and the first run, to seed a profile.
   *
   * # Pitfalls
   *
   * The profile is stored whole, so a partial object replaces every field. Other instances see the new version after their
   * cache TTL; a paused run keeps resuming on the profile it was started with, as stored at its resume (D46).
   */
  public async upsertProfile(
    {
      tenantId,
      profile,
    }: {
      tenantId: string;
      profile: IAIProfile;
    },
  ): Promise<void> {
    await this.deps.modelRegistry.getModel({modelId: profile.modelId});
    if (profile.cheapModelId) await this.deps.modelRegistry.getModel({modelId: profile.cheapModelId});
    const registered = new Set(this.deps.toolRegistry.list().map(tool => tool.name));
    const unknownTools = [
      ...profile.allowedTools,
      ...profile.approvals,
    ].filter(name => !registered.has(name));
    if (unknownTools.length > 0) {
      throw dynaError({
        code: 5372567786250,
        status: 400,
        message: `AIProfileStore: profile [${profile.id}] names tools that are not registered: ${unknownTools.join(", ")}`,
        data: {
          profileId: profile.id,
          unknownTools,
        },
      });
    }
    this.deps.skillRegistry.resolve({profile});

    await this.config.repository.save({
      tenantId,
      profile,
    });
    this.cache.delete(tenantId);
  }

  /**
   * removeProfile -- deletes a profile of a tenant
   *
   * # About
   *
   * > A profile a paused run waits on stays: the run resumes on it (D46).
   *
   * An unknown profile is the 404 of `getProfile`. A profile named by a PAUSED run of the tenant is refused with a 409
   * (`data.runIds`): resume or cancel those runs first. There is no default profile to protect (D103). A thread is not
   * bound to a profile (D46), so nothing else holds one.
   */
  public async removeProfile(
    {
      tenantId,
      profileId,
    }: {
      tenantId: string;
      profileId: string;
    },
  ): Promise<void> {
    await this.getProfile({
      tenantId,
      profileId,
    });
    const pausedRuns = (await this.deps.runStore.listPaused({tenantId})).filter(run => run.profileId === profileId);
    if (pausedRuns.length > 0) {
      throw dynaError({
        code: 5377780695111,
        status: 409,
        message: `AIProfileStore: profile [${profileId}] is used by ${pausedRuns.length} paused run(s) of tenant [${tenantId}]; resume or cancel them first`,
        data: {
          tenantId,
          profileId,
          runIds: pausedRuns.map(run => run.id),
        },
      });
    }
    await this.config.repository.remove({
      tenantId,
      profileId,
    });
    this.cache.delete(tenantId);
  }

  /** The tenant's profiles, reloaded from the repository after cacheTtlMs. */
  private async getProfiles(tenantId: string): Promise<IAIProfile[]> {
    const ttlMs = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.loadedAt < ttlMs) return cached.profiles;

    const profiles = await this.config.repository.loadByTenant({tenantId});
    this.cache.set(tenantId, {
      profiles,
      loadedAt: Date.now(),
    });
    return profiles;
  }
}
