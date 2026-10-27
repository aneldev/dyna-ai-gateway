import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleProfile} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigAskOnAReviewingProfile} from "./ask-on-a-reviewing-profile.config";

/**
 * A profile with `reviewAnswers` needs a run to pause (D99); `ask()` has none, so it is refused with a 400 before the model is
 * called (nothing is enqueued) and before a thread is created. Answering unreviewed would leak what the profile forbids.
 */
test("an ask on a profile that reviews its answers is a 400 before anything is stored", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAskOnAReviewingProfile, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const error: unknown = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response.then(() => null, (thrown: unknown) => thrown);

  const {items: threads} = await gatewayConfigAskOnAReviewingProfile.threadStore.repository.listThreads({
    tenantId: sampleUserContext.tenantId,
    userId: sampleUserContext.userId,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });
  expect([
    error,
    threads.length,
  ]).toMatchObject([
    {
      status: 400,
      data: {profileId: sampleProfile.id},
    },
    0,
  ]);
});
