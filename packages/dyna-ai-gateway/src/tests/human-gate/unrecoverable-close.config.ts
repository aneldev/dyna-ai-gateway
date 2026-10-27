import {IAIGatewayConfig} from "../..";

import {FailingRunRepository} from "../internal/utils/FailingRunRepository";
import {FailingThreadRepository} from "../internal/utils/FailingThreadRepository";

import {gatewayConfigResumeOnAnotherProfile} from "./resume-on-another-profile.config";

/** The two refund profiles on a run store and a thread store that can each fail once on demand: a resume breaks, then its closing breaks. */
export const gatewayConfigUnrecoverableClose: IAIGatewayConfig = {
  ...gatewayConfigResumeOnAnotherProfile,
  runStore: {repository: new FailingRunRepository()},
  threadStore: {repository: new FailingThreadRepository()},
};
