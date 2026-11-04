import {
  IModelInfo,
  IModelRegistryRepository,
} from "../../internal/model-registry";

/**
 * InMemoryModelRegistryRepository -- the model catalog in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out.
 *
 * Implements `IModelRegistryRepository` so the `ModelRegistry` runs with no infrastructure. One entry per model id; the
 * constructor seeds the catalog a setup wants present from the start.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryModelRegistryRepository implements IModelRegistryRepository {
  private readonly models = new Map<string, IModelInfo>();

  constructor(
    {models = []}: {
      /** Entries present from the start, as if saved before; a dev or test setup seeds its catalog here. */
      models?: IModelInfo[];
    } = {},
  ) {
    for (const model of models) this.models.set(model.id, structuredClone(model));
  }

  /**
   * loadAll -- every model entry
   *
   * # About
   *
   * > The whole catalog, for the registry's cache.
   *
   * Returns every stored entry, in any order.
   *
   * # Who needs it
   *
   * `ModelRegistry.getCatalog`, on a refresh.
   */
  public async loadAll(): Promise<IModelInfo[]> {
    return structuredClone([...this.models.values()]);
  }

  /**
   * save -- inserts or replaces one entry
   *
   * # About
   *
   * > Upsert by `model.id`.
   *
   * The entry is stored whole; an entry with the same id is replaced.
   *
   * # Who needs it
   *
   * `ModelRegistry.upsertModel` and `setEnabled`.
   */
  public async save(
    {model}: {model: IModelInfo},
  ): Promise<void> {
    this.models.set(model.id, structuredClone(model));
  }

  /**
   * remove -- deletes one entry
   *
   * # About
   *
   * > Permanent; nothing when it does not exist.
   *
   * Removes the entry with this id.
   *
   * # Who needs it
   *
   * `ModelRegistry.removeModel`.
   */
  public async remove(
    {modelId}: {modelId: string},
  ): Promise<void> {
    this.models.delete(modelId);
  }
}
