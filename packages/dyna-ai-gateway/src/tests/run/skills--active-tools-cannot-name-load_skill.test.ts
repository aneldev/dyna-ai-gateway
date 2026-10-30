import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkills} from "./skills.config";

/**
 * `load_skill` is a built-in: it is offered whenever the call has skills and is not part of what `activeTools` selects, like the
 * other built-ins (D61). Naming it there is the ToolPolicy's 400 for a tool the profile does not allow.
 */
test("activeTools naming load_skill is a 400, as for any tool the profile does not list", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  await expect(gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "hello",
    kbFilters: noKb,
    activeTools: ["load_skill"],
  }).response).rejects.toMatchObject({
    code: 5373897180054,
    status: 400,
  });
});
