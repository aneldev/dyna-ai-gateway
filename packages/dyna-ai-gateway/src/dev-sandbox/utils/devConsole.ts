import {ConsoleController} from "../../utils/consoleController";

export enum EDevConsole {
  TRACE = "TRACE",
  RUN_CHAT_SESSION = "RUN_CHAT_SESSION",
  INGEST_SAMPLE_KB = "INGEST_SAMPLE_KB",
  KB_RETRIEVER = "KB_RETRIEVER",
  USER_MEMORY_STORE = "USER_MEMORY_STORE",
}

export const devConsole = new ConsoleController<EDevConsole>({
  active: {
    TRACE: false,
    RUN_CHAT_SESSION: false,
    INGEST_SAMPLE_KB: false,
    KB_RETRIEVER: false,
    USER_MEMORY_STORE: false,
  },
});
