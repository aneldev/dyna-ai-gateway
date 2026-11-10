import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {prefixedHostTool} from "./built-in-tool-names.config";

/**
 * A call tool (`additionalTools`) may not take the `dyna_aigw_` prefix either: the call is a 400 before anything is stored,
 * and the model (nothing enqueued) is never called.
 */
test("an additional tool whose name starts with dyna_aigw_ is a 400", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigBase, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Find order A-1",
    kbFilters: noKb,
    additionalTools: [prefixedHostTool],
  }).response;

  await expect(response).rejects.toMatchObject({
    code: 5387318840422,
    status: 400,
    data: {
      source: "additionalTools",
      reservedTools: [prefixedHostTool.name],
    },
  });
});
