import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/**
 * With `sharePromptCacheAcrossTenants: true` two tenants on the same profile text get byte-identical stable blocks (no scope
 * line) and the tool definitions are marked too (`cacheTools`): one cache entry serves them all.
 */
test("with sharing, two tenants with one profile text get the same stable block and cacheTools", async () => {
  const assembler = makeAssembler({sharePromptCacheAcrossTenants: true});
  const input = makeInput();

  const tenantA = await assembler.build({input});
  const tenantB = await assembler.build({
    input: {
      ...input,
      userContext: {
        ...input.userContext,
        tenantId: "tenant-b",
      },
    },
  });

  expect([
    tenantA.request.system[0].text === tenantB.request.system[0].text,
    tenantA.request.system[0].text.startsWith("[cache scope "),
    tenantA.request.system[0].cache,
    tenantA.request.cacheTools,
  ]).toEqual([true, false, true, true]);
});
