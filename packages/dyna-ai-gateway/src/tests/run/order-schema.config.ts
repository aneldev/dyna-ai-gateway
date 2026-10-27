import {z} from "zod";

import {IAIGatewayConfig} from "../..";

import {gatewayConfigParallelTools} from "./parallel-tools.config";

/** The shape a run must answer in: what `lookup_order` returns, as the caller wants it back. */
export const orderSchema = z.object({
  orderId: z.string(),
  total: z.number(),
});

/** The parallel-tools scenario (lookup_order among its tools); the test adds the `outputSchema` on the call. */
export const gatewayConfigOrderSchema: IAIGatewayConfig = gatewayConfigParallelTools;
