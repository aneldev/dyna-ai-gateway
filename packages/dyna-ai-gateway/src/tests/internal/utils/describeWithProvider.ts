import {EModelProvider} from "../../..";

import {gatewayConfigBase} from "./gatewayConfigBase";

/**
 * `describe` when every named provider's key is in the repo-root `.env` (it is then in `gatewayConfigBase.llmClient.providers`),
 * else `describe.skip`: a real-provider test never fails for a missing key. A test that swaps providers names both.
 */
export const describeWithProvider = (...providers: EModelProvider[]): jest.Describe =>
  providers.every(provider => gatewayConfigBase.llmClient.providers[provider]) ? describe : describe.skip;
