import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";

import {
  gatewayConfigHostToolWithTheBuiltInPrefix,
  prefixedHostTool,
} from "./built-in-tool-names.config";

/**
 * The `dyna_aigw_` prefix is reserved for the built-in tools: an application tool registered with it would collide with a
 * built-in, present or future, so the gateway refuses to start with a 400 naming it.
 */
test("a registered host tool whose name starts with dyna_aigw_ makes the gateway constructor throw a 400", () => {
  const construct = (): AIGateway => new AIGateway(gatewayConfigHostToolWithTheBuiltInPrefix, {llmClient: () => new FakeLLMClient()});

  expect(construct).toThrow(expect.objectContaining({
    code: 5387318840422,
    status: 400,
    data: {
      source: "toolRegistry.tools",
      reservedTools: [prefixedHostTool.name],
    },
  }));
});
