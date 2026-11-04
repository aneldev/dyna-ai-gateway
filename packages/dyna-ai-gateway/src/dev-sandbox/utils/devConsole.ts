import {ConsoleController} from "../../utils/consoleController";

/**
 * The channels of the sandbox's console: what prints when it is on.
 *
 * The keys of `devConsole`; the chat switches `RUN_CHAT_SESSION` and `TRACE` on, the debugger session nothing
 * (`dynaEnv.devConsole.setActive(dynaEnv.EDevConsole.TRACE, true)`).
 */
export enum EDevConsole {
  /** Every traced model call, every failed tool call and guardrail rule (`ConsoleTraceRepository`, `print*ErrorReport`). */
  TRACE = "TRACE",
  /** The chat loop: the start and close lines, every event of a call, a thrown error. */
  RUN_CHAT_SESSION = "RUN_CHAT_SESSION",
  /** One line per sample document ingested at start. */
  INGEST_SAMPLE_KB = "INGEST_SAMPLE_KB",
  /** Reserved for the retriever's own output; nothing prints on it today. */
  KB_RETRIEVER = "KB_RETRIEVER",
  /** Reserved for the user memory's own output; nothing prints on it today. */
  USER_MEMORY_STORE = "USER_MEMORY_STORE",
}

/** The sandbox's console: every channel off until an entry or the developer switches it on. */
export const devConsole = new ConsoleController<EDevConsole>({
  active: {
    TRACE: false,
    RUN_CHAT_SESSION: false,
    INGEST_SAMPLE_KB: false,
    KB_RETRIEVER: false,
    USER_MEMORY_STORE: false,
  },
});
