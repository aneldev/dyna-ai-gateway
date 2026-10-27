import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {nordwindReturnsDocument} from "../internal/samples/kbDocuments";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  allLibraries,
  gatewayConfigKb,
} from "./kb.real.config";

/**
 * An answer grounded on the knowledge base: the sample document states an invented time limit (34 days), the question asks for it,
 * the answer names it and cites the chunk it came from. The number cannot come from the model's own knowledge.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — ask on the knowledge base, real provider", () => {
  test("the answer names the document's time limit and cites a chunk", async () => {
    const gateway = new AIGateway(gatewayConfigKb);
    await gateway.kbIngestor.ingestDocument({
      tenantId: sampleUserContext.tenantId,
      doc: nordwindReturnsDocument,
    });

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Within how many days can a customer of Nordwind Books ask for a refund?",
      kbFilters: allLibraries,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect([response.text.includes("34"), response.citations.length > 0]).toEqual([true, true]);
  });
});
