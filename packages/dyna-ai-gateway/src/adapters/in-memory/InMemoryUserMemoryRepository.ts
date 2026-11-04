import {
  IUserMemoryFact,
  IUserMemoryRepository,
} from "../../internal/user-memory-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * InMemoryUserMemoryRepository -- the user-memory repository in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out.
 *
 * Implements `IUserMemoryRepository` so the `UserMemoryStore` runs with no infrastructure. One record per tenant + user,
 * the facts as one list.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryUserMemoryRepository implements IUserMemoryRepository {
  private readonly facts = new Map<string, IUserMemoryFact[]>();

  /**
   * load -- the facts of one user
   *
   * # About
   *
   * > As last saved; `[]` for a user without a record.
   *
   * The user's facts whole, in the order they were saved.
   *
   * # Who needs it
   *
   * `UserMemoryStore.getFacts`.
   */
  public async load(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<IUserMemoryFact[]> {
    return structuredClone(this.facts.get(makeTenantKey(tenantId, userId)) ?? []);
  }

  /**
   * saveAll -- replaces the user's facts
   *
   * # About
   *
   * > The whole list at once; an empty list keeps the record.
   *
   * `clear` saves an empty list; `deleteByUser` removes the record itself.
   *
   * # Who needs it
   *
   * `UserMemoryStore.save`, after an extraction or an edit.
   */
  public async saveAll(
    {
      tenantId,
      userId,
      facts,
    }: {
      tenantId: string;
      userId: string;
      facts: IUserMemoryFact[];
    },
  ): Promise<void> {
    this.facts.set(makeTenantKey(tenantId, userId), structuredClone(facts));
  }

  /**
   * deleteByUser -- removes the record of a user
   *
   * # About
   *
   * > GDPR erasure: nothing is left, not even an empty record.
   *
   * Returns the number of facts removed.
   *
   * # Who needs it
   *
   * `UserMemoryStore.deleteByUser`, for the gateway's `deleteUserData`.
   */
  public async deleteByUser(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<number> {
    const key = makeTenantKey(tenantId, userId);
    const count = this.facts.get(key)?.length ?? 0;
    this.facts.delete(key);
    return count;
  }
}
