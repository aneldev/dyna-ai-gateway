import {IAIGatewayConfig} from "../..";

import {FailingRunRepository} from "../internal/utils/FailingRunRepository";

import {gatewayConfigResumeOnAnotherProfile} from "./resume-on-another-profile.config";

/** The two refund profiles of `gatewayConfigResumeOnAnotherProfile` on a run store that can fail on demand. */
export const gatewayConfigFailingRunSave: IAIGatewayConfig = {
  ...gatewayConfigResumeOnAnotherProfile,
  runStore: {repository: new FailingRunRepository()},
};
