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
 * ConsoleTraceRepository -- the in-memory trace that prints every model call
 *
 * # About
 *
 * > What the gateway built and sent, shown the moment the LLMClient records it.
 *
 * `InMemoryTraceRepository` plus printing on the `TRACE` channel: the system prompt, the messages and the limits of the
 * main call and of the helper calls (memory, query rewrite, embed), as the `ITraceEntry` the trace saved. Shaped for the
 * output mode: CLI prints a label line and the entry as colourised JSON text; DEBUG prints the label and the entry
 * object itself, expandable in the dev-tools console.
 *
 * - Printed once per entry, on its first save; the later `annotate` saves of the same entry are silent.
 * - `traces` keeps every entry, latest version, in save order, for `dynaEnv.traces`.
 *
 * # Who needs it
 *
 * `createSandboxAIGateway`, which puts it in the config in place of the given trace repository.
 *
 * # Pitfalls
 *
 * The `TRACE` channel of `devConsole` must be on, or nothing prints: the chat switches it on, the debugger session
 * leaves it off.
 */
export class ConsoleTraceRepository extends InMemoryTraceRepository {
  private readonly tracesById = new Map<string, ITraceEntry>();

  constructor(
    private readonly config: {outputMode: EDevOutputMode},
  ) {
    super();
  }

  /**
   * traces -- every recorded entry
   *
   * # About
   *
   * > Latest version of each, in the order of the first save.
   */
  public get traces(): ITraceEntry[] {
    return [...this.tracesById.values()];
  }

  /**
   * save -- stores the entry and prints it the first time
   *
   * # About
   *
   * > The parent's `save`, then one print per new entry id.
   *
   * A re-save (`Trace.annotate`) updates the kept entry silently.
   */
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

/**
 * The entry as JSON can show it: its `request` through `toPrintableRequest`.
 * An entry whose request was not stored says so instead.
 */
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
