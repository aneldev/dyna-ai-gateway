import {
  IModelInfo,
  IModelRegistryRepository,
} from "../../internal/model-registry";

/** Model entries in a Map. Copies in and out, like a database. */
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

  public async loadAll(): Promise<IModelInfo[]> {
    return structuredClone([...this.models.values()]);
  }

  public async save(
    {model}: {model: IModelInfo},
  ): Promise<void> {
    this.models.set(model.id, structuredClone(model));
  }

  public async remove(
    {modelId}: {modelId: string},
  ): Promise<void> {
    this.models.delete(modelId);
  }
}
