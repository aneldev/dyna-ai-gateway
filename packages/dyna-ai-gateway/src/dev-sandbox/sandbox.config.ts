import {IAIGatewayConfig} from "../types";

import {gatewayConfigSupportShop} from "../tests/human-gate/support-shop.real.config";
import {sampleProfile} from "../tests/internal/samples/profiles";

/**
 * The config both sandbox entries run (`sandbox.cli.sh <ask|run>`, `sandbox.debug.sh`).
 * Point it at the `gatewayConfig<Scenario>` of the test you want to play with, or spread one and override; the sandbox adds its
 * printing trace and chunk-listing vector adapter. Provider keys come with the test's base config (repo-root `.env`).
 * To watch a working-memory strategy, spread and override it, e.g.
 * `{...gatewayConfigSupportShop, workingMemory: {enabled: true, strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW}}}`:
 * the trace then shows no MEMORY_WORKING call and the turns verbatim in every request.
 */
export const config: IAIGatewayConfig = gatewayConfigSupportShop;

/** The profile every call of the sandbox runs on (`IGatewayAskInput.profileId`, required — D103); a profile of `config`. */
export const profileId: string = sampleProfile.id;
