import {
  IAIProfile,
  IAIProfileRepository,
} from "../../internal/ai-profile-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/** Profiles per tenant in a Map. Copies in and out, like a database. */
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

  public async loadByTenant(
    {tenantId}: {tenantId: string},
  ): Promise<IAIProfile[]> {
    const profiles = [...this.profiles.values()].filter(profile => profile.tenantId === tenantId);
    return structuredClone(profiles);
  }

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
