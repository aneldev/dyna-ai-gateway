/*
 * The public API of the package. Everything an application can import from "dyna-ai-gateway" is listed here, and only
 * what an application is designed to call:
 *   - the facade `AIGateway` with its types, the shared contracts, the in-memory adapters (the app constructs those);
 *   - the types of every internal (`internal/<folder>/types.ts`): interfaces the app reads or implements, enums, unions;
 *   - the internal classes as TYPES ONLY (`export type`): the facade hands them out (`gateway.modelRegistry`, …) and
 *     `IAIGatewayDeps` names them, so the app can name the type, but it never constructs one — the gateway does;
 *   - `defineTool`, the helper for the app's own tools.
 * Never `export *` from `./internal` or from a class file: a class value, the agent loop, a `make*` / `to*` / `create*`
 * helper or a constant of an internal is not public, even when another file of this repo uses it — repo files import
 * those from `./internal`. This is the one file that reaches a folder's `types.ts` directly: the folder barrels also
 * carry the class, and the class must not pass.
 */

export * from "./AIGateway";
export * from "./types";

export * from "./contracts";

export * from "./adapters/in-memory";

export * from "./internal/model-registry/types";
export * from "./internal/ai-profile-store/types";
export * from "./internal/prompt-template-store/types";
export * from "./internal/thread-store/types";
export * from "./internal/file-store/types";
export * from "./internal/working-memory/types";
export * from "./internal/user-memory-store/types";
export * from "./internal/md-chunker/types";
export * from "./internal/embedder/types";
export * from "./internal/vector-store/types";
export * from "./internal/query-rewriter/types";
export * from "./internal/kb-retriever/types";
export * from "./internal/tool-registry/types";
export * from "./internal/tool-policy/types";
export * from "./internal/run-store/types";
export * from "./internal/human-gate/types";
export * from "./internal/usage-guard/types";
export {
  isUsageDeniedError,
} from "./internal/usage-guard/UsageDeniedError";
export * from "./internal/guardrails/types";
export * from "./internal/llm-client/types";
export * from "./internal/llm-client/joinSystem";
export * from "./internal/context-assembler/types";
export * from "./internal/trace/types";
export * from "./internal/kb-ingestor/types";

export type {
  ModelRegistry,
} from "./internal/model-registry";
export type {
  AIProfileStore,
} from "./internal/ai-profile-store";
export type {
  PromptTemplateStore,
} from "./internal/prompt-template-store";
export type {
  ThreadStore,
} from "./internal/thread-store";
export type {
  TurnBuilder,
} from "./internal/turn-builder";
export type {
  FileStore,
} from "./internal/file-store";
export type {
  WorkingMemory,
} from "./internal/working-memory";
export type {
  UserMemoryStore,
} from "./internal/user-memory-store";
export type {
  MdChunker,
} from "./internal/md-chunker";
export type {
  Embedder,
} from "./internal/embedder";
export type {
  VectorStore,
} from "./internal/vector-store";
export type {
  QueryRewriter,
} from "./internal/query-rewriter";
export type {
  KbRetriever,
} from "./internal/kb-retriever";
export type {
  ToolRegistry,
} from "./internal/tool-registry";
export type {
  ToolPolicy,
} from "./internal/tool-policy";
export type {
  RunStore,
} from "./internal/run-store";
export type {
  HumanGate,
} from "./internal/human-gate";
export type {
  UsageGuard,
} from "./internal/usage-guard";
export type {
  Guardrails,
} from "./internal/guardrails";
export type {
  LLMClient,
} from "./internal/llm-client";
export type {
  ContextAssembler,
} from "./internal/context-assembler";
export type {
  Trace,
} from "./internal/trace";
export type {
  KbIngestor,
} from "./internal/kb-ingestor";

export {
  defineTool,
} from "./internal/tool-registry";
