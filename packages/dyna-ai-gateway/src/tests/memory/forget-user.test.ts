import {
  IAIGatewayConfig,
  IFileRef,
  IForgetUserResult,
  IRun,
  IThread,
  ITraceEntry,
  IUserContext,
  InMemoryUserMemoryRepository,
  EGatewayResponseKind,
  EMessageRole,
  EPartKind,
  ERunStatus,
  EThreadStatus,
  ETraceKind,
  EUserMemoryFactOp,
} from "../..";

import {
  IGatewaySetup,
  makeGateway,
  makeModelResult,
  makeProfile,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";

/**
 * "Forget this user" by example: user-a of tenant-a has a file, a thread with two turns, a remembered fact, a paused run
 * and a trace entry. `deleteUserData` removes all of it; `anonymizeUserData` keeps the thread, the run and the trace
 * entry as skeletons under one `@anon-<uuid>`. user-b of the same tenant and user-a of tenant-b are never touched.
 */

const otherUser: IUserContext = {
  ...userContext,
  userId: "user-b",
};
const sameUserOtherTenant: IUserContext = {
  ...userContext,
  tenantId: "tenant-b",
};

interface IUserFootprint {
  file: IFileRef;
  threadId: string;
  runId: string;
}

const makeRun = (
  {
    tenantId,
    userId,
  }: IUserContext,
  threadId: string,
): IRun => ({
  id: `run-${tenantId}-${userId}`,
  tenantId,
  threadId,
  userId,
  profileId: "default",
  status: ERunStatus.PAUSED,
  request: {
    modelId: "model-a",
    system: [{text: `The user is ${userId}`}],
    maxOutputTokens: 500,
  },
  toolNames: ["refund"],
  startTurnCount: 0,
  chunkIds: [],
  templateVersion: 1,
  messages: [{
    role: EMessageRole.USER,
    parts: [{
      kind: EPartKind.TEXT,
      text: "Refund invoice 4521",
    }],
  }],
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
});

/** Leaves something of the user in every place: a file, a thread with two turns, a fact, a paused run, a trace entry. */
const seedUser = async (setup: IGatewaySetup, who: IUserContext): Promise<IUserFootprint> => {
  const file = await setup.gateway.uploadFile({
    userContext: who,
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/png",
    name: "invoice.png",
  });
  // One trace entry per user: the fake records the entry under the result's traceId
  setup.llmClient.enqueueComplete(makeModelResult({traceId: `trace-${who.tenantId}-${who.userId}`}));
  const response = await setup.gateway.ask({
    profileId: "default",
    userContext: who,
    prompt: "What is on this invoice?",
    files: [file],
    kbFilters: noKb,
  }).response;
  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Test setup: expected ANSWER, got ${response.kind}`);
  await setup.gateway.upsertUserFact({
    userContext: who,
    key: "language",
    value: "German",
  });
  const run = makeRun(who, response.threadId);
  await setup.config.runStore.repository.save({run});
  return {
    file,
    threadId: response.threadId,
    runId: run.id,
  };
};

/** A gateway with the three users seeded; tenant-b gets its own profile `default`. */
const setupUsers = async (configOverrides: Partial<IAIGatewayConfig> = {}): Promise<IGatewaySetup & {footprints: Map<IUserContext, IUserFootprint>}> => {
  const setup = await makeGateway(configOverrides);
  await setup.gateway.aiProfileStore.upsertProfile({
    tenantId: "tenant-b",
    profile: makeProfile("default", {tenantId: "tenant-b"}),
  });
  const footprints = new Map<IUserContext, IUserFootprint>();
  for (const who of [userContext, otherUser, sameUserOtherTenant]) footprints.set(who, await seedUser(setup, who));
  return {
    ...setup,
    footprints,
  };
};

const listThreads = (
  {config}: IGatewaySetup,
  {
    tenantId,
    userId,
  }: IUserContext,
): Promise<IThread[]> =>
  config.threadStore.repository.listThreads({
    tenantId,
    userId,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  }).then(page => page.items);

const loadRun = ({config}: IGatewaySetup, {tenantId}: IUserContext, runId: string): Promise<IRun | null> =>
  config.runStore.repository.load({
    tenantId,
    runId,
  });

const queryTraces = (
  {gateway}: IGatewaySetup,
  {
    tenantId,
    userId,
  }: IUserContext,
): Promise<ITraceEntry[]> =>
  gateway.trace.query({
    tenantId,
    filters: {userId},
    skip: 0,
    limit: 10,
  });

/** What is still there of a user: [threads, turns, facts, runs, traces]. */
const countFootprint = async (setup: IGatewaySetup, who: IUserContext, footprint: IUserFootprint): Promise<number[]> => {
  const threads = await listThreads(setup, who);
  const turns = await setup.config.threadStore.repository.loadTurns({
    tenantId: who.tenantId,
    threadId: footprint.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  const facts = await setup.gateway.getUserFacts({userContext: who});
  const run = await loadRun(setup, who, footprint.runId);
  const traces = await queryTraces(setup, who);
  return [threads.length, turns.length, facts.length, run ? 1 : 0, traces.length];
};

const fullFootprint = [1, 2, 1, 1, 1];
const noFootprint = [0, 0, 0, 0, 0];

const zeroCounts: IForgetUserResult = {
  files: 0,
  threads: 0,
  turns: 0,
  userFacts: 0,
  runs: 0,
  traces: 0,
  pseudonym: null,
};

const getFootprint = (setup: Awaited<ReturnType<typeof setupUsers>>, who: IUserContext): IUserFootprint => {
  const footprint = setup.footprints.get(who);
  if (!footprint) throw new Error("Test setup: the user was not seeded");
  return footprint;
};

describe("AIGateway — M6: forget this user (GDPR)", () => {
  describe("deleteUserData", () => {
    test("returns what it deleted, place by place, with no pseudonym", async () => {
      const setup = await setupUsers();
      expect(await setup.gateway.deleteUserData(userContext)).toEqual({
        files: 1,
        threads: 1,
        turns: 2,
        userFacts: 1,
        runs: 1,
        traces: 1,
        pseudonym: null,
      });
    });

    test("afterwards nothing of the user is found anywhere; the file is gone too", async () => {
      const setup = await setupUsers();
      const {file} = getFootprint(setup, userContext);
      await setup.gateway.deleteUserData(userContext);
      expect(await countFootprint(setup, userContext, getFootprint(setup, userContext))).toEqual(noFootprint);
      setup.llmClient.enqueueComplete(makeModelResult());
      await expect(setup.gateway.ask({
        profileId: "default",
        userContext,
        prompt: "Again?",
        files: [file],
        kbFilters: noKb,
      }).response).rejects.toMatchObject({status: 404});
    });

    test("another user of the tenant and the same user id in another tenant are untouched", async () => {
      const setup = await setupUsers();
      await setup.gateway.deleteUserData(userContext);
      expect([
        await countFootprint(setup, otherUser, getFootprint(setup, otherUser)),
        await countFootprint(setup, sameUserOtherTenant, getFootprint(setup, sameUserOtherTenant)),
      ]).toEqual([fullFootprint, fullFootprint]);
    });

    test("a second call finds nothing to do", async () => {
      const setup = await setupUsers();
      await setup.gateway.deleteUserData(userContext);
      expect(await setup.gateway.deleteUserData(userContext)).toEqual(zeroCounts);
    });

    test("waits for the background memory work first, so a queued extraction cannot bring a fact back", async () => {
      const setup = await makeGateway({
        workingMemory: {enabled: false},
        userMemoryStore: {
          repository: new InMemoryUserMemoryRepository(),
          enabled: true,
          extractEveryTurns: 2,
        },
      });
      setup.llmClient.enqueueComplete(makeModelResult());
      setup.llmClient.enqueueComplete(makeModelResult({
        structured: {
          facts: [{
            key: "name",
            value: "Dennis",
            op: EUserMemoryFactOp.SET,
          }],
        },
      }), ETraceKind.MEMORY_USER);
      await setup.gateway.ask({
        profileId: "default",
        userContext,
        prompt: "I am Dennis",
        kbFilters: noKb,
      }).response;
      // No whenIdle: the extraction is still queued when the user asks to be forgotten
      const result = await setup.gateway.deleteUserData(userContext);
      expect([result.userFacts, await setup.gateway.getUserFacts({userContext})]).toEqual([1, []]);
    });
  });

  describe("anonymizeUserData", () => {
    test("returns the counts and one pseudonym of the form @anon-<uuid>", async () => {
      const setup = await setupUsers();
      const result = await setup.gateway.anonymizeUserData(userContext);
      expect(result).toMatchObject({
        files: 1,
        threads: 1,
        turns: 2,
        userFacts: 1,
        runs: 1,
        traces: 1,
      });
      expect(result.pseudonym).toMatch(/^@anon-.{8,}$/);
    });

    test("the files, the turns and the facts are gone, like in deleteUserData; nothing is under the user id any more", async () => {
      const setup = await setupUsers();
      const footprint = getFootprint(setup, userContext);
      await setup.gateway.anonymizeUserData(userContext);
      // The run is still there by its id: it is a skeleton under the pseudonym now (see below)
      expect(await countFootprint(setup, userContext, footprint)).toEqual([0, 0, 0, 1, 0]);
      expect(await setup.gateway.removeFilesByUser(userContext)).toBe(0);
    });

    test("the thread stays as a closed skeleton under the pseudonym: no title, no memory, turnCount and dates kept", async () => {
      const setup = await setupUsers();
      const {threadId} = getFootprint(setup, userContext);
      const before = await setup.config.threadStore.repository.loadThread({
        tenantId: "tenant-a",
        threadId,
      });
      const {pseudonym} = await setup.gateway.anonymizeUserData(userContext);
      const threads = await listThreads(setup, {
        ...userContext,
        userId: pseudonym ?? "",
      });
      expect(threads).toEqual([{
        ...before,
        userId: pseudonym,
        title: "",
        status: EThreadStatus.CLOSED,
        workingMemory: {
          summary: "",
          facts: {},
          updatedAtTurn: 0,
        },
      }]);
    });

    test("the paused run stays cancelled under the pseudonym, without messages or system prompt", async () => {
      const setup = await setupUsers();
      const {runId} = getFootprint(setup, userContext);
      const {pseudonym} = await setup.gateway.anonymizeUserData(userContext);
      expect(await loadRun(setup, userContext, runId)).toMatchObject({
        userId: pseudonym,
        status: ERunStatus.CANCELLED,
        messages: [],
        request: {
          modelId: "model-a",
          system: [],
        },
        steps: 1,
      });
    });

    test("the trace entry stays as an audit skeleton under the pseudonym: usage and cost kept, request and result gone", async () => {
      const setup = await setupUsers();
      const {pseudonym} = await setup.gateway.anonymizeUserData(userContext);
      const entries = await queryTraces(setup, {
        ...userContext,
        userId: pseudonym ?? "",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: ETraceKind.CHAT,
        modelId: "model-a",
        usage: {
          inputTokens: 10,
          outputTokens: 2,
        },
      });
      expect([entries[0].request, entries[0].result, typeof entries[0].costUsd]).toEqual([undefined, undefined, "number"]);
    });

    test("another user of the tenant and the same user id in another tenant are untouched; a second call finds nothing", async () => {
      const setup = await setupUsers();
      await setup.gateway.anonymizeUserData(userContext);
      expect([
        await countFootprint(setup, otherUser, getFootprint(setup, otherUser)),
        await countFootprint(setup, sameUserOtherTenant, getFootprint(setup, sameUserOtherTenant)),
      ]).toEqual([fullFootprint, fullFootprint]);
      expect(await setup.gateway.anonymizeUserData(userContext)).toMatchObject({
        ...zeroCounts,
        pseudonym: expect.stringMatching(/^@anon-/),
      });
    });
  });
});
