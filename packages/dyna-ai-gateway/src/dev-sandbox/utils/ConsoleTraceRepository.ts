import {styleText} from "node:util";

import {
  IModelRequest,
  ITraceEntry,
  InMemoryTraceRepository,
  EPartKind,
} from "../..";

import {colorizeJson} from "./colorizeJson";
import {EDevOutputMode} from "./devOutputMode";
import {
  devConsole,
  EDevConsole,
} from "./devConsole";

/**
 * The in-memory trace, printing every model call as the LLMClient records it: what the gateway built and sent
 * (system prompt, messages, limits), for the main call and the helper calls (memory, query rewrite, embed).
 * One `console.log` per call, shaped for the output mode: CLI = the label and the entry as colourised JSON text;
 * DEBUG = the label and the entry object itself, expandable in the dev-tools console.
 * The later `annotate` saves of the same entry are silent; `traces` has every entry, latest version, in save order.
 */
export class ConsoleTraceRepository extends InMemoryTraceRepository {
  private readonly tracesById = new Map<string, ITraceEntry>();

  constructor(
    private readonly config: {outputMode: EDevOutputMode},
  ) {
    super();
  }

  /** Every recorded entry (latest version), in the order of the first save. */
  public get traces(): ITraceEntry[] {
    return [...this.tracesById.values()];
  }

  public async save({entry}: { entry: ITraceEntry }): Promise<void> {
    await super.save({entry});

    const isNew = !this.tracesById.has(entry.id);
    this.tracesById.set(entry.id, entry);
    if (!isNew) return;

    const {
      kind,
      modelId,
      usage,
      costUsd,
    } = entry;
    const label = `${styleText("blue", "llm call")} ${kind} · ${modelId} · ${usage.inputTokens} in, ${usage.outputTokens} out · $${costUsd.toFixed(6)}`;
    if (this.config.outputMode === EDevOutputMode.DEBUG) {
      devConsole.log(EDevConsole.TRACE, label, entry);
    }
    else {
      devConsole.log(EDevConsole.TRACE, "Label", label);
      devConsole.log(EDevConsole.TRACE, "Payload", colorizeJson({value: toPrintableEntry(entry)}));
    }
  }
}

/** The entry as JSON can show it: its request with the zod schema as a marker and inline file bytes as their size. */
const toPrintableEntry = (entry: ITraceEntry): unknown => ({
  ...entry,
  request: entry.request ? toPrintableRequest(entry.request) : "not stored",
});

/** The request as JSON can show it: the zod schema as a marker, inline file bytes as their size. */
const toPrintableRequest = (request: IModelRequest): unknown => ({
  ...request,
  outputSchema: request.outputSchema ? "<zod schema>" : undefined,
  messages: request.messages.map(message => ({
    ...message,
    parts: message.parts.map(part => part.kind === EPartKind.INLINE_FILE
      ? {
        ...part,
        bytes: `<${part.bytes.byteLength} bytes>`,
      }
      : part),
  })),
});
