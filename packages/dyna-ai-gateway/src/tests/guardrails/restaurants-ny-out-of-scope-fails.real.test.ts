import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
  EModelProvider,
  ETraceKind,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigRestaurantsNy,
  restaurantScopeRule,
} from "./restaurants-ny.real.config";

/**
 * A question about another country fails with the judge's issue before the agent runs: the response is FAILED with the rule's
 * ERROR issue and no RUN_STEP was traced.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — restaurants of New York: out of scope, real provider", () => {
  test("a question about another country fails with the judge's issue; the model is never run", async () => {
    const gateway = new AIGateway(gatewayConfigRestaurantsNy);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Where can I get a good pizza in Paris, France?",
      kbFilters: noKb,
    }).response;

    const runSteps = await gateway.trace.query({
      tenantId: sampleUserContext.tenantId,
      filters: {kind: ETraceKind.RUN_STEP},
      skip: 0,
      limit: 10,
    });
    expect([
      response.kind,
      response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.severity]),
      runSteps,
    ]).toEqual([
      EGatewayResponseKind.FAILED,
      [[restaurantScopeRule.name, EIssueSeverity.ERROR]],
      [],
    ]);
  });
});
