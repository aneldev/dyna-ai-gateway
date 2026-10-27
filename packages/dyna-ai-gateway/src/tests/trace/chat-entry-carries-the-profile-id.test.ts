import {
  AIGateway,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigTrace} from "./trace.config";

/**
 * Every model call names the profile it ran on: the CHAT entry of an `ask()` carries the `profileId` of the call, next to the
 * user and the thread, so a reader of the trace (or an adapter fed from it) knows which profile spent the tokens.
 */
test("the CHAT trace entry of an ask carries the profile id of the call", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigTrace, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(
    makeModelResult({
      modelId: openAiModel.id,
      text: "Hello.",
    }),
  );

  const response = await gateway.ask({
    profileId: sampleProfile.id,
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  }).response;

  const entries = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {threadId: response.threadId ?? ""},
    skip: 0,
    limit: 10,
  });
  expect(entries.map(entry => [entry.kind, entry.userId, entry.profileId])).toEqual([
    [ETraceKind.CHAT, sampleUserContext.userId, sampleProfile.id],
  ]);
});
