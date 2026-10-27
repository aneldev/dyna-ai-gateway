import {IDynaError} from "dyna-error";

import {
  AIGateway,
  IKbDocument,
  ETraceKind,
  USAGE_DENIED_ERROR_CODE,
  isUsageDeniedError,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  denial,
  gatewayConfigDenyEmbed,
  toVector,
  usageAdapterDenyingEmbed,
} from "./denied.config";

const document: IKbDocument = {
  id: "refund-doc",
  bookId: "tax-book",
  libraryId: "tax",
  title: "Refunds",
  markdown: "A refund is possible within 12 months.",
  tags: [],
  language: "en",
};

/**
 * The app says no to the embedding of an ingestion: there is no response to carry an issue, so `ingestDocument` throws the
 * refusal itself, a 429 the host recognises with `isUsageDeniedError` and whose `data.denyCode` is the app's code. Nothing was
 * embedded, so nothing is reported.
 */
test("an ingestion whose embedding the app refuses throws a 429 carrying the app's code", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenyEmbed, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.embedWith(toVector);

  let thrown: unknown;
  try {
    await gateway.kbIngestor.ingestDocument({
      tenantId: sampleUserContext.tenantId,
      doc: document,
      userId: sampleUserContext.userId,
    });
  }
  catch (error) {
    thrown = error;
  }

  const error = thrown as IDynaError;
  expect([
    isUsageDeniedError(thrown),
    error.code,
    error.status,
    error.userMessage,
    error.data,
    usageAdapterDenyingEmbed.checkCalls.map(call => [call.kind, call.userId]),
    usageAdapterDenyingEmbed.addUsageCalls.length,
  ]).toEqual([
    true,
    USAGE_DENIED_ERROR_CODE,
    429,
    denial.denyUserMessage,
    {
      traceId: "fake-trace-1",
      denyCode: denial.denyCode,
      denyUserMessage: denial.denyUserMessage,
    },
    [[ETraceKind.EMBED, sampleUserContext.userId]],
    0,
  ]);
});
