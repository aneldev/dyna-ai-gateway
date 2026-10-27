import {EGatewayResponseKind} from "../..";

import {
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {makeToolGateway} from "../internal/utils/makeToolGateway";

describe("AIGateway — M6: activeTools, the tools of one call (D48)", () => {
  test("run offers the model only the tools that activeTools names", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({text: "done"});
    await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "show invoice 4521",
      kbFilters: noKb,
      activeTools: ["get_invoice"],
    }).response;
    expect(setup.llmClient.runCalls[0].tools.map(tool => tool.name)).toEqual(["get_invoice"]);
  });

  test("a tool the profile does not allow is a 400 that stores nothing and calls no model", async () => {
    const setup = await makeToolGateway();
    await expect(setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "send the invoice",
      kbFilters: noKb,
      activeTools: ["get_invoice", "send_email"],
    }).response).rejects.toMatchObject({
      code: 5373897180054,
      status: 400,
    });
    const {items: threads} = await setup.config.threadStore.repository.listThreads({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      page: {
        limit: 10,
        startingAfter: null,
        endingBefore: null,
      },
    });
    expect([threads.length, setup.llmClient.runCalls.length]).toEqual([0, 0]);
  });

  test("ask has no tools: activeTools is not in its input, a type error (D104)", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueComplete(makeModelResult({text: "Hello."}));
    const response = await setup.gateway.ask({
      profileId: "default",
      userContext,
      prompt: "hello",
      kbFilters: noKb,
      // @ts-expect-error -- IGatewayAskInput has no activeTools; the call still answers, the field is ignored
      activeTools: ["send_email"],
    }).response;
    expect(response.kind).toBe(EGatewayResponseKind.ANSWER);
  });
});
