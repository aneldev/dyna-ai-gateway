import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  IUserContext,
} from "../../..";

import {sampleProfile} from "../../../tests/internal/samples/profiles";
import {
  getCurrentTimeTool,
  sendEmailTool,
} from "../../../tests/internal/samples/tools";
import {gatewayConfigBase} from "../../../tests/internal/utils/gatewayConfigBase";
import {noKb} from "../../../tests/internal/utils/makeGateway";
import {sampleUserContext} from "../../../tests/internal/utils/sampleUserContext";

import {IAIGatewayVercelUiConfig} from "../types";

/** The header the test requests carry instead of a session: the sample user, or nobody. */
export const USER_HEADER = "x-test-user";

/** A profile with a free tool (`get_current_time`) and one that pauses for approval (`send_email`). */
export const gatewayConfigVercelUi: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        allowedTools: [getCurrentTimeTool.name, sendEmailTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [getCurrentTimeTool, sendEmailTool]},
};

/** The sample user when the request names it, a 401 otherwise: the trust boundary of the test endpoint. */
const userContextOf = async ({request}: {request: Request}): Promise<IUserContext> => {
  if (request.headers.get(USER_HEADER) !== sampleUserContext.userId) {
    throw dynaError({
      code: 5377780695088,
      status: 401,
      message: "Test endpoint: no user",
    });
  }
  return sampleUserContext;
};

/** The use case of a run with the two tools; files served from a test url. */
export const vercelUiConfigRun: IAIGatewayVercelUiConfig = {
  mode: "run",
  userContext: userContextOf,
  call: {
    profileId: sampleProfile.id,
    kbFilters: noKb,
  },
  files: {
    fromUi: async () => {
      throw dynaError({
        code: 5377780695099,
        message: "Test endpoint: the tests upload through the gateway, not through a file part",
      });
    },
    toUrl: async ({file}) => `https://files.test/${file.id}`,
  },
};

/** The use case of a plain answer. */
export const vercelUiConfigAsk: IAIGatewayVercelUiConfig = {
  mode: "ask",
  userContext: userContextOf,
  call: {
    profileId: sampleProfile.id,
    kbFilters: noKb,
  },
};
