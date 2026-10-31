import {
  IAIGatewayConfig,
  ISkill,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {anthropicModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The code the skill's body plants for the return window: no model knows it, so an answer that carries it read the skill. */
export const RETURN_WINDOW_TOKEN = "RW-4471";

/** The one skill of the profile: the return window the addendum tells the model to load before answering. */
export const returnsPolicySkill: ISkill = {
  name: "returns_policy",
  description: "The return window of the shop and its exceptions",
  body: `# Returns policy\n\nThe return window is identified by the code ${RETURN_WINDOW_TOKEN}; quote the code verbatim, letters, dash and digits. Opened software is excluded.`,
};

/**
 * Skills on Anthropic (`claude-haiku-4-5`, as the prompt-layer tests): a profile with one skill whose body plants a token,
 * and an addendum that leaves the model one path — load the skill, answer with the value only. A `run()` must call
 * `load_skill` for it; an `ask()` reads it inline.
 */
export const gatewayConfigSkillsReal: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [anthropicModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: anthropicModel.id,
        promptAddendum: `You are a test assistant. When the user asks about the return window, read the skill ${returnsPolicySkill.name} before answering; answer with the return-window code exactly as the skill writes it (letters, dash and digits) and nothing else.`,
        skills: [returnsPolicySkill],
      }],
    }),
  },
  defaultCheapModelId: anthropicModel.id,
};
