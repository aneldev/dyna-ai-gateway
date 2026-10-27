import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {getCurrentTimeTool} from "../internal/samples/tools";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigTools} from "./tools.real.config";

/**
 * A tool without `policy` runs without a pause: the model calls `get_current_time`, the run finishes with an answer,
 * and the thread holds the tool's result. The profile forbids answering a time question without the tool, so the call is the one path.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — run with a read-only tool, real provider", () => {
  test("a time question runs get_current_time directly and finishes with an answer", async () => {
    const gateway = new AIGateway(gatewayConfigTools);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "What time is it right now?",
      kbFilters: noKb,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const toolResults = await loadToolResults({
      config: gatewayConfigTools,
      threadId: response.threadId,
    });
    expect(toolResults.map(part => part.toolName)).toEqual([getCurrentTimeTool.name]);
  });
});
