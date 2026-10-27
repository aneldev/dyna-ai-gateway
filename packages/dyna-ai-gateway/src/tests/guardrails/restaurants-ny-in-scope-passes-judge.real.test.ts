import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  ETraceKind,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  findRestaurantsTool,
  gatewayConfigRestaurantsNy,
} from "./restaurants-ny.real.config";

/**
 * A question about New York passes the judge rule (one traced GUARDRAIL_JUDGE call), the model calls `find_restaurants`
 * and the answer names restaurants of the DB.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — restaurants of New York: in scope, real provider", () => {
  test("a question about New York passes the judge; the model calls the tool and names its restaurants", async () => {
    const gateway = new AIGateway(gatewayConfigRestaurantsNy);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Where can I get a good pizza in New York?",
      kbFilters: noKb,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    // The judge runs before the thread exists (new thread), so its trace entry has no threadId: query by kind only
    const judgeCalls = await gateway.trace.query({
      tenantId: sampleUserContext.tenantId,
      filters: {kind: ETraceKind.GUARDRAIL_JUDGE},
      skip: 0,
      limit: 10,
    });
    const toolResults = await loadToolResults({
      config: gatewayConfigRestaurantsNy,
      threadId: response.threadId,
    });
    expect([
      judgeCalls.length,
      toolResults.map(part => part.toolName),
      /Joe's Pizza|Lombardi/.test(response.text),
    ]).toEqual([1, [findRestaurantsTool.name], true]);
  });
});
