import {
  EPartKind,
  IToolResultPart,
} from "../../../contracts";

import {ERunOutcomeStatus} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

afterEach(() => jest.restoreAllMocks());

/**
 * The tool ran; only its `endsRun` predicate threw. The call is a success, not a failure: a failed result would tell the model
 * to retry a side effect that already happened. The predicate's throw counts as "does not end the run".
 */
test("an endsRun predicate that throws leaves the call's successful result, and the run goes on", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {text: "Handed over."},
    ],
  });
  probe.hooks.endsRun = (): boolean => {
    throw new Error("A bug in the predicate");
  };

  const outcome = await probe.run();

  const results = outcome.messages.flatMap(message => message.parts)
    .filter((part): part is IToolResultPart => part.kind === EPartKind.TOOL_RESULT);
  expect([outcome.status, outcome.endedByTool, probe.executed, results]).toEqual([
    ERunOutcomeStatus.DONE,
    undefined,
    ["handover"],
    [{
      kind: EPartKind.TOOL_RESULT,
      callId: "call-handover",
      toolName: "handover",
      output: {status: "accepted"},
    }],
  ]);
});
