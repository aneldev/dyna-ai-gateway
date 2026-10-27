import {styleText} from "node:util";

import {
  IChunkFilters,
  IGatewayCall,
  IResumeDecision,
  IUserContext,
  TGatewayResponse,
  AIGateway,
  EGatewayResponseKind,
  EPauseKind,
} from "../..";

import {askPauseDecision} from "./askPauseDecision";
import {colorizeJson} from "./colorizeJson";
import {
  ILineReader,
  createLineReader,
} from "./createLineReader";
import {formatResponse} from "./formatResponse";
import {
  devConsole,
  EDevConsole,
} from "./devConsole";

const EXIT_COMMANDS = ["/exit", "/quit"];

/** Which gateway method the session calls for every prompt. */
export enum ECLIChatbotMode {
  /** `AIGateway.ask()`: one grounded answer, no tools. */
  ASK = "ASK",
  /** `AIGateway.run()`: agent run with tools; a tool that needs approval pauses and the session asks for the decision. */
  RUN = "RUN",
}

/** What every call of the session carries besides the prompt. */
interface ISessionInput {
  /** Who is asking; `now` is added on every call. */
  userContext: Omit<IUserContext, "now">;
  /** The profile every call runs on (D103). */
  profileId: string;
  /** The knowledge-base scope of every call. */
  kbFilters: IChunkFilters;
}

/**
 * The chat loop on one thread, for any gateway: a prompt → `ask` or `run` → the call's events, printed while they arrive →
 * the response as JSON → the response as a user would see it. Ends on `/exit` or EOF.
 */
export const runChatSession = async (
  {
    gateway,
    mode,
    userContext,
    profileId,
    kbFilters,
  }: ISessionInput & {
    gateway: AIGateway;
    mode: ECLIChatbotMode;
  },
): Promise<void> => {
  const reader = createLineReader();
  let threadId: string | undefined;

  devConsole.log(EDevConsole.RUN_CHAT_SESSION, "start", styleText("dim", `Mode ${mode} · ${EXIT_COMMANDS[0]} to leave`));
  for (; ;) {
    const prompt = (await reader.question(styleText("bold", "you > ")))?.trim();
    if (prompt === undefined || EXIT_COMMANDS.includes(prompt)) break;
    if (!prompt) continue;

    try {
      const response = await settlePauses({
        gateway,
        reader,
        userContext: withNow(userContext),
        response: await streamCall({
          call: call({
            gateway,
            mode,
            prompt,
            threadId,
            userContext,
            profileId,
            kbFilters,
          }),
        }),
      });
      threadId = response.threadId ?? threadId;
    }
    catch (error) {
      devConsole.log(EDevConsole.RUN_CHAT_SESSION, "error", styleText("red", "thrown"), colorizeJson({value: toPlainError(error)}));
    }
  }

  reader.close();
  devConsole.log(EDevConsole.RUN_CHAT_SESSION, "close", styleText("dim", "Waiting for background work (memory)…"));
  await gateway.whenIdle();
};

const call = (
  {
    gateway,
    mode,
    prompt,
    threadId,
    userContext,
    profileId,
    kbFilters,
  }: ISessionInput & {
    gateway: AIGateway;
    mode: ECLIChatbotMode;
    prompt: string;
    threadId?: string;
  },
): IGatewayCall => {
  const input = {
    userContext: withNow(userContext),
    threadId,
    profileId,
    prompt,
    kbFilters,
  };
  return mode === ECLIChatbotMode.ASK
    ? gateway.ask(input)
    : gateway.run(input);
};

/** Prints every response; while the run is paused, asks the developer for a decision per card and resumes with all of them. */
const settlePauses = async (
  {
    gateway,
    reader,
    userContext,
    response,
  }: {
    gateway: AIGateway;
    reader: ILineReader;
    userContext: IUserContext;
    response: TGatewayResponse;
  },
): Promise<TGatewayResponse> => {
  let current = response;
  printResponse({response: current});
  while (current.kind === EGatewayResponseKind.PAUSED) {
    const decisions: IResumeDecision[] = [];
    // The developer is the reviewer here: the draft of a review comes from the stored run, as a reviewer's UI reads it (D99)
    if (current.envelopes.some(envelope => envelope.kind === EPauseKind.RESULT_REVIEW)) {
      const stored = await gateway.getPausedRun({
        tenantId: userContext.tenantId,
        runId: current.envelopes[0].runId,
      });
      const [first, ...rest] = stored.pending ?? [];
      if (first) {
        printResponse({
          response: {
            ...current,
            envelopes: [first, ...rest],
          },
        });
      }
    }
    for (const envelope of current.envelopes) {
      const decision = await askPauseDecision({
        reader,
        envelope,
      });
      if (!decision) return current;
      decisions.push("callId" in envelope
        ? {
          ...decision,
          callId: envelope.callId,
        }
        : decision);
    }
    current = await streamCall({
      call: gateway.resume({
        userContext,
        runId: current.envelopes[0].runId,
        pauseId: current.pauseId,
        decisions,
      }),
    });
    printResponse({response: current});
  }
  return current;
};

/** Prints every event of the call while it arrives (what a web client receives), then returns the response. */
const streamCall = async (
  {call}: { call: IGatewayCall },
): Promise<TGatewayResponse> => {
  for await (const event of call.events) {
    devConsole.log(EDevConsole.RUN_CHAT_SESSION, "streamCall", `${styleText("dim", "event")} ${colorizeJson({
      value: event,
      indent: 0,
    })}`);
  }
  return call.response;
};

const printResponse = (
  {response}: { response: TGatewayResponse },
): void => {
  console.log("#", styleText("dim", `TGatewayResponse (${response.kind})`));
  console.log("#", colorizeJson({value: response}));
  console.log("#", styleText("dim", "as the user sees it"));
  console.log("#", formatResponse({response}));
};

const withNow = (userContext: Omit<IUserContext, "now">): IUserContext => ({
  ...userContext,
  now: new Date(),
});

/** A thrown dynaError (or anything else) as a JSON-printable object. */
const toPlainError = (error: unknown): unknown => {
  if (!(error instanceof Error)) return {error};
  const {
    name,
    message,
    ...rest
  } = error as Error & Record<string, unknown>;
  return {
    name,
    message,
    ...rest,
  };
};
