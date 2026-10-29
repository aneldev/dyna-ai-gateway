import {
  IRun,
  ERunStatus,
} from "../../types";

export const makeRun = (id: string, overrides: Partial<IRun> = {}): IRun => ({
  id,
  tenantId: "tenant-a",
  threadId: "thread-1",
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.RUNNING,
  request: {
    modelId: "model-a",
    system: [{text: "You are a test"}],
    maxOutputTokens: 500,
  },
  toolNames: ["refund"],
  startTurnCount: 0,
  chunkIds: [],
  templateVersion: 1,
  messages: [],
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
  ...overrides,
});
