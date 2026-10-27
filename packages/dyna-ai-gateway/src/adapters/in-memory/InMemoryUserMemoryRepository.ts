import {
  IUserMemoryFact,
  IUserMemoryRepository,
} from "../../internal/user-memory-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/** User facts per tenant + user in a Map. Copies in and out, like a database. */
export class InMemoryUserMemoryRepository implements IUserMemoryRepository {
  private readonly facts = new Map<string, IUserMemoryFact[]>();

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
