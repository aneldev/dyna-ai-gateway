// Entry of the sandbox chat, started by ./sandbox.cli.sh <ask|run> (see README.md); the gateway is the one of sandbox.config.ts.
import {styleText} from "node:util";

import {sampleUser} from "../tests/internal/samples/profiles";

import {
  config,
  profileId,
} from "./sandbox.config";
import {createSandboxAIGateway} from "./utils/createSandboxAIGateway";
import {
  devConsole,
  EDevConsole,
} from "./utils/devConsole";
import {parseArgs} from "./utils/parseArgs";
import {runChatSession} from "./utils/runChatSession";

const main = async (): Promise<void> => {
  const {mode} = parseArgs({argv: process.argv.slice(2)});
  // The chat shows what README "In the chat" promises: the events, the traced model calls, a thrown error.
  // The debugger session keeps every channel off; the developer switches them on in the console (dynaEnv.devConsole).
  devConsole.setActive(EDevConsole.RUN_CHAT_SESSION, true);
  devConsole.setActive(EDevConsole.TRACE, true);

  console.log("#", styleText("bold", `AIGateway sandbox chat — ${mode}`));

  const {
    aiGateway,
    kbFilters,
  } = await createSandboxAIGateway({config});

  await runChatSession({
    gateway: aiGateway,
    mode,
    userContext: sampleUser,
    profileId,
    kbFilters,
  });
};

main()
  .catch((error: unknown) => {
    console.error("sandbox-cli-catch-P001", styleText("red", error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
