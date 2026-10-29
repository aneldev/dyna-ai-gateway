import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/** The profile's addendum is part of the stable block: a profile switch mid-thread changes it, so the cache entry is another one. */
test("another profile gives another stable block", async () => {
  const assembler = makeAssembler();
  const input = makeInput();

  const careful = await assembler.build({input});
  const brief = await assembler.build({
    input: {
      ...input,
      profile: {
        ...input.profile,
        id: "brief",
        promptAddendum: "Answer in one line.",
      },
    },
  });

  expect([
    careful.request.system[0].text === brief.request.system[0].text,
    brief.request.system[0].text.includes("Answer in one line."),
    brief.request.system[0].cache,
  ]).toEqual([false, true, true]);
});
