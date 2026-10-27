import {AIGateway} from "../../..";
import {
  ModelRegistry,
  AIProfileStore,
  ThreadStore,
  TurnBuilder,
  FileStore,
  WorkingMemory,
  UserMemoryStore,
  MdChunker,
  Embedder,
  VectorStore,
  QueryRewriter,
  KbRetriever,
  ToolRegistry,
  ToolPolicy,
  RunStore,
  HumanGate,
  Guardrails,
  LLMClient,
  ContextAssembler,
  Trace,
  KbIngestor,
} from "../../../internal";

export interface IUnimplementedClass {
  /** The class; the skeleton test reads the members from its prototype. */
  classRef: {
    name: string;
    prototype: object;
  };
  /** Milestone → the public members (methods and getters) that still throw "Not yet implemented". */
  members: Record<string, string[]>;
}

/**
 * Every public member of the Contracts that is not implemented yet, under the milestone that activates it.
 * When a milestone implements a member, remove it from here: the list only shrinks.
 */
export const unimplementedClasses: IUnimplementedClass[] = [
  {
    classRef: ModelRegistry,
    members: {},
  },
  {
    classRef: AIProfileStore,
    members: {},
  },
  {
    classRef: ThreadStore,
    members: {},
  },
  {
    classRef: TurnBuilder,
    members: {},
  },
  {
    classRef: FileStore,
    members: {},
  },
  {
    classRef: WorkingMemory,
    members: {},
  },
  {
    classRef: UserMemoryStore,
    members: {},
  },
  {
    classRef: MdChunker,
    members: {},
  },
  {
    classRef: Embedder,
    members: {},
  },
  {
    classRef: VectorStore,
    members: {},
  },
  {
    classRef: QueryRewriter,
    members: {},
  },
  {
    classRef: KbRetriever,
    members: {},
  },
  {
    classRef: ToolRegistry,
    members: {},
  },
  {
    classRef: ToolPolicy,
    members: {},
  },
  {
    classRef: RunStore,
    members: {},
  },
  {
    classRef: HumanGate,
    members: {},
  },
  {
    classRef: Guardrails,
    members: {},
  },
  {
    classRef: LLMClient,
    members: {},
  },
  {
    classRef: ContextAssembler,
    members: {},
  },
  {
    classRef: Trace,
    members: {},
  },
  {
    classRef: KbIngestor,
    members: {},
  },
  {
    classRef: AIGateway,
    members: {},
  },
];
