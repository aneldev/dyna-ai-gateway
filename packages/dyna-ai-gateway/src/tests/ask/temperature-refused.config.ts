import {
  IAIGatewayConfig,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The thread repository of the config, exported so a test can check that a refused call created no thread. */
export const temperatureRefusedThreadRepository = new InMemoryThreadRepository();

/** Plain chat on `gpt-6.1-terra`, whose registry entry has `caps.temperature` false: a call with a temperature is refused (D82). */
export const gatewayConfigTemperatureRefused: IAIGatewayConfig = {
  ...gatewayConfigBase,
  threadStore: {repository: temperatureRefusedThreadRepository},
};
