import {dynaError} from "dyna-error";

import {
  IAIProfile,
  IAIProfileStore,
  IAIProfileStoreConfig,
  IAIProfileStoreDeps,
} from "./types";

const DEFAULT_CACHE_TTL_MS = 30_000;

interface ITenantCache {
  profiles: IAIProfile[];
  loadedAt: number;
}

/** Tenant-scoped store of AI Profiles. */
export class AIProfileStore implements IAIProfileStore {
  private readonly cache = new Map<string, ITenantCache>();

  constructor(
    private readonly config: IAIProfileStoreConfig,
    private readonly deps: IAIProfileStoreDeps,
  ) {
  }

  /** Loads one profile; throws if missing. */
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
   * Admin: creates or replaces; validates modelId (and cheapModelId, when set) against ModelRegistry,
   * and allowedTools / approvals against ToolRegistry. The registry's own error surfaces for an unknown or disabled model.
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
