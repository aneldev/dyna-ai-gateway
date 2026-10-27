import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigSupportShop,
  handoverToAgentTool,
} from "./support-shop.real.config";

/**
 * The customer asks for a human: the model calls `handover_to_agent`, a tool with `endsRun: true` (D86). The run ends after that
 * step with one closing sentence from the model, and the answer names the tool, so a UI can move the thread to the agent's queue.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a terminal tool ends the run, real provider", () => {
  test("asking for a human runs handover_to_agent once, the run ends with a closing text and endedByTool", async () => {
    const gateway = new AIGateway(gatewayConfigSupportShop);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "I want to talk to a human agent about my monitor order, please.",
      kbFilters: noKb,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const toolResults = await loadToolResults({
      config: gatewayConfigSupportShop,
      threadId: response.threadId,
    });
    const handovers = toolResults.filter(part => part.toolName === handoverToAgentTool.name);
    expect([
      response.endedByTool,
      handovers.map(part => part.output),
      response.text.length > 0,
    ]).toEqual([
      handoverToAgentTool.name,
      [{
        ticketId: "T-1",
        status: "handed_over",
      }],
      true,
    ]);
  });
});
