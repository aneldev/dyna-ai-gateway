import {
  IAIProfile,
  IAIProfileRepository,
} from "../../internal/ai-profile-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * InMemoryAIProfileRepository -- the profile repository in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out.
 *
 * Implements `IAIProfileRepository` so the `AIProfileStore` runs with no infrastructure. One entry per tenant + profile id;
 * the constructor seeds the profiles a setup wants present from the start.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryAIProfileRepository implements IAIProfileRepository {
  private readonly profiles = new Map<string, IAIProfile>();

  constructor(
    {profiles = []}: {
      /** Profiles present from the start, as if saved before (each under its own `tenantId`); a dev or test setup seeds them here. */
      profiles?: IAIProfile[];
    } = {},
  ) {
    for (const profile of profiles) this.profiles.set(makeTenantKey(profile.tenantId, profile.id), structuredClone(profile));
  }

  /**
   * loadByTenant -- every profile of a tenant
   *
   * # About
   *
   * > The whole set, for the store's cache.
   *
   * Returns every profile stored under the tenant, in any order; empty for a tenant without one.
   *
   * # Who needs it
   *
   * `AIProfileStore.getProfiles`, when the tenant's profiles are not in its cache yet.
   */
  public async loadByTenant(
    {tenantId}: {tenantId: string},
  ): Promise<IAIProfile[]> {
    const profiles = [...this.profiles.values()].filter(profile => profile.tenantId === tenantId);
    return structuredClone(profiles);
  }

  /**
   * save -- inserts or replaces one profile
   *
   * # About
   *
   * > Upsert by `tenantId` + `profile.id`.
   *
   * The profile is stored whole under the tenant; a profile with the same id is replaced.
   *
   * # Who needs it
   *
   * `AIProfileStore.upsertProfile`.
   */
  public async save(
    {
      tenantId,
      profile,
    }: {
      tenantId: string;
      profile: IAIProfile;
    },
  ): Promise<void> {
    this.profiles.set(
      makeTenantKey(tenantId, profile.id),
      structuredClone({
        ...profile,
        tenantId: tenantId,
      }),
    );
  }

  /**
   * remove -- deletes one profile
   *
   * # About
   *
   * > Permanent; nothing when it does not exist.
   *
   * Removes the profile of the tenant with this id; a missing one is not an error.
   *
   * # Who needs it
   *
   * `AIProfileStore.removeProfile`.
   */
  public async remove(
    {
      tenantId,
      profileId,
    }: {
      tenantId: string;
      profileId: string;
    },
  ): Promise<void> {
    this.profiles.delete(makeTenantKey(tenantId, profileId));
  }
}
