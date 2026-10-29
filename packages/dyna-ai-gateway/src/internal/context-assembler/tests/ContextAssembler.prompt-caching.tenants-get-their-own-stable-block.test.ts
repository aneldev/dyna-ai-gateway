import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/**
 * With `sharePromptCacheAcrossTenants: false` two tenants on the same profile text get different stable blocks: each opens
 * with a scope line that holds a hash of the tenant id, never the id itself, so neither reads the other's cache entry. The
 * tool definitions get no marker either (`cacheTools` unset): they are the same for every tenant.
 */
test("without sharing, two tenants with one profile text get different stable blocks and no cacheTools", async () => {
  const assembler = makeAssembler();
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
    tenantA.request.system[0].text.includes("tenant-a"),
    tenantB.request.system[0].text.includes("tenant-b"),
    tenantA.request.system[1].text === tenantB.request.system[1].text,
    tenantA.request.cacheTools,
  ]).toEqual([false, true, false, false, true, undefined]);
});
