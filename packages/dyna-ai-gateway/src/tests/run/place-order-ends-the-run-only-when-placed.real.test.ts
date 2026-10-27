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
  IPlaceOrderOutput,
  gatewayConfigPlaceOrderEndsTheRunOnlyWhenPlaced,
  placeOrderTool,
} from "./place-order-ends-the-run-only-when-placed.real.config";

/** One order on a fresh thread: what the tool returned and whether it ended the run. */
const order = async (gateway: AIGateway, item: string): Promise<{statuses: string[]; endedByTool?: string}> => {
  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: `Please order the ${item}.`,
    kbFilters: noKb,
  }).response;
  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);
  const toolResults = await loadToolResults({
    config: gatewayConfigPlaceOrderEndsTheRunOnlyWhenPlaced,
    threadId: response.threadId,
  });
  return {
    statuses: toolResults.filter(part => part.toolName === placeOrderTool.name).map(part => (part.output as IPlaceOrderOutput).status),
    endedByTool: response.endedByTool,
  };
};

/**
 * `endsRun` as a predicate is asked after the tool ran, with its result (D86): the same tool ends the run when the order was
 * placed and lets it go on when the order is on hold. In both cases the model answers once with the status.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a tool with an endsRun predicate, real provider", () => {
  test("place_order ends the run when its result is placed and not when it is on_hold", async () => {
    const gateway = new AIGateway(gatewayConfigPlaceOrderEndsTheRunOnlyWhenPlaced);

    const headphones = await order(gateway, "wireless headphones");
    const monitor = await order(gateway, "27-inch monitor");

    expect([headphones, monitor]).toEqual([
      {
        statuses: ["placed"],
        endedByTool: placeOrderTool.name,
      },
      {
        statuses: ["on_hold"],
        endedByTool: undefined,
      },
    ]);
  });
});
