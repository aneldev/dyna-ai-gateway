import {
  IAIProfile,
  IUserContext,
} from "../../..";

import {openAiModel} from "./models";

/** The sample user of the tests and the sandbox; the caller adds `now` on every call. */
export const sampleUser: Omit<IUserContext, "now"> = {
  tenantId: "sample-tenant",
  userId: "sample-user",
  permissions: [],
  locale: "en-GB",
  timezone: "Europe/Vienna",
};

/** The sample tenant's profile `default` (the id every test call names): OpenAI, no tools. A config overrides `modelId` / `allowedTools` with a spread. */
export const sampleProfile: IAIProfile = {
  id: "default",
  tenantId: sampleUser.tenantId,
  name: "Sample profile",
  modelId: openAiModel.id,
  promptAddendum: "You are a technical assistant that answers a developer who is testing you. Be short.",
  allowedTools: [],
  approvals: [],
  limits: {
    maxStepsPerRun: 6,
    maxOutputTokens: 2_000,
  },
};
