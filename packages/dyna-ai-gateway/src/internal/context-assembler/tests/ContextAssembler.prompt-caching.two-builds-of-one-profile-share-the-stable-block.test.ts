import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/**
 * Two calls of one profile, on another day with other instructions: the first system block is byte-identical and marked
 * `cache`, the second block carries what changed. That identical first block is what the provider's prompt cache matches.
 */
test("two builds of one profile give the same stable block and differ only after it", async () => {
  const assembler = makeAssembler();

  const first = await assembler.build({input: makeInput()});
  const input = makeInput();
  const second = await assembler.build({
    input: {
      ...input,
      userContext: {
        ...input.userContext,
        now: new Date("2026-10-15T10:00:00Z"),
      },
      instructions: "Answer in one sentence.",
    },
  });

  expect([
    first.request.system.length,
    first.request.system[0],
    first.request.system[0].text === second.request.system[0].text,
    first.request.system[1].text === second.request.system[1].text,
  ]).toEqual([2, {
    text: first.request.system[0].text,
    cache: true,
  }, true, false]);
});
