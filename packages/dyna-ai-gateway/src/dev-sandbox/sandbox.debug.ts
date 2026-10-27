// Entry of the debugger session, started by ./sandbox.debug.sh (see README.md, "Debugging").
// No chat: the gateway of sandbox.config.ts is built and kept alive as the global `dynaEnv.aiGateway`.
// The developer calls it from the debugger console, with breakpoints set in src/:
// `await dynaEnv.aiGateway.ask({userContext: dynaEnv.userContext, profileId: dynaEnv.profileId, prompt: "…", kbFilters: dynaEnv.kbFilters})`.
import {styleText} from "node:util";

import {
  IAIGatewayConfig,
  IChunk,
  IChunkFilters,
  ITraceEntry,
  IUserContext,
  AIGateway,
} from "..";
import {sampleUser} from "../tests/internal/samples/profiles";

import {
  config as sandboxConfig,
  profileId as sandboxProfileId,
} from "./sandbox.config";
import {createLineReader} from "./utils/createLineReader";
import {createSandboxAIGateway} from "./utils/createSandboxAIGateway";
import {
  devConsole,
  EDevConsole,
} from "./utils/devConsole";

const USAGE = "Usage: ./sandbox.debug.sh";

/** The global `dynaEnv` of the debugger console: the config, the gateway and what the session accumulates (live getters). */
interface IDynaEnv {
  /** The `IAIGatewayConfig` of the session (sandbox.config.ts with the sandbox's trace and vector adapter); edit it in the console, then `newAIGateway()`. */
  config: IAIGatewayConfig;
  aiGateway: AIGateway;
  /** Replaces `aiGateway` with a new `AIGateway` built from the current `config` and returns it. */
  newAIGateway: () => AIGateway;
  /** `sampleUser` with `now` = the time of the read. */
  readonly userContext: IUserContext;
  /** The profile of every call (`IGatewayAskInput.profileId`, required — D103): sandbox.config.ts's `profileId`; change it in the console. */
  profileId: string;
  /** The knowledge-base scope of every call: every library when the config ingested the samples, otherwise none. */
  kbFilters: IChunkFilters;
  /** Every chunk in the vector index (the ingested sample documents). */
  readonly kbChunks: IChunk[];
  /** Every traced model call so far, latest version, in save order. */
  readonly traces: ITraceEntry[];
  /** The sandbox's console switches: `devConsole.setActive(EDevConsole.TRACE, true)`. */
  devConsole: typeof devConsole;
  EDevConsole: typeof EDevConsole;
}

const main = async (): Promise<void> => {
  const extra = process.argv.slice(2);
  if (extra.length) throw new Error(`Unexpected argument(s): ${extra.join(" ")}\n${USAGE}`);
  const {
    config,
    aiGateway,
    traceRepository,
    vectorIndexAdapter,
    kbFilters,
  } = await createSandboxAIGateway({config: sandboxConfig});

  const dynaEnv: IDynaEnv = {
    config,
    aiGateway,
    newAIGateway(): AIGateway {
      dynaEnv.aiGateway = new AIGateway(dynaEnv.config);
      return dynaEnv.aiGateway;
    },
    get userContext(): IUserContext {
      return {
        ...sampleUser,
        now: new Date(),
      };
    },
    profileId: sandboxProfileId,
    kbFilters,
    get kbChunks(): IChunk[] {
      return vectorIndexAdapter.chunks;
    },
    get traces(): ITraceEntry[] {
      return traceRepository.traces;
    },
    devConsole,
    EDevConsole,
  };
  Object.assign(globalThis, {dynaEnv});

  console.log("#", styleText("bold", "AIGateway debugger session — sandbox.config.ts"));
  console.log("#", styleText("dim", "Global of the debugger console: dynaEnv {config, aiGateway, newAIGateway(), userContext, profileId, kbFilters, kbChunks, traces, devConsole, EDevConsole}. Enter to exit."));
  const reader = createLineReader();
  await reader.question("");
  reader.close();
  console.log("#", styleText("dim", "Waiting for background work (memory)…"));
  await dynaEnv.aiGateway.whenIdle();
};

main()
  .catch((error: unknown) => {
    console.error("#", styleText("red", error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
