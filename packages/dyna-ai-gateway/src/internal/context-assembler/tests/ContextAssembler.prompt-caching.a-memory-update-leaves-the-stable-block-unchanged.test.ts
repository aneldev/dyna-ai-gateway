import {
  makeAssembler,
  makeInput,
  makeMemory,
} from "./utils/contextAssemblerFixtures";

/**
 * The memory's notes (the thread summary and facts of SUMMARY_BUFFER) and the user's facts change between calls; they
 * render after the breakpoint, so the stable block of a profile stays the same and the cache keeps matching.
 */
test("a memory update between two calls leaves the stable block unchanged", async () => {
  const before = await makeAssembler().build({input: makeInput()});
  const after = await makeAssembler({}, makeMemory(undefined, "About this conversation so far:\nThe user wants a refund."))
    .build({
      input: makeInput({
        userFacts: [{
          key: "language",
          value: "German",
          updatedAt: new Date(2_000),
        }],
      }),
    });

  expect([
    before.request.system[0].text === after.request.system[0].text,
    after.request.system[1].text.includes("About this conversation so far"),
    after.request.system[1].text.includes("language: German"),
  ]).toEqual([true, true, true]);
});
