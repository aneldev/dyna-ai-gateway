import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  EPauseKind,
  EResumeAction,
} from "../..";

import {sendEmailTool} from "../internal/samples/tools";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigTools} from "./tools.real.config";

/**
 * A tool with `policy: NEEDS_APPROVAL` pauses the run for approval before it executes: the model calls `send_email`, the response
 * is a TOOL_APPROVAL pause naming the tool; approved, the tool runs, its result is stored and the run finishes with an answer.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — run with a policy: NEEDS_APPROVAL tool, real provider", () => {
  test("send_email pauses for approval; approved, it executes and the run finishes", async () => {
    const gateway = new AIGateway(gatewayConfigTools);

    const paused = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Send an email to bob@example.com with the subject \"Hi\" and the body \"Hello Bob\".",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}: ${JSON.stringify(paused)}`);
    if (paused.envelopes[0].kind !== EPauseKind.TOOL_APPROVAL) throw new Error(`Expected a TOOL_APPROVAL pause, got ${paused.envelopes[0].kind}`);

    const response = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;

    const toolResults = await loadToolResults({
      config: gatewayConfigTools,
      threadId: paused.threadId,
    });
    expect([
      paused.envelopes[0].toolCall.toolName,
      response.kind,
      toolResults.map(part => [part.toolName, part.rejected ?? false]),
    ]).toEqual([
      sendEmailTool.name,
      EGatewayResponseKind.ANSWER,
      [[sendEmailTool.name, false]],
    ]);
  });
});
