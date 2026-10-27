import {ETraceKind} from "../../../trace";

import {
  IUsageAddArgs,
  IUsageCheckArgs,
} from "../../types";

/** The check of one plain chat call of user A on the default profile. */
export const sampleCheckArgs: IUsageCheckArgs = {
  traceId: "trace-1",
  tenantId: "tenant-a",
  userId: "user-a",
  profileId: "default",
  modelId: "model-a",
  kind: ETraceKind.CHAT,
  threadId: "thread-1",
  neededTokens: {
    input: 120,
    output: 500,
  },
};

/** The report of the same call: 100 input and 20 output tokens, 0.0004 USD at list price. */
export const sampleAddArgs: IUsageAddArgs = {
  traceId: "trace-1",
  tenantId: "tenant-a",
  userId: "user-a",
  profileId: "default",
  modelId: "model-a",
  kind: ETraceKind.CHAT,
  threadId: "thread-1",
  date: new Date("2026-10-23T10:00:00.000Z"),
  usage: {
    inputTokens: 100,
    outputTokens: 20,
  },
  costUsd: 0.0004,
};
