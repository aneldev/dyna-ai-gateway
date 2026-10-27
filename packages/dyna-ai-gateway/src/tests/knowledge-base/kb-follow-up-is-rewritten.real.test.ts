import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  ETraceKind,
} from "../..";

import {nordwindReturnsDocument} from "../internal/samples/kbDocuments";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  allLibraries,
  gatewayConfigKb,
} from "./kb.real.config";

/**
 * A follow-up on the same thread ("and for a damaged one?") is not searchable as typed: the QueryRewriter turns it into a standalone
 * query from the thread's working memory (written after the first answer), the search finds the damaged-book limit (14 months) and
 * the answer names it. Two chat calls, two memory updates and one rewrite call, so this test is slower than most.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a follow-up on the knowledge base, real provider", () => {
  test("the follow-up is rewritten before the search and answered from the document", async () => {
    const gateway = new AIGateway(gatewayConfigKb);
    await gateway.kbIngestor.ingestDocument({
      tenantId: sampleUserContext.tenantId,
      doc: nordwindReturnsDocument,
    });

    const first = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Within how many days can a customer of Nordwind Books ask for a refund?",
      kbFilters: allLibraries,
    }).response;
    if (first.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${first.kind}: ${JSON.stringify(first)}`);
    // The rewriter resolves the follow-up from the thread's working memory, which is written in the background after the answer
    await gateway.whenIdle();

    const followUp = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      threadId: first.threadId,
      prompt: "And for a damaged one?",
      kbFilters: allLibraries,
    }).response;
    await gateway.whenIdle();
    if (followUp.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${followUp.kind}: ${JSON.stringify(followUp)}`);

    const rewrites = await gateway.trace.query({
      tenantId: sampleUserContext.tenantId,
      filters: {kind: ETraceKind.QUERY_REWRITE},
      skip: 0,
      limit: 10,
    });
    expect([followUp.text.includes("14"), rewrites.length > 0]).toEqual([true, true]);
  });
});
