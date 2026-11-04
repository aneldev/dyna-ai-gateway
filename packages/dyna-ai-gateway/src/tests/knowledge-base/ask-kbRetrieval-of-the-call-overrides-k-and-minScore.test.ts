import {
  AIGateway,
  IKbRetrievalOptions,
  TGatewayResponse,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {makeModelResult} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  documents,
  gatewayConfigKbRetrievalOverrides,
  seenChunks,
  toVector,
} from "./kb-retrieval-overrides.config";

/**
 * A prompt that names all three words matches both documents alike with the config's defaults. `kbRetrieval` of the call
 * raises the bar (`minScore`) or caps the count (`k`); the config's values stay what they are.
 */
test("ask retrieves by the call's kbRetrieval: the defaults keep both chunks, minScore 0.99 keeps none, k 1 keeps one", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigKbRetrievalOverrides, {llmClient: () => llmClient});
  llmClient.embedWith(toVector);
  for (const doc of documents) {
    await gateway.kbIngestor.ingestDocument({
      tenantId: sampleUser.tenantId,
      doc,
    });
  }
  const ask = (kbRetrieval?: IKbRetrievalOptions): Promise<TGatewayResponse> => {
    llmClient.enqueueComplete(makeModelResult());
    return gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "refund invoice weather",
      kbFilters: {
        libraryIds: "all",
        bookIds: [],
      },
      ...kbRetrieval ? {kbRetrieval} : {},
    }).response;
  };

  await ask();
  await ask({minScore: 0.99});
  await ask({k: 1});

  expect(seenChunks.map(chunks => chunks.map(chunk => chunk.id).sort())).toEqual([
    ["refund-doc#0", "weather-doc#0"],
    [],
    [expect.stringMatching(/-doc#0$/)],
  ]);
});
